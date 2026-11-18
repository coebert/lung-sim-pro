import { computeIE, APRV_EXP_TAU_FACTOR, deadSpaceMl } from './scoring';
import { PatientPhysiology, VentSettings, CommonSettings, VCVSettings, PCVSettings, PRVCSettings, SIMVSettings, PSVSettings, APRVSettings } from './types';

const SAMPLE_RATE = 50; // Hz — ECG beat phase is locked to this sample grid

// ─── Single-compartment RC lung, periodic steady state ──────────────
//
// Every breath obeys the equation of motion
//     Paw(t) + Pmus(t) − PEEP = V/C + R·V̇
// with V = lung volume above the end-expiratory equilibrium at set PEEP.
// The system is linear, so one breath maps the start volume V0 to the end
// volume affinely: V_end = a·V0 + b. Steady state is the fixed point
// V0 = b / (1 − a), which is solved in closed form (no iteration). Volume is
// carried continuously through every phase change, and flow is always
// derived from the same state and pressure boundary conditions.

/** Patient trigger phase (s) before a supported/spontaneous breath starts. */
export const SPONT_TRIGGER = 0.12;

const lungC = (p: PatientPhysiology) => p.compliance / 1000; // L/cmH₂O
const lungTau = (p: PatientPhysiology) => p.resistance * lungC(p);

/** Zero-state volume (L) for a pressure that ramps 0→D over `tr`, then holds. */
function rampFill(t: number, D: number, tr: number, C: number, tau: number): number {
  if (D === 0 || t <= 0) return 0;
  if (tr <= 1e-3) return D * C * (1 - Math.exp(-t / tau));
  if (t <= tr) return C * (D / tr) * (t - tau * (1 - Math.exp(-t / tau)));
  const v1 = C * (D / tr) * (tr - tau * (1 - Math.exp(-tr / tau)));
  return C * D - (C * D - v1) * Math.exp(-(t - tr) / tau);
}

/** Generic breath description used by every conventional mode. */
interface BreathSpec {
  kind: 'volume' | 'pressure';
  cycle: number;           // s, total breath length
  ti: number;              // s, inspiratory time (including trigger phase)
  /** Volume breath: set VT (mL). */
  vt?: number;
  /** Pressure breath: target above PEEP (cmH₂O), rise (s), delay before the ventilator pressurises (s). */
  D?: number;
  tr?: number;
  delay?: number;
  /** Patient inspiratory effort (cmH₂O, step over Ti). */
  pmus?: number;
}

/** End-inspiratory and end-expiratory volume (mL) from start volume V0 (mL). */
function breathMap(b: BreathSpec, p: PatientPhysiology) {
  const C = lungC(p), tau = lungTau(p);
  const kI = Math.exp(-b.ti / tau);
  const kE = Math.exp(-Math.max(0, b.cycle - b.ti) / tau);
  if (b.kind === 'volume') {
    // Constant flow is set by the machine: start volume does not alter delivery.
    return { aI: 1, bI: b.vt ?? 0, kE };
  }
  const delay = b.delay ?? 0;
  const fill = (rampFill(b.ti - delay, b.D ?? 0, Math.min(b.tr ?? 0, b.ti - delay), C, tau)
    + rampFill(b.ti, b.pmus ?? 0, 0, C, tau)) * 1000;
  return { aI: kI, bI: fill, kE };
}

/** Steady-state start volume of each breath in a repeating sequence. */
function periodicStarts(seq: BreathSpec[], p: PatientPhysiology): number[] {
  let A = 1, B = 0;
  for (const b of seq) {
    const m = breathMap(b, p);
    // V_end = kE·(aI·V0 + bI)
    A = A * m.aI * m.kE;
    B = (B * m.aI + m.bI) * m.kE;
  }
  const v0 = A < 1 ? B / (1 - A) : 0;
  const starts: number[] = [];
  let v = v0;
  for (const b of seq) {
    starts.push(v);
    const m = breathMap(b, p);
    v = (v * m.aI + m.bI) * m.kE;
  }
  return starts;
}

