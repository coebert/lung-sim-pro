import { computeIE } from './scoring';
import { PatientPhysiology, VentSettings, CommonSettings, VCVSettings, PCVSettings, PRVCSettings, SIMVSettings, PSVSettings, APRVSettings } from './types';

const SAMPLE_RATE = 50; // Hz — ECG beat phase is locked to this sample grid

// --- Breath Stacking / Air Trapping ---
// For high-resistance patients, if expiratory time is too short relative to
// the time constant (tau = R * C), exhaled volume doesn't reach zero before
// the next breath, causing progressive volume stacking (auto-PEEP).

function calcTrappedVolume(s: CommonSettings, p: PatientPhysiology, deliveredVolumeMl: number): number {
  const C = p.compliance / 1000;
  const R = p.resistance;
  const tau = R * C;
  const cycleTime = 60 / s.respiratoryRate;
  const eTime = Math.max(0.1, cycleTime - getITime(s));

  const retainedFraction = Math.exp(-eTime / tau);
  if (retainedFraction > 0.01) {
    return (deliveredVolumeMl * retainedFraction) / (1 - retainedFraction);
  }
  return 0;
}

// --- Ventilator Waveforms ---

export function generateVentWaveformPoint(
  time: number,
  settings: VentSettings,
  patient: PatientPhysiology
): { pressure: number; flow: number; volume: number } {
  switch (settings.mode) {
    case 'VCV':  return vcvWaveform(time, settings, patient);
    case 'PCV':  return pcvWaveform(time, settings, patient);
    case 'PRVC': return prvcWaveform(time, settings, patient);
    case 'SIMV': return simvWaveform(time, settings, patient);
    case 'PSV':  return psvWaveform(time, settings, patient);
    case 'APRV': return aprvWaveform(time, settings, patient);
  }
}

/** Resolve inspiratory time: prefer explicit Ti, fall back to I:E ratio */
function getITime(s: CommonSettings): number {
  return computeIE(s).iTime; // single source of truth, capped to cycle − 0.1 s
}

/** Structural subtypes — a VCV breath just needs common timing + tidalVolume. */
type VCVLike = CommonSettings & { tidalVolume: number };
type PCVLike = CommonSettings & { pInsp: number };

function vcvWaveform(time: number, s: VCVLike, p: PatientPhysiology) {
  const cycleTime = 60 / s.respiratoryRate;
  const iTime = getITime(s);
  const phase = time % cycleTime;
  const C = p.compliance / 1000;
  const R = p.resistance;
  const tau = R * C;

  const trapped = calcTrappedVolume(s, p, s.tidalVolume);
  const autoPEEP = (trapped / 1000) / C;

  if (phase < iTime) {
    const flow = (s.tidalVolume / 1000) / iTime;
    const volume = trapped + flow * phase * 1000;
    const pressure = s.peep + autoPEEP + ((flow * phase * 1000) / 1000) / C + flow * R;
    return { pressure, flow: flow * 60, volume };
  } else {
    const ePhase = phase - iTime;
    // The TOTAL volume decays toward PEEP equilibrium — decaying only the
    // exhaled part left a volume/pressure step of TV·r at every breath
    // boundary. Steady state: (trapped+TV)·r = trapped.
    const volume = (trapped + s.tidalVolume) * Math.exp(-ePhase / tau);
    const flow = -(volume / 1000) / tau;
    // Exhalation valve open: AIRWAY pressure sits at set PEEP. Alveolar
    // pressure (and so auto-PEEP) is hidden — it is only revealed by an
    // expiratory hold, which the measured auto-PEEP value represents.
    return { pressure: s.peep, flow: flow * 60, volume: Math.max(volume, 0) };
  }
}

