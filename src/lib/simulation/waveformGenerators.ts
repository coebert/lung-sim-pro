import { computeIE, deadSpaceMl } from './scoring';
import { PatientPhysiology, VentSettings, CommonSettings, VCVSettings, PCVSettings, PRVCSettings, SIMVSettings, PSVSettings, APRVSettings } from './types';
import { aprvPoint, neuralTi } from './aprvTrajectory';
export { aprvReleaseMetrics } from './aprvTrajectory';

const SAMPLE_RATE = 50; // Hz — ECG beat phase is locked to this sample grid

// ─── Single-compartment RC lung ─────────────────────────────────────
//
// Every breath obeys the equation of motion
//     Paw(t) + Pmus(t) − PEEP = V/C + R·V̇
// with V = lung volume above the end-expiratory equilibrium at set PEEP.
// Machine-timed modes (VCV/PCV/PRVC) are periodic and solved in closed form
// (affine start→end map, fixed point). Patient-triggered modes (PSV, SIMV)
// are built as an event timeline on the patient's own effort clock, with
// volume carried breath to breath, so intervals need not be equal.

/** Patient trigger phase (s) between effort onset and ventilator pressurisation. */
export const SPONT_TRIGGER = 0.12;
/** Ventilator trigger lock-out after inspiration ends (s). */
export const TRIGGER_LOCKOUT = 0.25;

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

/** Zero-state response (L) to a muscle-pressure step `amp` lasting `dur`, at time s after onset. */
function pulseFill(s: number, amp: number, dur: number, C: number, tau: number): number {
  if (s <= 0 || amp === 0) return 0;
  if (s <= dur) return amp * C * (1 - Math.exp(-s / tau));
  return amp * C * (1 - Math.exp(-dur / tau)) * Math.exp(-(s - dur) / tau);
}

export type BreathKind = 'mandatory' | 'support' | 'spontaneous';
export type TriggerSource = 'time' | 'patient' | 'auto';

/** Generic breath description used by every conventional mode. */
interface BreathSpec {
  kind: 'volume' | 'pressure';
  cycle: number;           // s, breath length (open-ended breaths use Infinity)
  ti: number;              // s, inspiratory time (including trigger phase)
  vt?: number;             // volume breath: delivered VT (mL)
  D?: number; tr?: number; delay?: number; // pressure breath target, rise, delay
  pmus?: number;           // patient effort (cmH₂O) step from breath start
  pmusDur?: number;        // its duration (s); defaults to Ti
  /** Failed (untriggered) efforts during expiration: onset (s from breath start), duration, amplitude. */
  pulses?: { t0: number; dur: number; amp: number }[];
  limited?: boolean;       // volume breath terminated at the pressure limit
}

/** End-inspiratory volume (mL) from start volume v0 (mL). */
function endInsp(b: BreathSpec, v0: number, p: PatientPhysiology): number {
  return evalBreath(b.ti - 1e-9, b, v0, 0, p).volume;
}

/** Evaluate pressure/flow/volume at `phase` within breath `b` starting at volume v0 (mL). */
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
    const pm = b.pmus ?? 0;
    const pd = b.pmusDur ?? b.ti;
    const vL = (v0 / 1000) * Math.exp(-phase / tau)
      + rampFill(tp, b.D ?? 0, trEff, C, tau) + pulseFill(phase, pm, pd, C, tau);
    const flow = (paw + (phase < pd ? pm : 0) - vL / C) / R; // L/s, same state as volume
    // Patient effort pulls airway pressure slightly below PEEP before the trigger.
    const dip = delay > 0 && tp < 0 ? 1.5 * Math.sin((phase / delay) * Math.PI) : 0;
    return { pressure: peep + paw - dip, flow: flow * 60, volume: vL * 1000 };
  }
  // Expiration: passive decay from end-inspiration plus any failed efforts.
  const end = b.kind === 'volume' ? v0 + (b.vt ?? 0) : evalBreath(b.ti - 1e-9, { ...b, pulses: undefined }, v0, 0, p).volume;
  const e = phase - b.ti;
  let vL = (end / 1000) * Math.exp(-e / tau);
  let pm = 0;
  for (const u of b.pulses ?? []) {
    const s = phase - u.t0;
    vL += pulseFill(s, u.amp, u.dur, C, tau);
    if (s > 0 && s < u.dur) pm += u.amp;
  }
  // Exhalation valve open: airway pressure sits at set PEEP.
  return { pressure: peep, flow: ((pm - vL / C) / R) * 60, volume: vL * 1000 };
}