/** Evaluate pressure/flow/volume at `phase` within breath `b` that starts at volume v0 (mL). */
function evalBreath(phase: number, b: BreathSpec, v0: number, peep: number, p: PatientPhysiology): { pressure: number; flow: number; volume: number } {
  const C = lungC(p), R = p.resistance, tau = lungTau(p);
  if (phase < b.ti) {
    if (b.kind === 'volume') {
      const q = ((b.vt ?? 0) / 1000) / b.ti; // L/s
      const volume = v0 + q * phase * 1000;
      return { pressure: peep + (volume / 1000) / C + q * R, flow: q * 60, volume };
    }
    const delay = b.delay ?? 0;
    const tp = phase - delay;
    const trEff = Math.min(b.tr ?? 0, b.ti - delay);
    const ramp = tp <= 0 ? 0 : trEff > 1e-3 ? Math.min(1, tp / trEff) : 1;
    const paw = (b.D ?? 0) * ramp;
    const vL = (v0 / 1000) * Math.exp(-phase / tau)
      + rampFill(tp, b.D ?? 0, trEff, C, tau) + rampFill(phase, b.pmus ?? 0, 0, C, tau);
    const flow = (paw + (b.pmus ?? 0) - vL / C) / R; // L/s, same state as volume
    // Patient effort pulls airway pressure slightly below PEEP before the trigger.
    const dip = delay > 0 && tp < 0 ? 1.5 * Math.sin((phase / delay) * Math.PI) : 0;
    return { pressure: peep + paw - dip, flow: flow * 60, volume: vL * 1000 };
  }
  const end = evalBreath(b.ti - 1e-9, b, v0, peep, p).volume;
  const volume = end * Math.exp(-(phase - b.ti) / tau);
  // Exhalation valve open: airway pressure sits at set PEEP.
  return { pressure: peep, flow: -(volume / 1000) / tau * 60, volume };
}

// --- Ventilator Waveforms ---

export function generateVentWaveformPoint(
  time: number,
  settings: VentSettings,
  patient: PatientPhysiology
): { pressure: number; flow: number; volume: number } {
  if (settings.mode === 'APRV') return aprvWaveform(time, settings, patient);
  const { seq, cycle } = breathSequence(settings, patient);
  if (seq.length === 0) return { pressure: settings.peep, flow: 0, volume: 0 };
  const starts = periodicStarts(seq, patient);
  let phase = ((time % cycle) + cycle) % cycle;
  for (let i = 0; i < seq.length; i++) {
    if (phase < seq[i].cycle || i === seq.length - 1) return evalBreath(phase, seq[i], starts[i], settings.peep, patient);
    phase -= seq[i].cycle;
  }
  return { pressure: settings.peep, flow: 0, volume: 0 };
}

/** Kind of breath in progress at `time` (for breath-by-breath measurement). */
export function breathKindAt(time: number, settings: VentSettings, patient: PatientPhysiology): 'mandatory' | 'support' {
  if (settings.mode === 'PSV') return 'support';
  if (settings.mode !== 'SIMV') return 'mandatory';
  const { cycleTime, slotLen } = simvSchedule(settings, patient);
  return Math.floor((time % cycleTime) / slotLen) === 0 ? 'mandatory' : 'support';
}

/** Resolve inspiratory time: prefer explicit Ti, fall back to I:E ratio */
function getITime(s: CommonSettings): number {
  return computeIE(s).iTime; // single source of truth, capped to cycle − 0.1 s
}

/**
 * Patient inspiratory effort (cmH₂O) that alone produces the profile's
 * documented spontaneous tidal volume over inspiratory time `ti` in a
 * breath of length `cycle`. Zero for paralysed patients.
 */
export function patientEffort(p: PatientPhysiology, ti: number, cycle: number): number {
  if (p.spontaneousRate <= 0 || p.spontaneousTidalVolume <= 0) return 0;
  const C = lungC(p), tau = lungTau(p);
  const kI = Math.exp(-ti / tau), kE = Math.exp(-Math.max(0, cycle - ti) / tau);
  const perCm = C * (1 - kI) * 1000 * (1 - kE) / Math.max(1e-6, 1 - kI * kE); // mL VT per cmH₂O
  return p.spontaneousTidalVolume / Math.max(1e-6, perCm);
}