function pcvWaveform(time: number, s: PCVLike, p: PatientPhysiology) {
  const cycleTime = 60 / s.respiratoryRate;
  const iTime = getITime(s);
  const phase = time % cycleTime;
  const C = p.compliance / 1000;
  const R = p.resistance;
  const tau = R * C;

  // The ventilator targets PEEP + Pinsp at the airway. Intrinsic PEEP
  // reduces the effective driving pressure (and so VT) — it does NOT raise
  // PIP. Solve delivered volume and trapped volume together (fixed point).
  const fill = 1 - Math.exp(-iTime / tau);
  let autoPEEP = 0;
  let deliveredVol = 0;
  let trapped = 0;
  for (let k = 0; k < 12; k++) {
    deliveredVol = Math.max(0, s.pInsp - autoPEEP) * C * fill * 1000;
    trapped = calcTrappedVolume(s, p, deliveredVol);
    autoPEEP = (trapped / 1000) / C;
  }
  const driving = Math.max(0, s.pInsp - autoPEEP);

  if (phase < iTime) {
    const volume = trapped + driving * C * (1 - Math.exp(-phase / tau)) * 1000;
    const flow = (driving / R) * Math.exp(-phase / tau);
    const pressure = s.peep + s.pInsp;
    return { pressure, flow: flow * 60, volume };
  } else {
    const ePhase = phase - iTime;
    // Total-volume decay (see vcvWaveform) — no step at the breath boundary.
    const volume = (trapped + deliveredVol) * Math.exp(-ePhase / tau);
    const flow = -(volume / 1000) / tau;
    // Exhalation valve open: AIRWAY pressure sits at set PEEP. Alveolar
    // pressure (and so auto-PEEP) is hidden — it is only revealed by an
    // expiratory hold, which the measured auto-PEEP value represents.
    return { pressure: s.peep, flow: flow * 60, volume: Math.max(volume, 0) };
  }
}

function prvcWaveform(time: number, s: PRVCSettings, p: PatientPhysiology) {
  // PRVC auto-adjusts pressure to achieve target volume
  const C = p.compliance / 1000;
  const R = p.resistance;
  const tau = R * C;
  const iTime = getITime(s);

  const targetPressure = Math.min(
    (s.tidalVolume / 1000) / (C * (1 - Math.exp(-iTime / tau))),
    Math.max(0, s.pMax - s.peep) // Pmax is an absolute airway-pressure ceiling
  );

  const pcvLike: PCVLike = { ...pickCommon(s), pInsp: targetPressure };
  return pcvWaveform(time, pcvLike, p);
}

/**
 * SIMV breath schedule. Every set-rate cycle starts with a mandatory breath;
 * if the patient's own rate exceeds the set rate, the extra spontaneous
 * (pressure-supported) breaths are spaced evenly between mandatory ones.
 */
export function simvSchedule(s: CommonSettings, p: PatientPhysiology) {
  const cycleTime = 60 / s.respiratoryRate;
  const extra = p.spontaneousRate > 0
    ? Math.max(0, Math.round(p.spontaneousRate / s.respiratoryRate) - 1)
    : 0;
  const slots = extra + 1;
  return { cycleTime, slots, slotLen: cycleTime / slots, totalRate: s.respiratoryRate * slots };
}

function simvWaveform(time: number, s: SIMVSettings, p: PatientPhysiology) {
  const { cycleTime, slotLen } = simvSchedule(s, p);
  const phase = time % cycleTime;
  const slot = Math.floor(phase / slotLen);
  const slotPhase = phase - slot * slotLen;
  const slotRate = 60 / slotLen;

  if (slot === 0) {
    // Mandatory volume-controlled breath at the full set rate.
    const vcvLike: VCVLike = { ...pickCommon(s), respiratoryRate: slotRate, tidalVolume: s.tidalVolume };
    return vcvWaveform(slotPhase, vcvLike, p);
  }
  // Spontaneous pressure-supported breath between mandatory breaths.
  const psLike: PCVLike = { ...pickCommon(s), respiratoryRate: slotRate, ieRatio: 2, inspiratoryTime: 0, pInsp: s.pressureSupport };
  return pcvWaveform(slotPhase, psLike, p);
}

function psvWaveform(time: number, s: PSVSettings, p: PatientPhysiology) {
  // PSV needs patient effort: no respiratory drive ⇒ no breaths (apnoea).
  if (p.spontaneousRate <= 0) return { pressure: s.peep, flow: 0, volume: 0 };
  const rate = p.spontaneousRate > 0 ? p.spontaneousRate : 12;
  const psLike: PCVLike = {
    ...pickCommon(s),
    respiratoryRate: rate,
    ieRatio: 2,
    pInsp: s.pressureSupport,
  };
  const result = pcvWaveform(time, psLike, p);

  // Small negative deflection for patient trigger
  const cycleTime = 60 / rate;
  const phase = time % cycleTime;
  if (phase < 0.15) {
    result.pressure -= 1.5 * Math.sin(phase / 0.15 * Math.PI);
  }
  return result;
}

