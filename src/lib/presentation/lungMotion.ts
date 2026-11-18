/**
 * Lung View presentation drive (display only — no physiology). Every value is
 * derived from the live simulator buffers the monitor already shows:
 *  - volume trace (mL above the relaxed volume at set PEEP; carried trapped
 *    volume keeps its minimum above zero),
 *  - ECG trace (stable sampled R peaks from the shared cardiac clock).
 * Nothing here runs its own breathing or heart-rate clock.
 */
import { ecgTiming } from '@/lib/simulation/waveformGenerators';

const FS = 50; // Hz, live buffer rate

export interface BreathDrive {
  /** End-expiratory volume above relaxed volume (mL): trapped gas / auto-PEEP volume. */
  eev: number;
  /** Current volume above the end-expiratory level (mL). */
  tidal: number;
  /** eev and tidal as fractions of this patient's reference VT. */
  trapFrac: number;
  tidalFrac: number;
}

/** Breath state from the latest live volume samples. `vNow` may be a smoothed latest sample. */
export function breathDrive(volume: number[], refVT: number, windowSamples: number, vNow?: number): BreathDrive {
  const n = volume.length;
  if (n === 0) return { eev: 0, tidal: 0, trapFrac: 0, tidalFrac: 0 };
  const w = volume.slice(-Math.max(2, Math.min(n, windowSamples)));
  // Trough of the last breath window: end-expiratory volume. Cardiogenic ripple is tiny.
  const eev = Math.max(0, Math.min(...w));
  const v = vNow ?? volume[n - 1];
  const tidal = Math.max(0, v - eev);
  const ref = Math.max(20, refVT);
  return { eev, tidal, trapFrac: eev / ref, tidalFrac: tidal / ref };
}

const bump = (t: number, c: number, hw: number) => {
  const x = (t - c) / hw;
  return x <= -1 || x >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * x));
};

export interface CardiacDrive { atrial: number; ventricular: number; sinceR: number | null; rr: number | null }

/**
 * Atrial/ventricular contraction (0–1) from the ECG trace's last two R peaks.
 * Atrial systole follows the P wave and ends at the next QRS; ventricular
 * systole starts ~50 ms after R and relaxes by the end of the T wave.
 */
export function cardiacDrive(ecg: number[]): CardiacDrive {
  const peaks: number[] = [];
  for (let i = ecg.length - 2; i > 0 && peaks.length < 2; i--) {
    if (ecg[i] > 0.6 && ecg[i] >= ecg[i - 1] && ecg[i] > ecg[i + 1]) peaks.push(i);
  }
  if (peaks.length < 2) return { atrial: 0, ventricular: 0, sinceR: null, rr: null };
  const sinceR = (ecg.length - 1 - peaks[0]) / FS;
  const rr = (peaks[0] - peaks[1]) / FS;
  const e = ecgTiming(rr);
  const sysEnd = Math.max(0.12, e.tEnd - e.rPeak);
  const s = sinceR - 0.05;
  const ventricular = s > 0 && s < sysEnd ? Math.sin((Math.PI * s) / sysEnd) : 0;
  // Atrial kick: centred ~60 ms before the next expected R (late P / PR segment).
  const toNext = rr - sinceR;
  const atrial = bump(toNext, 0.07, 0.06);
  return { atrial, ventricular, sinceR, rr };
}

export interface LungShape {
  /** Global expansion factor for apex/upper zones. */
  expansion: number;
  /** Baseline (end-expiratory) expansion — the persistent part. */
  baseline: number;
  /** Fraction (0–0.5) by which lower/dependent zones lose volume and excursion. */
  basalLoss: number;
  /** Diaphragm: dome apex y (svg units), dome height, and flatness 0–1. */
  diaphragmY: number;
  domeHeight: number;
}

/**
 * Illustrative shape. `atel` (0–1) is the existing scenario atelectasis
 * severity (ARDS/obesity scores), applied regionally to lower/dependent zones.
 */
export function lungShape(d: BreathDrive, pathologyBase: number, atel: number): LungShape {
  const trap = Math.min(1.4, d.trapFrac);
  const baseline = pathologyBase + 0.22 * trap;
  const excursion = 0.2 * Math.min(1.6, d.tidalFrac);
  const expansion = baseline + excursion;
  const basalLoss = Math.max(0, Math.min(0.5, atel * 0.45));
  // Lung base (top 60 + 95·e, minus basal loss) sets the diaphragm; trapped gas
  // pushes it caudally and flattens the dome; tidal descent comes only from VT.
  const lungBase = 60 + 95 * expansion * (1 - basalLoss * 0.5);
  const flat = Math.min(1, trap / 0.9);
  return { expansion, baseline, basalLoss, diaphragmY: lungBase + 4, domeHeight: 11 * (1 - 0.75 * flat) };
}

/** Bounded exponential approach for one presentation frame. */
export function smoothStep(prev: number, target: number, dtMs: number, tauMs = 60): number {
  if (!Number.isFinite(prev)) return target;
  const k = 1 - Math.exp(-Math.max(0, Math.min(dtMs, 100)) / tauMs);
  return prev + (target - prev) * k;
}
