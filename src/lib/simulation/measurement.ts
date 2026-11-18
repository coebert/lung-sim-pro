import { MeasuredValues, PatientPhysiology, VentSettings } from './types';
import { deadSpaceMl } from './scoring';

/** Ventilator-style apnoea time (s): alarm when no breath starts for this long. */
export const APNOEA_TIME_SEC = 20;
/** Minute ventilation / rate observation window (s). */
export const MV_WINDOW_SEC = 60;
const FLOW_ON = 1;   // L/min — inspiratory flow that marks a breath start
const FLOW_OFF = -1; // L/min — expiratory flow that re-arms detection

export interface CompletedBreath {
  start: number;
  end: number;
  /** Exhaled tidal volume (mL): end-inspiratory minus next end-expiratory volume. */
  vt: number;
  peak: number;
  /** Peak lung volume above FRC at baseline (mL). */
  vMax: number;
  /** End-expiratory volume above FRC (mL) — trapped gas. */
  vEnd: number;
  kind: 'mandatory' | 'support';
  /** Mean airway pressure over the breath. */
  meanP: number;
  /** Highest capnogram value during the breath (sampled end-tidal CO₂, mmHg). */
  capPeak: number;
}

/**
 * Detects breath boundaries from the flow trace (start = expiratory → inspiratory
 * flow with hysteresis) and records per-breath exhaled volume and peak pressure.
 * Shared by the live store and headless tests so both measure identically.
 */
export class BreathTracker {
  breaths: CompletedBreath[] = [];
  lastBreathStart = -Infinity;
  private armed = true;
  private cur: { start: number; peak: number; vMax: number; kind: CompletedBreath['kind']; sumP: number; n: number; cap: number } | null = null;
  private resetTime = 0;

  reset(time = 0): void {
    this.breaths = [];
    this.lastBreathStart = -Infinity;
    this.armed = true;
    this.cur = null;
    this.resetTime = time;
  }

  push(time: number, pressure: number, flow: number, volume: number, capno: number, kind: CompletedBreath['kind']): void {
    if (this.armed && flow > FLOW_ON) {
      if (this.cur) {
        this.breaths.push({
          start: this.cur.start, end: time, vt: Math.max(0, this.cur.vMax - volume),
          peak: this.cur.peak, vMax: this.cur.vMax, vEnd: volume, kind: this.cur.kind,
          meanP: this.cur.sumP / Math.max(1, this.cur.n), capPeak: this.cur.cap,
        });
        const cutoff = time - MV_WINDOW_SEC * 2;
        while (this.breaths.length && this.breaths[0].end < cutoff) this.breaths.shift();
      }
      this.cur = { start: time, peak: pressure, vMax: volume, kind, sumP: 0, n: 0, cap: 0 };
      this.lastBreathStart = time;
      this.armed = false;
    }
    if (flow < FLOW_OFF) this.armed = true;
    if (this.cur) {
      if (pressure > this.cur.peak) this.cur.peak = pressure;
      if (volume > this.cur.vMax) this.cur.vMax = volume;
      if (capno > this.cur.cap) this.cur.cap = capno;
      this.cur.sumP += pressure;
      this.cur.n++;
    }
  }

  secondsSinceBreath(now: number): number {
    return now - (Number.isFinite(this.lastBreathStart) ? this.lastBreathStart : this.resetTime);
  }
}

/**
 * Breath-based measured values. Peak/plateau/auto-PEEP come from the last
 * complete breath; VT is the last breath's exhaled volume; minute and alveolar
 * ventilation and rate are sums over complete breaths in the window since the
 * last settings change (≤ 60 s). Without a fresh breath, the previous values are
 * retained and flagged `warmingUp`.
 */
export function measureFromBreaths(
  tracker: BreathTracker,
  now: number,
  since: number,
  baseline: number,
  settings: VentSettings,
  patient: PatientPhysiology,
  previous: MeasuredValues,
  revision: number,
): MeasuredValues {
  const secondsSinceBreath = tracker.secondsSinceBreath(now);
  const apnoea = secondsSinceBreath > APNOEA_TIME_SEC;
  const from = Math.max(since, now - MV_WINDOW_SEC);
  const fresh = tracker.breaths.filter(b => b.start >= from - 1e-9);
  const round1 = (v: number) => Math.round(v * 10) / 10;
  if (apnoea) {
    return {
      ...previous, measuredTV: 0, minuteVentilation: 0, measuredRR: 0, alveolarVentilation: 0,
      dynamicCompliance: 0, meanPressure: baseline, peakPressure: baseline, plateauPressure: baseline, secondsSinceBreath: Math.round(secondsSinceBreath),
      apnoea: true, warmingUp: false, freshRevision: revision, vtMandatory: undefined, vtSupported: undefined,
    };
  }
  if (fresh.length === 0) {
    return { ...previous, secondsSinceBreath: Math.round(secondsSinceBreath), apnoea: false, warmingUp: true };
  }
  const last = fresh[fresh.length - 1];
  const span = Math.max(1e-6, last.end - fresh[0].start);
  const vd = deadSpaceMl(patient);
  const sumVt = fresh.reduce((a, b) => a + b.vt, 0);
  const sumVa = fresh.reduce((a, b) => a + Math.max(0, b.vt - vd), 0);
  const C = patient.compliance;
  const lastOf = (k: CompletedBreath['kind']) => [...fresh].reverse().find(b => b.kind === k)?.vt;
  const plateau = Math.min(last.peak, baseline + Math.max(0, last.vMax) / C);
  void settings;
  return {
    peakPressure: round1(last.peak),
    plateauPressure: round1(plateau),
    meanPressure: round1(fresh.reduce((a, b) => a + b.meanP * (b.end - b.start), 0) / span),
    measuredTV: Math.round(last.vt),
    minuteVentilation: round1((sumVt / span) * 60 / 1000),
    measuredRR: Math.round((fresh.length / span) * 60 * 10) / 10,
    dynamicCompliance: last.vt > 0 && last.peak > baseline ? Math.round(last.vt / (last.peak - baseline)) : 0,
    autoPEEP: round1(Math.max(0, last.vEnd) / C),
    alveolarVentilation: Math.round((sumVa / span) * 60 / 100) / 10,
    vtMandatory: lastOf('mandatory') !== undefined ? Math.round(lastOf('mandatory')!) : undefined,
    vtSupported: lastOf('support') !== undefined ? Math.round(lastOf('support')!) : undefined,
    secondsSinceBreath: Math.round(secondsSinceBreath),
    apnoea: false,
    warmingUp: false,
    freshRevision: revision,
    windowSec: Math.round(span),
  };
}