function aprvWaveform(time: number, s: APRVSettings, p: PatientPhysiology) {
  const totalCycle = Math.max(0.2, s.tHigh + s.tLow); // guard against % 0 → NaN
  const phase = time % totalCycle;
  const C = p.compliance / 1000;
  const R = p.resistance;
  const tau = R * C;
  // Exhalation is passive through the ETT + expiratory limb, so the
  // expiratory time constant is longer than the inspiratory one (as on
  // real machines, where release flow decays more slowly than it rose).
  const tauE = tau * 1.25;

  // Tuned to Dräger Evita / V500 APRV defaults: pressure "Slope" (ramp) of
  // 0.2 s back up to P High, and an expiratory valve that dumps to P Low in
  // ~30 ms. The cycle-back marker sits at phase 0 = start of the Dräger ramp.
  const RISE = 0.2;
  const VALVE = 0.03;

  // Closed-form steady state keeps the waveform a pure function of time.
  const volMax = (s.pHigh - s.pLow) * C * 1000; // ml above P Low equilibrium
  const kH = Math.exp(-s.tHigh / tau);
  const kL = Math.exp(-s.tLow / tauE);
  const vee = volMax * (1 - kH) * kL / Math.max(1e-6, 1 - kH * kL); // end-expiratory volume (auto-PEEP)

  if (phase < s.tHigh) {
    const volume = volMax * (1 - Math.exp(-phase / tau)) + vee * Math.exp(-phase / tau);
    const ramp = Math.min(1, phase / RISE);
    const smooth = ramp * ramp * (3 - 2 * ramp); // ease-in/out leading edge
    const pressure = s.pLow + (s.pHigh - s.pLow) * smooth;
    const flow = ((s.pHigh - s.pLow) / R) * Math.exp(-phase / tau) * 60 * smooth;
    return { pressure, flow, volume };
  } else {
    const ePhase = phase - s.tHigh;
    const vend = volMax * (1 - kH) + vee * kH; // volume at the moment of release
    const volume = vend * Math.exp(-ePhase / tauE);
    const open = 1 - Math.exp(-ePhase / (VALVE / 3));
    const flow = -(volume / 1000) / tauE * 60 * open;
    const pressure = s.pLow + (s.pHigh - s.pLow) * Math.exp(-ePhase / (VALVE / 3));
    return { pressure, flow, volume: Math.max(volume, 0) };
  }
}

function pickCommon(s: CommonSettings): CommonSettings {
  return {
    peep: s.peep,
    fio2: s.fio2,
    respiratoryRate: s.respiratoryRate,
    ieRatio: s.ieRatio,
    inspiratoryTime: s.inspiratoryTime,
  };
}

// Re-exports so the type surface for waveform callers is complete.
export type { VCVSettings, PCVSettings };

// --- Patient Monitor Waveforms ---

/** Beat-relative timing shared by ECG, arterial line and pleth. */
export interface BeatTime {
  /** Seconds since the start of the current beat. */
  t0: number;
  /** Length of the current beat (s), a whole number of 50 Hz samples. */
  cycle: number;
}

/**
 * Stateful cardiac clock (one per live simulator). The beat length is fixed
 * at the START of each beat, so heart-rate changes take effect on the next
 * beat instead of shifting the phase mid-beat — no truncated/double QRS
 * complexes however long the simulation runs. Beat lengths are whole
 * samples, so every beat is sampled identically (no pseudo-alternans).
 */
export class CardiacClock {
  private n = 0;
  private cycleSamples = 0;
  next(hr: number): BeatTime {
    if (this.n >= this.cycleSamples) {
      this.n = 0;
      this.cycleSamples = Math.max(1, Math.round((60 / Math.max(20, hr)) * SAMPLE_RATE));
    }
    const bt = { t0: this.n / SAMPLE_RATE, cycle: this.cycleSamples / SAMPLE_RATE };
    this.n++;
    return bt;
  }
  reset(): void { this.n = 0; this.cycleSamples = 0; }
}

/** Stateless beat time from absolute time (legacy/tests): grid-snapped beats. */
export function beatTimeAt(time: number, hr: number): BeatTime {
  const cycleSamples = Math.max(1, Math.round((60 / hr) * SAMPLE_RATE));
  const cycle = cycleSamples / SAMPLE_RATE;
  const beatIndex = Math.floor(Math.round(time * SAMPLE_RATE * 1e6) / 1e6 / cycleSamples);
  return { t0: time - beatIndex * cycle, cycle };
}

// Electromechanical timing relative to beat start (P-wave onset):
const R_PEAK = 0.225;          // s (scaled by k at fast rates)
const ABP_DELAY = 0.18;        // R-wave → radial upstroke (pre-ejection + pulse transit)
const PLETH_DELAY = 0.30;      // R-wave → finger pleth upstroke

function systoleScale(cycle: number): number {
  // Systole compresses only mildly at fast rates; diastole absorbs the rest.
  return Math.min(1, cycle / 0.8);
}