/** Patient inspiratory effort (cmH₂O step over `ti`) that alone gives the documented spontaneous VT. */
export function patientEffort(p: PatientPhysiology, ti: number, cycle: number): number {
  if (p.spontaneousRate <= 0 || p.spontaneousTidalVolume <= 0) return 0;
  const C = lungC(p), tau = lungTau(p);
  const kI = Math.exp(-ti / tau), kE = Math.exp(-Math.max(0, cycle - ti) / tau);
  const perCm = C * (1 - kI) * 1000 * (1 - kE) / Math.max(1e-6, 1 - kI * kE); // mL VT per cmH₂O
  return p.spontaneousTidalVolume / Math.max(1e-6, perCm);
}

/** Resolve inspiratory time: prefer explicit Ti, fall back to I:E ratio */
function getITime(s: CommonSettings): number {
  return computeIE(s).iTime; // single source of truth, capped to cycle − 0.1 s
}

// ─── Periodic machine-timed breaths (VCV / PCV / PRVC) ──────────────

/**
 * VCV with a high-pressure limit: a breath whose airway pressure reaches
 * `pLimit` is terminated there (pressure-limit cycling). Periodic steady
 * state is solved by bisection on the monotone start-volume equation.
 */
export function vcvBreath(s: CommonSettings & { tidalVolume: number; pLimit?: number }, p: PatientPhysiology) {
  const cycle = 60 / s.respiratoryRate, ti = getITime(s);
  const C = lungC(p), tau = lungTau(p), R = p.resistance;
  const q = (s.tidalVolume / 1000) / ti;
  const kE = Math.exp(-(cycle - ti) / tau);
  const v0Free = s.tidalVolume * kE / (1 - kE);
  const peakFree = s.peep + ((v0Free + s.tidalVolume) / 1000) / C + q * R;
  const limit = s.pLimit ?? Infinity;
  if (!(peakFree >= limit)) return { spec: { kind: 'volume' as const, cycle, ti, vt: s.tidalVolume }, v0: v0Free, limited: false };
  // End-inspiratory volume when limited: Paw = limit ⇒ V = (limit − PEEP − qR)·C.
  const vLim = Math.max(0, (limit - s.peep - q * R) * C * 1000);
  const f = (v0: number) => vLim * Math.exp(-(cycle - Math.max(0, (vLim - v0) / (q * 1000))) / tau) - v0;
  let lo = 0, hi = vLim;
  if (vLim <= 0 || f(0) <= 0) return { spec: { kind: 'volume' as const, cycle, ti: 1e-3, vt: 0, limited: true }, v0: 0, limited: true };
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; }
  const v0 = (lo + hi) / 2;
  const tCut = Math.max(1e-3, (vLim - v0) / (q * 1000));
  return { spec: { kind: 'volume' as const, cycle, ti: tCut, vt: q * tCut * 1000, limited: true }, v0, limited: true };
}

function periodicPressure(cycle: number, b: BreathSpec, p: PatientPhysiology) {
  const tau = lungTau(p);
  const kI = Math.exp(-b.ti / tau), kE = Math.exp(-Math.max(0, cycle - b.ti) / tau);
  const fill = endInsp(b, 0, p);
  return fill * kE / Math.max(1e-9, 1 - kI * kE);
}

/** Reserve below Pmax that PRVC keeps (educational convention modelled on common ICU ventilators). */
export const PRVC_PMAX_RESERVE = 5;

