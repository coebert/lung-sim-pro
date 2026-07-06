import { VentSettings, PatientPhysiology, CommonSettings, APRVSettings } from './types';

/**
 * Shared physiology math used by both the engine and the UI feedback panels.
 * Keeping these formulas in one place prevents the engine and the UI from
 * drifting out of sync (which used to happen when the same recruitment
 * heuristic was copy-pasted into three files).
 */

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ─── I:E timing ──────────────────────────────────────────────────────

export interface IEMetrics {
  cycleTime: number;
  iTime: number;
  eTime: number;
  /** E/I ratio (numerator is always 1) — 0.8 = 1:1.25, 1 = 1:1, 2 = 1:0.5 */
  ieActual: number;
}

export function computeIE(s: CommonSettings): IEMetrics {
  const cycleTime = 60 / s.respiratoryRate;
  const iTime = s.inspiratoryTime > 0
    ? s.inspiratoryTime
    : cycleTime / (1 + s.ieRatio);
  const eTime = Math.max(cycleTime - iTime, 0.1);
  const ieActual = iTime / eTime;
  return { cycleTime, iTime, eTime, ieActual };
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
  const ieExcess = Math.max(0, ie.ieActual - 0.8);
  const shuntFraction = Math.min(
    0.5,
    peepExcess * 0.02 + ieExcess * 0.08 + peepExcess * ieExcess * 0.03
  );
  return { peepExcess, ieExcess, shuntFraction, ie };
}

// ─── APRV recruitment ────────────────────────────────────────────────

export interface APRVMetrics {
  drivingPressure: number;
  openingPressure: number;
  meanAirwayPressure: number;
  pHighScore: number;
  tHighScore: number;
  tLowScore: number;
  pLowPenalty: number;
  /** 0 = no recruitment, 1 = optimal */
  recruitmentScore: number;
}

export function computeAPRV(s: APRVSettings, p: PatientPhysiology): APRVMetrics {
  const { pHigh, pLow, tHigh, tLow } = s;
  const openingPressure = p.optimalPEEP * 1.5;
  const drivingPressure = pHigh - pLow;

  // P High adequacy: need driving pressure ≥ opening pressure
  const pHighScore = clamp(
    (drivingPressure - openingPressure * 0.5) / (openingPressure * 1.0),
    0, 1
  );

  // T High adequacy: ≥4s optimal, 2–4s partial, <2s poor
  const tHighScore = clamp((tHigh - 1.5) / 3.0, 0, 1);

  // T Low adequacy: 0.3–0.8s optimal; too short (<0.1) no release;
  // too long (>1.2) allows full exhalation → derecruitment
  let tLowScore: number;
  if (tLow < 0.1) tLowScore = 0.1;
  else if (tLow <= 0.8) tLowScore = clamp(tLow / 0.3, 0, 1);
  else tLowScore = clamp(1.0 - (tLow - 0.8) / 0.7, 0, 1);

  // P Low penalty: ideally 0; higher P Low reduces pressure differential
  const pLowPenalty = clamp(pLow / 10, 0, 0.5);

  const recruitmentScore = clamp(
    pHighScore * tHighScore * tLowScore * (1 - pLowPenalty),
    0, 1
  );

  const meanAirwayPressure = (pHigh * tHigh + pLow * tLow) / (tHigh + tLow);

  return {
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