export function ecgAtBeat({ t0, cycle }: BeatTime): number {
  // P wave and QRS have fixed timing (QRS width doesn't change with rate),
  // so every beat's QRS is sampled identically whatever the heart rate —
  // no beat-to-beat amplitude change that could mimic electrical alternans.
  // Only the T wave (QT interval) moves earlier as the rate rises.
  const k = systoleScale(cycle);
  const g = (centre: number, sigma: number) =>
    Math.exp(-((t0 - centre) ** 2) / (2 * sigma ** 2));
  const p = 0.15 * g(0.10, 0.032);
  const q = -0.12 * g(0.185, 0.016);
  const r = 1.0 * g(R_PEAK, 0.046);
  const s = -0.20 * g(0.275, 0.018);
  const tw = 0.30 * g(0.30 + 0.12 * k, Math.max(0.045, 0.070 * k));
  return p + q + r + s + tw;
}

/** Phase (0–1) of a pulse wave whose upstroke lags the R wave by `delay`. */
function pulsePhase({ t0, cycle }: BeatTime, delay: number): number {
  const onset = R_PEAK + delay * systoleScale(cycle);
  const tt = (((t0 - onset) % cycle) + cycle) % cycle;
  return tt / cycle;
}

export function abpAtBeat(bt: BeatTime, sbp: number, dbp: number): number {
  const phase = pulsePhase(bt, ABP_DELAY);
  const pp = sbp - dbp;
  if (phase < 0.1) {
    return dbp + pp * Math.sin((phase / 0.1) * Math.PI * 0.5);
  } else if (phase < 0.15) {
    return sbp - pp * 0.15 * ((phase - 0.1) / 0.05);
  } else if (phase < 0.2) {
    const notchPhase = (phase - 0.15) / 0.05;
    return (sbp - pp * 0.15) - pp * 0.08 * Math.sin(notchPhase * Math.PI);
  } else {
    const decayPhase = (phase - 0.2) / 0.8;
    const start = sbp - pp * 0.15; // continuous with end of dicrotic notch
    return dbp + (start - dbp) * Math.exp(-decayPhase * 4);
  }
}

export function plethAtBeat(bt: BeatTime): number {
  const phase = pulsePhase(bt, PLETH_DELAY);
  if (phase < 0.25) {
    return Math.sin((phase / 0.25) * Math.PI * 0.5);
  } else if (phase < 0.35) {
    return 1.0 - 0.15 * ((phase - 0.25) / 0.1);
  } else {
    return 0.85 * Math.exp(-((phase - 0.35) / 0.65) * 3);
  }
}

// Time-based wrappers (legacy callers & tests).
export function generateECG(time: number, hr: number): number {
  return ecgAtBeat(beatTimeAt(time, hr));
}
export function generateABP(time: number, hr: number, sbp: number, dbp: number): number {
  return abpAtBeat(beatTimeAt(time, hr), sbp, dbp);
}
export function generateSpO2Pleth(time: number, hr: number): number {
  return plethAtBeat(beatTimeAt(time, hr));
}

export function generateCapnography(time: number, rr: number, etco2: number, spontaneousRate: number = 0): number {
  if (!(rr > 0)) return 0; // apnoea — no exhaled CO₂
  const cycleTime = 60 / rr;
  const phase = (time % cycleTime) / cycleTime;
  const iRatio = 1 / 3;
  const dropDuration = 0.04;

  if (phase < dropDuration) {
    return etco2 * (1 - phase / dropDuration);
  } else if (phase < iRatio) {
    return 0;
  } else {
    const ePhase = (phase - iRatio) / (1 - iRatio);
    let co2: number;
    if (ePhase < 0.08) {
      co2 = etco2 * 0.75 * (ePhase / 0.08);
    } else if (ePhase < 0.9) {
      co2 = etco2 * (0.75 + 0.25 * ((ePhase - 0.08) / 0.82));
    } else {
      co2 = etco2;
    }

    if (spontaneousRate > 0 && ePhase >= 0.3 && ePhase <= 0.65) {
      const cleftCenter = 0.475;
      const cleftWidth = 0.12;
      const cleftPos = (ePhase - cleftCenter) / cleftWidth;
      if (Math.abs(cleftPos) < 1) {
        const cleftDepth = Math.min(0.25, spontaneousRate / 60) * etco2;
        co2 -= cleftDepth * (0.5 + 0.5 * Math.cos(cleftPos * Math.PI));
      }
    }

    return co2;
  }
}

