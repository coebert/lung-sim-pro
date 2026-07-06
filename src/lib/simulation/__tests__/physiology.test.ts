/**
 * Golden-file physiology trajectory tests.
 *
 * For each patient we drive the simulation deterministically for 60 s using
 * a mode-appropriate settings profile, and snapshot the vitals + measured
 * values at fixed timepoints (5 / 15 / 30 / 60 s).
 *
 * These snapshots pin the physiology *outcome* of every published patient —
 * they will diff if `engine.ts`, `scoring.ts`, `waveformGenerators.ts`, or a
 * per-patient parameter in `patients.ts` changes in a way that shifts the
 * modelled trainer experience. Update snapshots (`-u`) only when the change
 * is intentional.
 */

import { describe, it, expect } from 'vitest';
import {
  TICK_DT,
  SAMPLE_RATE,
  RECENT_WINDOW,
  computeMeasured,
  createInitialVitals,
  generateWaveformSample,
  updateVitals,
} from '../engine';
import { patients } from '../patients';
import type {
  AllModeParams, MeasuredValues, PatientPhysiology, VentSettings, Vitals,
} from '../types';
import { buildVentSettings } from '../types';

// ─── deterministic ring buffer over the recent window ──────────────

class Ring {
  private data: number[];
  private head = 0;
  constructor(private size: number) { this.data = new Array(size).fill(0); }
  push(v: number) { this.data[this.head] = v; this.head = (this.head + 1) % this.size; }
  recent(n: number): number[] {
    const take = Math.min(n, this.size);
    const start = (this.head - take + this.size) % this.size;
    if (start + take <= this.size) return this.data.slice(start, start + take);
    return this.data.slice(start).concat(this.data.slice(0, (start + take) % this.size));
  }
}

interface Frame {
  t: number;
  vitals: Vitals;
  measured: MeasuredValues;
}

function runTrajectory(
  patient: PatientPhysiology,
  settings: VentSettings,
  seconds: number,
  captureAt: number[],
): Frame[] {
  const pressure = new Ring(RECENT_WINDOW);
  const volume = new Ring(RECENT_WINDOW);
  let vitals = createInitialVitals(patient);
  let measured: MeasuredValues = {
    peakPressure: 0, plateauPressure: 0, meanPressure: 0,
    measuredTV: 0, minuteVentilation: 0, measuredRR: 14, dynamicCompliance: 0,
  };
  const frames: Frame[] = [];
  const totalTicks = Math.round(seconds * SAMPLE_RATE);
  const captureTicks = new Set(captureAt.map(s => Math.round(s * SAMPLE_RATE)));

  const actualRR = settings.mode === 'PSV'
    ? (patient.spontaneousRate || 12)
    : settings.respiratoryRate;

  for (let i = 1; i <= totalTicks; i++) {
    const t = i * TICK_DT;
    const sample = generateWaveformSample(t, settings, patient, vitals);
    pressure.push(sample.pressure);
    volume.push(sample.volume);
    // Recompute measured + vitals every 250 ms (matches the live store cadence).
    if (i % Math.round(0.25 * SAMPLE_RATE) === 0) {
      measured = computeMeasured(
        pressure.recent(RECENT_WINDOW),
        volume.recent(RECENT_WINDOW),
        actualRR,
        settings.peep,
      );
      vitals = updateVitals(settings, patient, vitals, measured, /* prone */ false);
    }
    if (captureTicks.has(i)) frames.push({ t: Number(t.toFixed(2)), vitals, measured });
  }
  return frames;
}

// Round every numeric field to keep snapshots stable across platforms.
function tidy(frames: Frame[], dp = 1): unknown {
  const factor = 10 ** dp;
  const r = (v: unknown): unknown =>
    typeof v === 'number' ? Math.round(v * factor) / factor
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, r(x)]))
        : v;
  return frames.map(f => ({
    t: f.t,
    vitals: r(f.vitals),
    measured: r(f.measured),
  }));
}

// ─── Per-patient scenarios ─────────────────────────────────────────

interface Scenario {
  id: string;
  label: string;
  settingsPatch: Partial<AllModeParams>;
}

function makeSettings(patient: PatientPhysiology, patch: Partial<AllModeParams>): VentSettings {
  const all: AllModeParams = {
    mode: 'VCV',
    peep: patient.optimalPEEP,
    fio2: patient.optimalFiO2,
    respiratoryRate: patient.optimalRR,
    ieRatio: 2,
    inspiratoryTime: 1.0,
    tidalVolume: patient.optimalTV,
    flowRate: 40,
    pInsp: 15,
    pMax: 35,
    pressureSupport: patient.optimalPS,
    pHigh: 28,
    pLow: 0,
    tHigh: 4.5,
    tLow: 0.5,
    ...patch,
  };
  return buildVentSettings(all);
}

const CAPTURE_AT = [5, 15, 30, 60];

const scenarios: Scenario[] = [
  { id: 'healthy',      label: 'VCV — protective baseline',      settingsPatch: {} },
  { id: 'obese',        label: 'VCV — high-PEEP obesity',        settingsPatch: {} },
  { id: 'ards',         label: 'VCV — ARDSNet low VT',           settingsPatch: {} },
  { id: 'ards',         label: 'APRV — optimal recruitment',     settingsPatch: { mode: 'APRV' } },
  { id: 'bronchospasm', label: 'VCV — low rate long e-time',     settingsPatch: { ieRatio: 4 } },
  { id: 'restrictive',  label: 'VCV — small VT higher rate',     settingsPatch: {} },
  { id: 'spontaneous',  label: 'PSV — pressure support',         settingsPatch: { mode: 'PSV' } },
];

describe('physiology trajectory — golden files', () => {
  for (const p of patients) {
    const patientScenarios = scenarios.filter(s => s.id === p.id);
    describe(`${p.id} (${p.name})`, () => {
      it.each(patientScenarios)('$label', ({ settingsPatch }) => {
        const settings = makeSettings(p, settingsPatch);
        const frames = runTrajectory(p, settings, 60, CAPTURE_AT);
        expect(tidy(frames)).toMatchSnapshot();
      });
    });
  }
});
