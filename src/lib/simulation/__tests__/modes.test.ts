/**
 * Mode-specific discriminated-union tests.
 *
 * These tests confirm that:
 *   1. `buildVentSettings` produces a correctly-narrowed `VentSettings` for
 *      every `mode`, carrying only the fields relevant to that mode.
 *   2. `generateVentWaveformPoint` reads mode-specific fields correctly —
 *      the pressure waveform for VCV / PCV / SIMV / PSV differs in shape at
 *      the same time-in-cycle, and those differences are locked as snapshots.
 *
 * A refactor that misroutes a field (e.g. reading `pInsp` in VCV) or drops
 * a mode branch in the waveform generator will fail here.
 */

import { describe, it, expect } from 'vitest';
import type { AllModeParams, PatientPhysiology, VentMode, VentSettings } from '../types';
import { buildVentSettings } from '../types';
import { generateVentWaveformPoint } from '../waveformGenerators';
import { patients } from '../patients';

const ards = patients.find(p => p.id === 'ards') as PatientPhysiology;
const spont = patients.find(p => p.id === 'spontaneous') as PatientPhysiology;

const baseParams: AllModeParams = {
  mode: 'VCV',
  peep: 8,
  fio2: 0.5,
  respiratoryRate: 14,
  ieRatio: 2,
  inspiratoryTime: 1.0,
  tidalVolume: 400,
  flowRate: 40,
  pInsp: 18,
  pMax: 35,
  pressureSupport: 10,
  pHigh: 28,
  pLow: 0,
  tHigh: 4.5,
  tLow: 0.5,
};

// ─── (1) Narrowing: each mode surfaces exactly its own fields ──────

describe('buildVentSettings — discriminated-union narrowing', () => {
  const commonKeys = ['mode', 'peep', 'fio2', 'respiratoryRate', 'ieRatio', 'inspiratoryTime'] as const;

  const expectedExtraKeys: Record<VentMode, string[]> = {
    VCV:  ['tidalVolume', 'flowRate'],
    PCV:  ['pInsp'],
    PRVC: ['tidalVolume', 'pMax'],
    SIMV: ['tidalVolume', 'pressureSupport'],
    PSV:  ['pressureSupport'],
    APRV: ['pHigh', 'pLow', 'tHigh', 'tLow'],
  };

  const modes = Object.keys(expectedExtraKeys) as VentMode[];

  it.each(modes)('%s surfaces only its own extra fields', (mode) => {
    const s = buildVentSettings({ ...baseParams, mode });
    const keys = Object.keys(s).sort();
    const expected = [...commonKeys, ...expectedExtraKeys[mode]].sort();
    expect(keys).toEqual(expected);
    // And the discriminant survives so downstream narrowing works.
    expect(s.mode).toBe(mode);
  });
});

// ─── (2) Waveform shape at fixed sample points, per mode ───────────

/**
 * Snapshot the pressure / flow / volume waveform samples across one full
 * respiratory cycle for every mode on the ARDS patient (plus PSV on the
 * spontaneous patient, since PSV depends on spontaneous drive).
 *
 * Values are rounded to keep floating-point noise from churning the golden
 * files across platforms.
 */
describe('generateVentWaveformPoint — per-mode waveform shape', () => {
  const round = (v: number) => Math.round(v * 100) / 100;

  const sample = (patient: PatientPhysiology, settings: VentSettings) => {
    // Sample 12 evenly-spaced points across a 5s window. Long enough to hit
    // inspiration, plateau, and expiration for any RR ≥ 10.
    const frames = [];
    for (let i = 0; i < 12; i++) {
      const t = (i * 5) / 11;
      const p = generateVentWaveformPoint(t, settings, patient);
      frames.push({
        t: round(t),
        pressure: round(p.pressure),
        flow: round(p.flow),
        volume: round(p.volume),
      });
    }
    return frames;
  };

  const cases: Array<[string, PatientPhysiology, VentSettings]> = [
    ['VCV — ARDS',  ards,  buildVentSettings({ ...baseParams, mode: 'VCV'  })],
    ['PCV — ARDS',  ards,  buildVentSettings({ ...baseParams, mode: 'PCV', pInsp: 25 })],
    ['PRVC — ARDS', ards,  buildVentSettings({ ...baseParams, mode: 'PRVC' })],
    ['SIMV — ARDS', ards,  buildVentSettings({ ...baseParams, mode: 'SIMV' })],
    ['APRV — ARDS', ards,  buildVentSettings({ ...baseParams, mode: 'APRV' })],
    ['PSV — spontaneous', spont, buildVentSettings({ ...baseParams, mode: 'PSV' })],
  ];

  it.each(cases)('%s waveform samples are stable', (_label, patient, settings) => {
    expect(sample(patient, settings)).toMatchSnapshot();
  });
});

// ─── (3) Mode-specific sensitivity: PCV pInsp drives delivered VT ──

describe('PCV — increasing pInsp raises delivered volume', () => {
  it('peak volume rises monotonically with pInsp', () => {
    const peaks = [15, 20, 25, 30].map(pInsp => {
      const s = buildVentSettings({ ...baseParams, mode: 'PCV', pInsp });
      let peak = 0;
      for (let i = 0; i < 250; i++) {
        const v = generateVentWaveformPoint(i * 0.02, s, ards).volume;
        if (v > peak) peak = v;
      }
      return { pInsp, peak: Math.round(peak) };
    });
    // Monotonic ⇒ each next peak ≥ previous.
    for (let i = 1; i < peaks.length; i++) {
      expect(peaks[i].peak).toBeGreaterThanOrEqual(peaks[i - 1].peak);
    }
    expect(peaks).toMatchSnapshot();
  });
});

// ─── (4) SIMV: mandatory VT delivery persists regardless of PS ─────

describe('SIMV — mandatory VT is independent of pressure support', () => {
  it('mandatory tidal-volume peak is invariant to PS on a passive patient', () => {
    const peakFor = (pressureSupport: number) => {
      const s = buildVentSettings({ ...baseParams, mode: 'SIMV', pressureSupport });
      let peak = 0;
      // Sample 8s so we see at least one full mandatory breath at RR 14.
      for (let i = 0; i < 400; i++) {
        const v = generateVentWaveformPoint(i * 0.02, s, ards).volume;
        if (v > peak) peak = v;
      }
      return Math.round(peak);
    };
    const rows = [0, 8, 16].map(ps => ({ ps, peak: peakFor(ps) }));
    // On a fully passive patient (no spontaneous drive) PS should not change
    // mandatory VT — locks the invariant so a future refactor can't couple them.
    expect(new Set(rows.map(r => r.peak)).size).toBe(1);
    expect(rows).toMatchSnapshot();
  });
});
