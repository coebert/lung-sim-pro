import { VentSettings, PatientPhysiology, CommonSettings, APRVSettings } from './types';
import { APRV_EXP_TAU_FACTOR, aprvReleaseMetrics } from './aprvTrajectory';
export { APRV_EXP_TAU_FACTOR };

/**
 * Shared physiology math used by both the engine and the UI feedback panels.
 * Keeping these formulas in one place prevents the engine and the UI from
 * drifting out of sync (which used to happen when the same recruitment
 * heuristic was copy-pasted into three files).
 */

export function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min; // never let NaN propagate into vitals
  return Math.max(min, Math.min(max, v));
}

// ─── I:E timing ──────────────────────────────────────────────────────

export interface IEMetrics {
  cycleTime: number;
  iTime: number;
  eTime: number;
  /** I/E ratio as applied (Ti ÷ Te): 0.5 = 1:2, 2 = 2:1 */
  ieActual: number;
  /** Te ÷ Ti as applied (the "E" of 1:E). */
  eRatio: number;
  /** Ti as entered (explicit Ti, or derived from the I:E setting) before limits. */
  requestedTi: number;
  /** True when the entered timing was limited to leave the minimum expiration. */
  limited: boolean;
  /** Which control sets timing. */
  basis: 'ie' | 'ti';
}

/** Minimum expiratory time the model enforces (s). */
export const MIN_EXP_TIME = 0.1;

/** Anatomical + apparatus dead space estimate (mL): 2.2 mL/kg predicted body weight. */
export function deadSpaceMl(p: PatientPhysiology): number {
  return 2.2 * (p.predictedBodyWeight ?? p.weight);
}

export function computeIE(s: CommonSettings): IEMetrics {
  const cycleTime = 60 / s.respiratoryRate;
  const rawI = s.inspiratoryTime > 0
    ? s.inspiratoryTime
    : cycleTime / (1 + s.ieRatio);
  // Ti can never exceed the breath cycle — leave at least 0.1 s to exhale.
  const iTime = Math.min(rawI, Math.max(0.05, cycleTime - MIN_EXP_TIME));
  const eTime = Math.max(cycleTime - iTime, MIN_EXP_TIME);
  const ieActual = iTime / eTime;
  return {
    cycleTime, iTime, eTime, ieActual, eRatio: eTime / iTime,
    requestedTi: rawI, limited: rawI > iTime + 1e-9,
    basis: s.inspiratoryTime > 0 ? 'ti' : 'ie',
  };
}

// ─── Shunt from excessive PEEP + long inspiratory time ───────────────

export interface ShuntMetrics {
  peepExcess: number;
  ieExcess: number;
  shuntFraction: number;
  ie: IEMetrics;
}

export function computeShunt(s: CommonSettings, p: PatientPhysiology): ShuntMetrics {
  const ie = computeIE(s);
  const peepExcess = Math.max(0, s.peep - p.optimalPEEP * 1.3);
  // A long inspiratory time does not itself cause shunt — inverse-ratio
  // ventilation is a legitimate recruitment strategy (see computeInverseRatio).
  // Shunt here comes from excessive PEEP overdistending open units and
  // compressing their capillaries.
  const ieExcess = 0;
  const shuntFraction = Math.min(0.5, peepExcess * 0.02);
  return { peepExcess, ieExcess, shuntFraction, ie };
}

// ─── Inverse-ratio ventilation (IRV) ─────────────────────────────────
// Prolonging inspiratory time (I:E > 1:1) raises mean airway pressure,
// which recruits collapsed alveoli in recruitable lung disease (ARDS).
// Trade-offs: less expiratory time → auto-PEEP (handled by the trapped-
// volume model), reduced CO₂ clearance, and higher intrathoracic pressure
// → reduced venous return.

export interface InverseRatioMetrics {
  ie: IEMetrics;
  /** True when I:E is inverse (I longer than E). */
  isInverse: boolean;
  /** Estimated mean airway pressure (cmH₂O). */
  meanAirwayPressure: number;
  /** 0–1 recruitment benefit for recruitable (high-optimal-PEEP) lungs. */
  recruitmentBonus: number;
  /** 0–1 haemodynamic burden from raised intrathoracic pressure. */
  haemodynamicBurden: number;
}

export function computeInverseRatio(s: CommonSettings, p: PatientPhysiology): InverseRatioMetrics {
  const ie = computeIE(s);
  const dutyCycle = ie.iTime / ie.cycleTime;
  // Pmean ≈ PEEP + driving pressure × duty cycle (square-flow approximation).
  const drivingPressure = p.optimalTV / p.compliance;
  const meanAirwayPressure = s.peep + drivingPressure * dutyCycle;
  const isInverse = ie.ieActual > 1;

  // Recruitment benefit scales with how collapsed/recruitable the lung is
  // (optimalPEEP ≥ 8 ≈ ARDS/obese) and how much Pmean exceeds the opening
  // pressure. Normal lungs gain nothing — they are already open.
  const recruitable = clamp((p.optimalPEEP - 6) / 8, 0, 1);
  const openingPressure = p.openingPressure ?? p.optimalPEEP * 1.5;
  const recruitmentBonus = isInverse
    ? recruitable * clamp((meanAirwayPressure - openingPressure * 0.4) / (openingPressure * 0.5), 0, 1) * clamp((ie.ieActual - 1) / 1.5, 0, 1)
    : 0;

  // Sustained high intrathoracic pressure impedes venous return once Pmean
  // climbs past ~18 cmH₂O — independent of, and in addition to, auto-PEEP.
  const haemodynamicBurden = clamp((meanAirwayPressure - 18) / 12, 0, 1);

  return { ie, isInverse, meanAirwayPressure, recruitmentBonus, haemodynamicBurden };
}

