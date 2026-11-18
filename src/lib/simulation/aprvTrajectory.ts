import type { APRVSettings, PatientPhysiology } from './types';

/**
 * APRV on a single-compartment RC lung, with optional patient effort.
 * dV/dt = (Paw − P Low + Pmus − V/C) / R, where R is the expiratory value
 * (APRV_EXP_TAU_FACTOR × inspiratory) during the release. Pressure, flow and
 * volume all come from this one trajectory. Patient effort (spontaneous
 * breathing, unrestricted during P High and P Low) runs on the patient's own
 * clock, independent of the APRV cycle.
 */
export const APRV_EXP_TAU_FACTOR = 1.25;
export const APRV_RISE = 0.2;
export const APRV_VALVE = 0.03;
const DT = 0.001;

/** Patient neural inspiratory time (s) for an effort period Tp. */
export function neuralTi(tp: number): number {
  return Math.min(1.2, 0.35 * tp);
}

export function aprvPressure(phase: number, s: APRVSettings): number {
  const d = s.pHigh - s.pLow;
  if (phase < s.tHigh) {
    const r = Math.min(1, phase / APRV_RISE);
    return s.pLow + d * r * r * (3 - 2 * r);
  }
  return s.pLow + d * Math.exp(-(phase - s.tHigh) / (APRV_VALVE / 3));
}

interface Effort { tp: number; ti: number; amp: number }

interface Trajectory {
  cycle: number; n: number; dt: number;
  starts: number[];            // start volume of each cycle (mL)
  tables: Map<number, Float64Array>;
  passive: Float64Array;       // periodic table without effort
  effort: Effort | null;
}

const cache = new Map<string, Trajectory>();

function integrateCycle(s: APRVSettings, p: PatientPhysiology, v0: number, k: number, cycle: number, n: number, dt: number, effort: Effort | null): Float64Array {
  const C = p.compliance / 1000, tau = p.resistance * C;
  const vol = new Float64Array(n + 1);
  vol[0] = v0;
  for (let i = 0; i < n; i++) {
    const tm = (i + 0.5) * dt;
    const abs = k * cycle + tm;
    let pmus = 0;
    if (effort) {
      const ph = abs % effort.tp;
      if (ph < effort.ti) pmus = effort.amp;
    }
    const veq = C * (aprvPressure(tm, s) - s.pLow + pmus) * 1000;
    const kk = Math.exp(-dt / (tm < s.tHigh ? tau : tau * APRV_EXP_TAU_FACTOR));
    vol[i + 1] = veq + (vol[i] - veq) * kk;
  }
  return vol;
}

function trajectory(s: APRVSettings, p: PatientPhysiology, effortAmp: number): Trajectory {
  const cycle = Math.max(0.2, s.tHigh + s.tLow);
  const key = `${s.pHigh}|${s.pLow}|${s.tHigh}|${s.tLow}|${p.compliance}|${p.resistance}|${p.spontaneousRate}|${effortAmp}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const n = Math.max(2, Math.round(cycle / DT));
  const dt = cycle / n;
  const C = p.compliance / 1000, tau = p.resistance * C;
  // Passive periodic steady state: linear ⇒ V_end = a·V0 + b.
  const zero = integrateCycle(s, p, 0, 0, cycle, n, dt, null);
  const a = Math.exp(-s.tHigh / tau) * Math.exp(-(cycle - s.tHigh) / (tau * APRV_EXP_TAU_FACTOR));
  const v0 = a < 1 ? zero[n] / (1 - a) : 0;
  const passive = integrateCycle(s, p, v0, 0, cycle, n, dt, null);
  const effort = p.spontaneousRate > 0 && effortAmp > 0
    ? { tp: 60 / p.spontaneousRate, ti: neuralTi(60 / p.spontaneousRate), amp: effortAmp } : null;
  const t: Trajectory = { cycle, n, dt, starts: [v0], tables: new Map(), passive, effort };
  if (cache.size > 32) cache.clear();
  cache.set(key, t);
  return t;
}

function cycleTable(t: Trajectory, s: APRVSettings, p: PatientPhysiology, k: number): Float64Array {
  if (!t.effort) return t.passive;
  const hit = t.tables.get(k);
  if (hit) return hit;
  while (t.starts.length <= k) {
    const j = t.starts.length - 1;
    const tab = t.tables.get(j) ?? integrateCycle(s, p, t.starts[j], j, t.cycle, t.n, t.dt, t.effort);
    t.starts.push(tab[t.n]);
    remember(t, j, tab);
  }
  const tab = integrateCycle(s, p, t.starts[k], k, t.cycle, t.n, t.dt, t.effort);
  remember(t, k, tab);
  return tab;
}

function remember(t: Trajectory, k: number, tab: Float64Array) {
  t.tables.set(k, tab);
  if (t.tables.size > 8) t.tables.delete(t.tables.keys().next().value as number);
}

/** Pressure (cmH₂O), flow (L/min, exact derivative of volume) and volume (mL) at `time`. */
export function aprvPoint(time: number, s: APRVSettings, p: PatientPhysiology, effortAmp: number) {
  const t = trajectory(s, p, effortAmp);
  const tt = Math.max(0, time);
  const k = Math.floor(tt / t.cycle);
  const phase = tt - k * t.cycle;
  const tab = cycleTable(t, s, p, k);
  const x = phase / t.dt;
  const i = Math.min(t.n - 1, Math.floor(x));
  const f = x - i;
  const volume = tab[i] + (tab[i + 1] - tab[i]) * f;
  const flow = ((tab[i + 1] - tab[i]) / t.dt) * 60 / 1000;
  let effortActive = false;
  if (t.effort) effortActive = tt % t.effort.tp < t.effort.ti;
  return { pressure: aprvPressure(phase, s), flow, volume, phase, effortActive };
}

/**
 * Release metrics from the ventilator's own (passive) periodic trajectory:
 * release volume, fraction emptied, and end-release flow as % of peak
 * expiratory flow — the case-specific T Low cue. No release when P High ≤ P Low.
 */
export function aprvReleaseMetrics(s: APRVSettings, p: PatientPhysiology) {
  if (s.pHigh <= s.pLow) {
    return { releaseVolume: 0, releaseFraction: 0, endExpiratoryVolume: 0, peakExpFlow: 0, endReleaseFlow: 0, endToPeakFlowPct: 0, noRelease: true };
  }
  const t = trajectory(s, p, 0);
  const tab = t.passive;
  const iRel = Math.round(s.tHigh / t.dt);
  const vRelease = tab[iRel];
  const vEnd = tab[t.n];
  let peakExp = 0;
  for (let i = iRel; i < t.n; i++) peakExp = Math.min(peakExp, (tab[i + 1] - tab[i]) / t.dt);
  const endFlow = (tab[t.n] - tab[t.n - 1]) / t.dt;
  return {
    releaseVolume: Math.max(0, vRelease - vEnd),
    releaseFraction: vRelease > 1e-6 ? (vRelease - vEnd) / vRelease : 0,
    endExpiratoryVolume: vEnd,
    peakExpFlow: -peakExp * 60 / 1000,
    endReleaseFlow: -endFlow * 60 / 1000,
    endToPeakFlowPct: peakExp < 0 ? Math.round((endFlow / peakExp) * 100) : 0,
    noRelease: false,
  };
}