/**
 * PRVC (Autoflow / VC+): regulates inspiratory pressure so the steady-state
 * VT meets the target, never exceeding Pmax − 5 cmH₂O. Returns Pinsp above PEEP.
 */
const prvcGainCache = new Map<string, number>();

/**
 * Exhaled tidal volume (mL) per cmH₂O of inspiratory pressure for the exact
 * periodic pressure breath the generator plays (same spec, same rise, same
 * carried start volume): steady-state peak minus trough of the volume trace,
 * found from the forward/reverse flow zero crossings at 1 ms resolution.
 * Volume is linear in the driving pressure, so one unit breath calibrates PRVC.
 */
export function pressureBreathGain(cycle: number, ti: number, tr: number, p: PatientPhysiology): number {
  const key = [cycle, ti, tr, p.compliance, p.resistance, lungTau(p)].join('|');
  const hit = prvcGainCache.get(key);
  if (hit !== undefined) return hit;
  const spec: BreathSpec = { kind: 'pressure', cycle, ti, D: 1, tr };
  const v0 = periodicPressure(cycle, spec, p);
  const dt = 0.001;
  let vMax = -Infinity, vMin = Infinity;
  for (let t = 0; t < cycle; t += dt) {
    const v = evalBreath(t, spec, v0, 0, p).volume;
    if (v > vMax) vMax = v;
    if (v < vMin) vMin = v;
  }
  const g = Math.max(0, vMax - vMin);
  if (prvcGainCache.size > 500) prvcGainCache.clear();
  prvcGainCache.set(key, g);
  return g;
}

/**
 * PRVC (Autoflow / VC+): regulates inspiratory pressure so the steady-state
 * exhaled VT (trough → peak of the delivered breath) meets the target, never
 * exceeding Pmax − 5 cmH₂O. Returns Pinsp above PEEP.
 */
export function prvcInspPressure(s: PRVCSettings, p: PatientPhysiology) {
  const iTime = getITime(s);
  const cycleTime = 60 / s.respiratoryRate;
  const vtPerCm = pressureBreathGain(cycleTime, iTime, s.riseTime, p);
  const needed = s.tidalVolume / Math.max(1e-6, vtPerCm);
  const ceiling = Math.max(0, s.pMax - PRVC_PMAX_RESERVE - s.peep);
  const conflict = s.pMax - PRVC_PMAX_RESERVE <= s.peep;
  return { pInsp: Math.min(needed, ceiling), limited: needed > ceiling, needed, ceiling, conflict };
}

// ─── Patient-triggered timeline (PSV / SIMV) ────────────────────────

interface TimelineBreath { start: number; spec: BreathSpec; v0: number; kind: BreathKind; trigger: TriggerSource }
interface Timeline {
  breaths: TimelineBreath[];
  /** Patient efforts: `sensed` false when they fell in inspiration/lock-out. */
  efforts: { t: number; triggered: boolean; sensed: boolean }[];
  /** Time up to which events are final. */
  built: number;
  // generator state
  nextEffort: number;
  mandWindowDone: number; // index of last SIMV window with a mandatory breath
}

const timelines = new Map<string, Timeline>();

function timelineKey(s: PSVSettings | SIMVSettings, p: PatientPhysiology): string {
  return JSON.stringify([s, p.id, p.compliance, p.resistance, p.spontaneousRate, p.spontaneousTidalVolume, p.cardiogenicOscillation ?? 0, p.baseHR]);
}

/** Cardiogenic airway flow (L/min) and its volume (mL) — a ripple outside the lung equation. */
function cardiogenic(time: number, p: PatientPhysiology) {
  const a = p.cardiogenicOscillation ?? 0;
  if (!a) return { flow: 0, volume: 0 };
  const w = 2 * Math.PI * (p.baseHR / 60);
  return { flow: a * Math.sin(w * time), volume: (-(a / 60) / w) * Math.cos(w * time) * 1000 };
}