function breathSequence(s: Exclude<VentSettings, APRVSettings>, p: PatientPhysiology): { seq: BreathSpec[]; cycle: number } {
  switch (s.mode) {
    case 'VCV': {
      const cycle = 60 / s.respiratoryRate;
      return { cycle, seq: [{ kind: 'volume', cycle, ti: getITime(s), vt: s.tidalVolume }] };
    }
    case 'PCV': {
      const cycle = 60 / s.respiratoryRate;
      return { cycle, seq: [{ kind: 'pressure', cycle, ti: getITime(s), D: s.pInsp, tr: s.riseTime }] };
    }
    case 'PRVC': {
      const cycle = 60 / s.respiratoryRate;
      const { pInsp } = prvcInspPressure(s, p);
      return { cycle, seq: [{ kind: 'pressure', cycle, ti: getITime(s), D: pInsp, tr: s.riseTime }] };
    }
    case 'PSV': {
      // PSV needs patient effort: no respiratory drive ⇒ no breaths (apnoea).
      if (p.spontaneousRate <= 0) return { cycle: 1, seq: [] };
      const cycle = 60 / p.spontaneousRate;
      const ti = SPONT_TRIGGER + psvInspTime(s, p);
      return { cycle, seq: [{ kind: 'pressure', cycle, ti, D: s.pressureSupport, tr: s.riseTime, delay: SPONT_TRIGGER, pmus: patientEffort(p, ti, cycle) }] };
    }
    case 'SIMV': {
      const { cycleTime, slots, slotLen } = simvSchedule(s, p);
      const mandTi = getITime({ ...pickCommon(s), respiratoryRate: 60 / slotLen });
      const seq: BreathSpec[] = [{ kind: 'volume', cycle: slotLen, ti: mandTi, vt: s.tidalVolume }];
      const ti = SPONT_TRIGGER + simvSupportInspTime(s, p);
      for (let i = 1; i < slots; i++) {
        seq.push({ kind: 'pressure', cycle: slotLen, ti, D: s.pressureSupport, tr: s.riseTime, delay: SPONT_TRIGGER, pmus: patientEffort(p, ti, slotLen) });
      }
      return { cycle: cycleTime, seq };
    }
  }
}

/** Reserve below Pmax that PRVC keeps (educational convention modelled on common ICU ventilators). */
export const PRVC_PMAX_RESERVE = 5;

/**
 * PRVC (Autoflow / VC+): the ventilator regulates inspiratory pressure
 * breath-to-breath so the delivered steady-state VT meets the target,
 * never exceeding Pmax − 5 cmH₂O. Returns Pinsp above PEEP.
 * Uses the same periodic RC solution and effective rise time as the waveform.
 */
export function prvcInspPressure(s: PRVCSettings, p: PatientPhysiology) {
  const C = lungC(p), tau = lungTau(p);
  const iTime = getITime(s);
  const cycleTime = 60 / s.respiratoryRate;
  const kI = Math.exp(-iTime / tau), kE = Math.exp(-Math.max(0, cycleTime - iTime) / tau);
  const fillPerCm = rampFill(iTime, 1, Math.min(s.riseTime, iTime), C, tau) * 1000; // mL per cmH₂O, zero state
  const vtPerCm = fillPerCm * (1 - kE) / Math.max(1e-6, 1 - kI * kE);
  const needed = s.tidalVolume / Math.max(1e-6, vtPerCm);
  const ceiling = Math.max(0, s.pMax - PRVC_PMAX_RESERVE - s.peep);
  /** Pmax leaves no room above PEEP: no breath can be delivered. */
  const conflict = s.pMax - PRVC_PMAX_RESERVE <= s.peep;
  return { pInsp: Math.min(needed, ceiling), limited: needed > ceiling, needed, ceiling, conflict };
}

/**
 * PSV inspiratory time is set by the PATIENT's lung, not a timer: the breath
 * cycles off when flow decays to ETS % of its peak. Flow peaks at the end of
 * the rise and then decays with τ = R·C, so Ti = Tr + τ·ln(100/ETS).
 * High resistance (long τ) ⇒ long Ti; ventilators cap Ti for safety.
 */
export function psvInspTime(s: PSVSettings, p: PatientPhysiology): number {
  return flowCycledTi(s.riseTime, s.ets, p, 60 / Math.max(1, p.spontaneousRate));
}

/** Shared flow-cycling rule for any pressure-support breath. */
function flowCycledTi(riseTime: number, ets: number, p: PatientPhysiology, cycleTime: number): number {
  const tau = lungTau(p);
  const ti = riseTime + tau * Math.log(100 / Math.min(90, Math.max(5, ets)));
  return Math.max(0.3, Math.min(ti, 2.5, cycleTime - 0.3 - SPONT_TRIGGER));
}

/** Ti of SIMV's spontaneous pressure-support breaths (flow-cycled at ETS). */
export function simvSupportInspTime(s: SIMVSettings, p: PatientPhysiology): number {
  return flowCycledTi(s.riseTime, s.ets, p, simvSchedule(s, p).slotLen);
}

/**
 * SIMV breath schedule. Every set-rate cycle starts with a mandatory breath;
 * if the patient's own rate exceeds the set rate, the extra spontaneous
 * (pressure-supported) breaths are spaced evenly between mandatory ones.
 * Limitation: the spontaneous count per cycle is rounded, so the patient's
 * rate is approximated in steps of the set rate.
 */