// ─── APRV recruitment ────────────────────────────────────────────────

export interface APRVMetrics {
  /** Inspiratory time constant R·C (s); the release uses tau × APRV_EXP_TAU_FACTOR. */
  tau: number;
  /** Fraction of lung volume emptied during T Low. */
  releaseFraction: number;
  /** 0–1 severity of dynamic hyperinflation from incomplete release. */
  gasTrapping: number;
  drivingPressure: number;
  openingPressure: number;
  meanAirwayPressure: number;
  /** End-release flow as % of peak expiratory flow (trajectory-derived). */
  endToPeakFlowPct: number;
  /** True for a long time constant (obstructive) lung. */
  obstructive: boolean;
  noRelease: boolean;
  pHighScore: number;
  tHighScore: number;
  tLowScore: number;
  pLowPenalty: number;
  /** 0 = no recruitment, 1 = optimal */
  recruitmentScore: number;
}

export function computeAPRV(s: APRVSettings, p: PatientPhysiology): APRVMetrics {
  const { pHigh, pLow, tHigh } = s;
  // Data-driven per-patient opening pressure, with a sensible fallback so
  // patients that don't declare one still behave as before.
  const openingPressure = p.openingPressure ?? p.optimalPEEP * 1.5;
  const drivingPressure = pHigh - pLow;

  // P High adequacy: need driving pressure ≥ opening pressure
  const pHighScore = clamp(
    (drivingPressure - openingPressure * 0.5) / (openingPressure * 1.0),
    0, 1
  );

  // T High adequacy: ≥4s optimal, 2–4s partial, <2s poor
  const tHighScore = clamp((tHigh - 1.5) / 3.0, 0, 1);

  // T Low adequacy from this lung's own release trajectory (not a fixed
  // duration): for a restrictive/recruitable lung, end the release when
  // expiratory flow has fallen to ~50–75% of its peak. Too short ⇒ little
  // CO₂ clearance; too long ⇒ derecruitment. Obstructive lungs are scored
  // separately (no recruitment benefit, gas-trapping risk).
  const release = aprvReleaseMetrics(s, p);
  const pct = release.endToPeakFlowPct;
  let tLowScore: number;
  if (release.noRelease) tLowScore = 0;
  else if (pct > 75) tLowScore = clamp(1 - (pct - 75) / 20, 0, 1);
  else if (pct >= 50) tLowScore = 1;
  else tLowScore = clamp(0.2 + 0.8 * (pct - 10) / 40, 0.2, 1);

  // P Low penalty: ideally 0; higher P Low reduces pressure differential
  const pLowPenalty = clamp(pLow / 10, 0, 0.5);

  const tauR = Math.max(0.05, (p.resistance * p.compliance) / 1000);
  const obstructive = clamp((tauR - 0.5) / 0.7, 0, 1);
  // Obstructed lungs are not a recruitment problem: APRV offers no benefit.
  const recruitmentScore = clamp(
    pHighScore * tHighScore * tLowScore * (1 - pLowPenalty) * (1 - obstructive),
    0, 1
  );

  const meanAirwayPressure = (pHigh * tHigh + pLow * s.tLow) / Math.max(0.2, tHigh + s.tLow);

  // Gas trapping: the release only empties a fraction 1−e^(−T Low/τ) of
  // the lung (τ = R·C). Obstructed lungs (long τ) cannot empty in a short
  // release, so APRV stacks gas → dynamic hyperinflation, rising CO₂ and
  // falling venous return. Only clinically relevant once τ is long.
  const tau = Math.max(0.05, (p.resistance * p.compliance) / 1000);
  // Fraction emptied, from the same trajectory as the waveform (0 when P High ≤ P Low).
  const releaseFraction = release.releaseFraction;
  const obstruction = clamp((tau - 0.5) / 0.7, 0, 1);
  const gasTrapping = release.noRelease ? 0 : clamp(obstruction * (1 - releaseFraction) * clamp(drivingPressure / 20, 0.3, 1.5), 0, 1);

  return {
    tau,
    releaseFraction,
    endToPeakFlowPct: pct,
    obstructive: tau >= 0.5,
    noRelease: release.noRelease,
    gasTrapping,
    drivingPressure,
    openingPressure,
    meanAirwayPressure,
    pHighScore,
    tHighScore,
    tLowScore,
    pLowPenalty,
    recruitmentScore,
  };
}