function supportSpec(s: PSVSettings | SIMVSettings, p: PatientPhysiology, patientTriggered: boolean): BreathSpec {
  const tp = 60 / Math.max(1, p.spontaneousRate);
  const ti = (patientTriggered ? SPONT_TRIGGER : 0) + flowCycledTi(s.riseTime, s.ets, p, tp);
  const nTi = neuralTi(tp);
  const amp = patientTriggered ? patientEffort(p, nTi, tp) : 0;
  return {
    kind: 'pressure', cycle: Infinity, ti, D: s.pressureSupport, tr: s.riseTime,
    delay: patientTriggered ? SPONT_TRIGGER : 0,
    // Patient effort lasts the neural Ti, which may outlast the supported Ti.
    pmus: amp, pmusDur: Math.min(nTi, ti),
    pulses: amp && nTi > ti ? [{ t0: ti, dur: nTi - ti, amp }] : undefined,
  };
}

function mandatorySpec(s: SIMVSettings, p: PatientPhysiology, v0: number): BreathSpec {
  const tm = 60 / s.respiratoryRate;
  const ti = getITime(s);
  const C = lungC(p), R = p.resistance;
  const q = (s.tidalVolume / 1000) / ti;
  // Pressure-limit cycling with the carried start volume.
  const tCut = ((s.pLimit - s.peep - q * R) * C * 1000 - v0) / (q * 1000);
  void tm;
  if (tCut < ti) {
    const t = Math.max(1e-3, tCut);
    return { kind: 'volume', cycle: Infinity, ti: t, vt: q * t * 1000, limited: true };
  }
  return { kind: 'volume', cycle: Infinity, ti, vt: s.tidalVolume };
}

function volumeAt(b: TimelineBreath, time: number, p: PatientPhysiology): number {
  return evalBreath(time - b.start, b.spec, b.v0, 0, p).volume;
}

function extendTimeline(tl: Timeline, s: PSVSettings | SIMVSettings, p: PatientPhysiology, until: number) {
  const tp = p.spontaneousRate > 0 ? 60 / p.spontaneousRate : Infinity;
  const simv = s.mode === 'SIMV';
  const tm = simv ? 60 / s.respiratoryRate : Infinity;
  const effortAmp = p.spontaneousRate > 0 ? patientEffort(p, neuralTi(tp), tp) : 0;
  const R = p.resistance;
  const addBreath = (start: number, kind: BreathKind, trigger: TriggerSource, patientTriggered: boolean) => {
    const prev = tl.breaths[tl.breaths.length - 1];
    const v0 = prev ? volumeAt(prev, start, p) : 0;
    if (prev) prev.spec.cycle = start - prev.start;
    const spec = kind === 'mandatory' && simv ? mandatorySpec(s as SIMVSettings, p, v0) : supportSpec(s, p, patientTriggered);
    tl.breaths.push({ start, spec, v0, kind, trigger });
  };
  if (tl.breaths.length === 0 && simv) { addBreath(0, 'mandatory', 'time', false); tl.mandWindowDone = 0; }

  while (tl.built < until) {
    const cur = tl.breaths[tl.breaths.length - 1];
    const lockEnd = cur ? cur.start + cur.spec.ti + TRIGGER_LOCKOUT : 0;
    // Efforts during inspiration/lock-out are not sensed as triggers.
    const effortTime = (k: number) => (Number.isFinite(tp) ? k * tp : Infinity);
    while (effortTime(tl.nextEffort) < lockEnd - 1e-9) {
      tl.efforts.push({ t: effortTime(tl.nextEffort), triggered: false, sensed: false });
      tl.nextEffort++;
    }
    const eT = effortTime(tl.nextEffort);
    // SIMV: each mandatory interval gets exactly one mandatory breath — the first
    // patient trigger in the interval (synchronised), or a time-triggered breath
    // at the end of the interval if the patient made no effective effort.
    const deadline = simv ? Math.max(lockEnd, (tl.mandWindowDone + 2) * tm - 1e-3) : Infinity;
    // Auto-trigger: cardiogenic + lung flow exceeding the trigger threshold during expiration.
    let auto = Infinity;
    if (cur && (p.cardiogenicOscillation ?? 0) > s.triggerSens) {
      const stop = Math.min(eT, deadline, lockEnd + 30);
      for (let t = lockEnd; t < stop; t += 0.01) {
        const lung = evalBreath(t - cur.start, cur.spec, cur.v0, 0, p).flow;
        if (lung + cardiogenic(t, p).flow > s.triggerSens) { auto = t; break; }
      }
    }
    const next = Math.min(eT, deadline, auto);
    if (!Number.isFinite(next)) { tl.built = Infinity; break; }
    const windowOf = (t: number) => (simv ? Math.floor(t / tm + 1e-9) : 0);
    const kindFor = (t: number): BreathKind => (simv && windowOf(t) > tl.mandWindowDone ? 'mandatory' : 'support');
    if (next === auto && auto < eT && auto <= deadline) {
      const k = kindFor(auto);
      if (k === 'mandatory') tl.mandWindowDone = windowOf(auto);
      addBreath(auto, k, 'auto', false);
    } else if (next === deadline && deadline < eT) {
      tl.mandWindowDone = Math.max(tl.mandWindowDone + 1, windowOf(deadline));
      addBreath(deadline, 'mandatory', 'time', false);
    } else {
      // Patient effort: triggers if the flow it generates exceeds the trigger threshold
      // (intrinsic PEEP must be overcome first — otherwise a missed trigger).
      let triggered = !cur;
      if (cur) {
        const probe: BreathSpec = { ...cur.spec, pulses: [...(cur.spec.pulses ?? []), { t0: eT - cur.start, dur: neuralTi(tp), amp: effortAmp }] };
        const f = evalBreath(eT - cur.start + 0.1, probe, cur.v0, 0, p).flow + cardiogenic(eT + 0.1, p).flow;
        triggered = f > s.triggerSens;
        if (!triggered && effortAmp > 0) cur.spec.pulses = probe.pulses; // effort still acts on the lung
      }
      void R;
      tl.efforts.push({ t: eT, triggered, sensed: true });
      tl.nextEffort++;
      if (triggered) {
        const k = kindFor(eT);
        if (k === 'mandatory') tl.mandWindowDone = windowOf(eT);
        addBreath(eT, k, 'patient', k !== 'mandatory');
      }
    }
    // Events are final up to the time just processed.
    tl.built = Math.max(tl.built, next);
  }
}