export function simvSchedule(s: CommonSettings, p: PatientPhysiology) {
  const cycleTime = 60 / s.respiratoryRate;
  const extra = p.spontaneousRate > 0
    ? Math.max(0, Math.round(p.spontaneousRate / s.respiratoryRate) - 1)
    : 0;
  const slots = extra + 1;
  return { cycleTime, slots, slotLen: cycleTime / slots, totalRate: s.respiratoryRate * slots };
}

// ─── APRV: one RC trajectory for pressure, flow and volume ──────────
// Tuned to Dräger Evita / V500 APRV defaults: pressure "Slope" of 0.2 s back
// up to P High, and an expiratory valve that dumps to P Low in ~30 ms.
// The release is passive through the ETT + expiratory limb, so expiratory
// resistance (and τ) is APRV_EXP_TAU_FACTOR × inspiratory. Spontaneous
// breathing during P High is NOT modelled (release ventilation only).
const APRV_RISE = 0.2;
const APRV_VALVE = 0.03;
const APRV_DT = 0.001;

interface AprvTable { dt: number; n: number; vol: Float64Array; pres: Float64Array; tHigh: number; cycle: number }
const aprvCache = new Map<string, AprvTable>();

function aprvPressure(t: number, s: APRVSettings): number {
  const d = s.pHigh - s.pLow;
  if (t < s.tHigh) {
    const r = Math.min(1, t / APRV_RISE);
    return s.pLow + d * r * r * (3 - 2 * r);
  }
  return s.pLow + d * Math.exp(-(t - s.tHigh) / (APRV_VALVE / 3));
}

function aprvTable(s: APRVSettings, p: PatientPhysiology): AprvTable {
  const cycle = Math.max(0.2, s.tHigh + s.tLow);
  const key = `${s.pHigh}|${s.pLow}|${s.tHigh}|${s.tLow}|${p.compliance}|${p.resistance}`;
  const hit = aprvCache.get(key);
  if (hit) return hit;
  const C = lungC(p), tau = lungTau(p), tauE = tau * APRV_EXP_TAU_FACTOR;
  const n = Math.max(2, Math.round(cycle / APRV_DT));
  const dt = cycle / n;
  // Exact step for piecewise-constant pressure: V → Veq + (V − Veq)·e^(−dt/τ).
  const step = (v: number, i: number) => {
    const tm = (i + 0.5) * dt;
    const veq = C * (aprvPressure(tm, s) - s.pLow) * 1000;
    const k = Math.exp(-dt / (tm < s.tHigh ? tau : tauE));
    return veq + (v - veq) * k;
  };
  let b = 0;
  for (let i = 0; i < n; i++) b = step(b, i);
  const a = Math.exp(-s.tHigh / tau) * Math.exp(-(cycle - s.tHigh) / tauE);
  const vol = new Float64Array(n + 1);
  const pres = new Float64Array(n + 1);
  vol[0] = a < 1 ? b / (1 - a) : 0;
  for (let i = 0; i < n; i++) { pres[i] = aprvPressure(i * dt, s); vol[i + 1] = step(vol[i], i); }
  pres[n] = pres[0];
  const table = { dt, n, vol, pres, tHigh: s.tHigh, cycle };
  if (aprvCache.size > 64) aprvCache.clear();
  aprvCache.set(key, table);
  return table;
}

function aprvWaveform(time: number, s: APRVSettings, p: PatientPhysiology) {
  const tb = aprvTable(s, p);
  const phase = ((time % tb.cycle) + tb.cycle) % tb.cycle;
  const x = phase / tb.dt;
  const i = Math.min(tb.n - 1, Math.floor(x));
  const f = x - i;
  const volume = tb.vol[i] + (tb.vol[i + 1] - tb.vol[i]) * f;
  // Flow is the exact derivative of the same volume trajectory (L/min).
  const flow = ((tb.vol[i + 1] - tb.vol[i]) / tb.dt) * 60 / 1000;
  return { pressure: aprvPressure(phase, s), flow, volume: Math.max(0, volume) };
}

/**
 * APRV release metrics from the same trajectory the waveform uses:
 * release volume, fraction of lung volume emptied, and end-release flow as a
 * percentage of peak expiratory flow (the T Low termination teaching cue).
 */
export function aprvReleaseMetrics(s: APRVSettings, p: PatientPhysiology) {
  const tb = aprvTable(s, p);
  const iRel = Math.round(tb.tHigh / tb.dt);
  const vRelease = tb.vol[iRel];
  const vEnd = tb.vol[tb.n];
  let peakExp = 0;
  for (let i = iRel; i < tb.n; i++) peakExp = Math.min(peakExp, (tb.vol[i + 1] - tb.vol[i]) / tb.dt);
  const endFlow = (tb.vol[tb.n] - tb.vol[tb.n - 1]) / tb.dt;
  return {
    releaseVolume: Math.max(0, vRelease - vEnd),
    releaseFraction: vRelease > 1e-6 ? (vRelease - vEnd) / vRelease : 0,
    endExpiratoryVolume: vEnd,
    peakExpFlow: -peakExp * 60 / 1000,
    endReleaseFlow: -endFlow * 60 / 1000,
    endToPeakFlowPct: peakExp < 0 ? Math.round((endFlow / peakExp) * 100) : 0,
  };
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

/** Teaching model of mainstream capnography (mmHg), not recorded clinical data.
 * Phase I is dead-space washout; II is mixed gas; III is an alveolar plateau.
 * Washout uses the same exhaled-volume curve as the ventilator, so short APRV
 * releases and small breaths need not reach a full plateau. No artificial
 * curare cleft is added merely because a patient has spontaneous drive.
 */
export function generateCapnography(time: number, settings: VentSettings, patient: PatientPhysiology, etco2: number): number {
  if (!Number.isFinite(time) || !Number.isFinite(etco2) || etco2 <= 0) return 0;
  if (settings.mode === 'PSV' && patient.spontaneousRate <= 0) return 0;

  let cycle = 60 / settings.respiratoryRate;
  let inspiration = getITime(settings);
  let phase = time % cycle;
  let start = time - phase;
  if (settings.mode === 'APRV') {
    cycle = Math.max(0.2, settings.tHigh + settings.tLow);
    phase = time % cycle;
    start = time - phase;
    inspiration = settings.tHigh;
  } else if (settings.mode === 'PSV') {
    cycle = 60 / patient.spontaneousRate;
    phase = time % cycle;
    start = time - phase;
    inspiration = SPONT_TRIGGER + psvInspTime(settings, patient);
  } else if (settings.mode === 'SIMV') {
    const schedule = simvSchedule(settings, patient);
    const slot = Math.floor((time % schedule.cycleTime) / schedule.slotLen);
    cycle = schedule.slotLen;
    phase = time % schedule.cycleTime - slot * cycle;
    start = time - phase;
    inspiration = slot === 0
      ? getITime({ ...settings, respiratoryRate: 60 / cycle })
      : SPONT_TRIGGER + simvSupportInspTime(settings, patient);
  }
  if (!(cycle > inspiration) || !Number.isFinite(cycle)) return 0;

  const deadSpace = deadSpaceMl(patient);
  const obstruction = Math.min(1, Math.max(0, (patient.resistance - 5) / 25));
  const mixingVolume = deadSpace * (0.3 + obstruction * 0.7);
  const plateauStart = 0.92 - obstruction * 0.22;
  const expirationShape = (breathStart: number, ti: number, breathCycle: number, elapsed: number): number => {
    const release = breathStart + ti;
    const vStart = generateVentWaveformPoint(release, settings, patient).volume;
    const vEnd = generateVentWaveformPoint(breathStart + breathCycle - 1e-6, settings, patient).volume;
    const vNow = generateVentWaveformPoint(release + elapsed, settings, patient).volume;
    const expired = Math.max(0, vStart - vNow);
    if (expired <= deadSpace) return 0;
    if (expired < deadSpace + mixingVolume) {
      const fraction = (expired - deadSpace) / mixingVolume;
      return etco2 * plateauStart * fraction;
    }
    const available = Math.max(1, vStart - vEnd - deadSpace - mixingVolume);
    const progress = Math.min(1, (expired - deadSpace - mixingVolume) / available);
    return etco2 * (plateauStart + (1 - plateauStart) * progress);
  };

  if (phase >= inspiration) return expirationShape(start, inspiration, cycle, phase - inspiration);
  // Phase 0: fresh inspired gas clears the sensor. At initial startup there
  // is no preceding exhalation, so never invent an end-tidal spike.
  const dropTime = Math.min(0.10, inspiration * 0.25);
  if (start <= 0 || phase >= dropTime) return 0;
  let previousTi = inspiration;
  if (settings.mode === 'SIMV') {
    const schedule = simvSchedule(settings, patient);
    const previousSlot = Math.floor(((start - 1e-6) % schedule.cycleTime) / cycle);
    previousTi = previousSlot === 0
      ? getITime({ ...settings, respiratoryRate: 60 / cycle })
      : SPONT_TRIGGER + simvSupportInspTime(settings, patient);
  }
  const endTidal = expirationShape(start - cycle, previousTi, cycle, cycle - previousTi - 1e-6);
  return endTidal * Math.max(0, 1 - phase / dropTime);
}