function getTimeline(s: PSVSettings | SIMVSettings, p: PatientPhysiology, until: number): Timeline {
  const key = timelineKey(s, p);
  let tl = timelines.get(key);
  if (!tl) {
    tl = { breaths: [], efforts: [], built: -1, nextEffort: 0, mandWindowDone: -1 };
    if (timelines.size > 24) timelines.clear();
    timelines.set(key, tl);
  }
  if (tl.built < until + 1) extendTimeline(tl, s, p, until + 1);
  return tl;
}

function findBreath(tl: Timeline, time: number): number {
  let lo = 0, hi = tl.breaths.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (tl.breaths[m].start <= time) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

/** Breath and trigger statistics over [from, to] for spontaneous-capable modes. */
export function triggerStats(settings: VentSettings, p: PatientPhysiology, from: number, to: number) {
  const span = Math.max(1e-6, to - from);
  if (settings.mode === 'APRV') {
    const tp = p.spontaneousRate > 0 ? 60 / p.spontaneousRate : Infinity;
    const n = Number.isFinite(tp) ? Math.floor(to / tp) - Math.floor(from / tp) : 0;
    return { effortRate: (n / span) * 60, missedTriggers: 0, autoTriggers: 0, pressureLimited: 0 };
  }
  if (settings.mode === 'VCV') {
    const lim = vcvBreath(settings, p).limited ? settings.respiratoryRate : 0;
    return { effortRate: 0, missedTriggers: 0, autoTriggers: 0, pressureLimited: lim };
  }
  if (settings.mode !== 'PSV' && settings.mode !== 'SIMV') return { effortRate: 0, missedTriggers: 0, autoTriggers: 0, pressureLimited: 0 };
  const tl = getTimeline(settings, p, to);
  const eff = tl.efforts.filter(e => e.t >= from && e.t <= to);
  const br = tl.breaths.filter(b => b.start >= from && b.start <= to);
  return {
    effortRate: (eff.length / span) * 60,
    missedTriggers: (eff.filter(e => e.sensed && !e.triggered).length / span) * 60,
    autoTriggers: (br.filter(b => b.trigger === 'auto').length / span) * 60,
    pressureLimited: (br.filter(b => b.spec.limited).length / span) * 60,
  };
}

// --- Ventilator Waveforms ---

export function generateVentWaveformPoint(
  time: number,
  settings: VentSettings,
  patient: PatientPhysiology
): { pressure: number; flow: number; volume: number } {
  switch (settings.mode) {
    case 'APRV': {
      const tp = patient.spontaneousRate > 0 ? 60 / patient.spontaneousRate : 0;
      const amp = tp ? patientEffort(patient, neuralTi(tp), tp) : 0;
      const r = aprvPoint(time, settings, patient, amp);
      return { pressure: r.pressure, flow: r.flow, volume: Math.max(0, r.volume) };
    }
    case 'VCV': {
      const { spec, v0 } = vcvBreath(settings, patient);
      const phase = ((time % spec.cycle) + spec.cycle) % spec.cycle;
      return evalBreath(phase, spec, v0, settings.peep, patient);
    }
    case 'PCV':
    case 'PRVC': {
      const cycle = 60 / settings.respiratoryRate;
      const D = settings.mode === 'PCV' ? settings.pInsp : prvcInspPressure(settings, patient).pInsp;
      const spec: BreathSpec = { kind: 'pressure', cycle, ti: getITime(settings), D, tr: settings.riseTime };
      const v0 = periodicPressure(cycle, spec, patient);
      const phase = ((time % cycle) + cycle) % cycle;
      return evalBreath(phase, spec, v0, settings.peep, patient);
    }
    case 'PSV':
    case 'SIMV': {
      if (settings.mode === 'PSV' && patient.spontaneousRate <= 0) return { pressure: settings.peep, flow: 0, volume: 0 };
      const tl = getTimeline(settings, patient, time);
      const i = findBreath(tl, time);
      const c = cardiogenic(time, patient);
      if (i < 0) return { pressure: settings.peep, flow: c.flow, volume: c.volume };
      const b = tl.breaths[i];
      const r = evalBreath(time - b.start, b.spec, b.v0, settings.peep, patient);
      return { pressure: r.pressure, flow: r.flow + c.flow, volume: r.volume + c.volume };
    }
  }
}

/** Kind of breath in progress at `time` (for breath-by-breath measurement). */
export function breathKindAt(time: number, settings: VentSettings, patient: PatientPhysiology): BreathKind {
  if (settings.mode === 'APRV') {
    const tp = patient.spontaneousRate > 0 ? 60 / patient.spontaneousRate : 0;
    if (!tp) return 'mandatory';
    const cycle = Math.max(0.2, settings.tHigh + settings.tLow);
    const phase = time % cycle;
    // A breath starting right after the release is the machine's re-inflation.
    return phase < 0.3 ? 'mandatory' : 'spontaneous';
  }
  if (settings.mode !== 'PSV' && settings.mode !== 'SIMV') return 'mandatory';
  if (settings.mode === 'PSV' && patient.spontaneousRate <= 0) return 'support';
  const tl = getTimeline(settings, patient, time);
  const i = findBreath(tl, time + 0.05);
  return i < 0 ? 'support' : tl.breaths[i].kind;
}

/**
 * PSV inspiratory time is set by the PATIENT's lung, not a timer: the breath
 * cycles off when flow decays to ETS % of its peak: Ti = Tr + τ·ln(100/ETS).
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
  return flowCycledTi(s.riseTime, s.ets, p, 60 / Math.max(1, p.spontaneousRate));
}

/**
 * Approximate SIMV breath rate for summaries: every patient effort that can
 * trigger gets a breath (mandatory once per window, supported otherwise), and
 * windows without effort get a time-triggered mandatory breath.
 */
export function simvSchedule(s: CommonSettings, p: PatientPhysiology) {
  const cycleTime = 60 / s.respiratoryRate;
  const totalRate = Math.max(s.respiratoryRate, p.spontaneousRate);
  return { cycleTime, totalRate, slotLen: 60 / totalRate };
}

function pickCommon(s: CommonSettings): CommonSettings {
  return { peep: s.peep, fio2: s.fio2, respiratoryRate: s.respiratoryRate, ieRatio: s.ieRatio, inspiratoryTime: s.inspiratoryTime };
}
void pickCommon;

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

/**
 * Mainstream capnograph sensor (teaching model, not recorded clinical data).
 * It sees only airway flow and exhaled volume: during exhalation CO₂ appears
 * once the dead space is washed out (phase I), rises through mixed gas (II) to
 * an alveolar plateau (III); fresh inspired gas clears it within 0.1 s. Works
 * for any breath pattern (mandatory, supported, spontaneous, APRV releases).
 */
export class CapnoSensor {
  private exhaling = false;
  private primed = false;
  private vPeak = 0;
  private vStartBreath = 0;
  private expected = 0;
  private value = 0;
  private dropFrom = 0;
  private dropT = Infinity;
  constructor(private patient: PatientPhysiology) {}
  push(flow: number, volume: number, alveolarCO2: number, dt: number): number {
    const p = this.patient;
    const deadSpace = deadSpaceMl(p);
    const obstruction = Math.min(1, Math.max(0, (p.resistance - 5) / 25));
    const mixing = deadSpace * (0.3 + obstruction * 0.7);
    const plateauStart = 0.92 - obstruction * 0.22;
    if (!this.exhaling && flow < -0.5 && this.primed) {
      this.exhaling = true;
      this.expected = Math.max(1, this.vPeak - this.vStartBreath - deadSpace - mixing);
    }
    if (flow > 0.5) {
      if (this.exhaling || !this.primed) { this.vStartBreath = volume; this.vPeak = volume; }
      if (this.exhaling) { this.dropFrom = this.value; this.dropT = 0; }
      this.exhaling = false;
      this.primed = true;
    }
    if (this.exhaling) {
      const expired = Math.max(0, this.vPeak - volume);
      let v = 0;
      if (expired > deadSpace) {
        v = expired < deadSpace + mixing
          ? alveolarCO2 * plateauStart * (expired - deadSpace) / mixing
          : alveolarCO2 * (plateauStart + (1 - plateauStart) * Math.min(1, (expired - deadSpace - mixing) / this.expected));
      }
      this.value = Math.max(this.value * 0 + v, 0);
    } else {
      if (volume > this.vPeak) this.vPeak = volume;
      if (Number.isFinite(this.dropT)) {
        this.dropT += dt;
        this.value = this.dropFrom * Math.max(0, 1 - this.dropT / 0.1);
        if (this.dropT >= 0.1) this.dropT = Infinity;
      } else if (this.primed) this.value = 0;
    }
    return Math.min(alveolarCO2, Math.max(0, this.value));
  }
}

/** Pure capnogram at `time` (mmHg): replays the sensor over the preceding 16 s at 50 Hz. */
export function generateCapnography(time: number, settings: VentSettings, patient: PatientPhysiology, etco2: number): number {
  if (!Number.isFinite(time) || !Number.isFinite(etco2) || etco2 <= 0 || time <= 0) return 0;
  const dt = 1 / SAMPLE_RATE;
  const sensor = new CapnoSensor(patient);
  const start = Math.max(0, Math.floor((time - 16) / dt) * dt);
  let v = 0;
  let prevT = start;
  for (let t = start; t < time - 1e-9; t += dt) {
    const a = generateVentWaveformPoint(t, settings, patient);
    v = sensor.push(a.flow, a.volume, etco2, t - prevT);
    prevT = t;
  }
  const a = generateVentWaveformPoint(time, settings, patient);
  v = sensor.push(a.flow, a.volume, etco2, time - prevT);
  return v;
}
