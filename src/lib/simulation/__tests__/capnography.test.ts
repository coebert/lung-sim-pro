import { describe, expect, it } from 'vitest';
import { patients, getDefaultAllParams } from '../patients';
import { generateCapnography, generateVentWaveformPoint, psvInspTime, simvSupportInspTime } from '../waveformGenerators';
import { buildVentSettings, type AllModeParams } from '../types';

const healthy = patients[0];
const params: AllModeParams = { ...getDefaultAllParams(healthy), respiratoryRate: 12, inspiratoryTime: 1, tidalVolume: 500 };
const vcv = buildVentSettings({ ...params, mode: 'VCV' });

describe('breath-synchronized capnography', () => {
  it('has no startup spike, clears dead space, rises and reaches end tidal before inspiration', () => {
    expect(generateCapnography(0, vcv, healthy, 38)).toBe(0);
    expect(generateCapnography(1.02, vcv, healthy, 38)).toBe(0);
    const rise = generateCapnography(1.12, vcv, healthy, 38);
    expect(rise).toBeGreaterThan(0);
    expect(rise).toBeLessThan(35);
    expect(generateCapnography(4.999, vcv, healthy, 38)).toBeCloseTo(38, 1);
    expect(generateCapnography(5.04, vcv, healthy, 38)).toBeLessThan(30);
    expect(generateCapnography(5.2, vcv, healthy, 38)).toBe(0);
  });

  it('follows changed Ti instead of a fixed one-third inspiratory ratio', () => {
    const inverse = buildVentSettings({ ...params, mode: 'VCV', inspiratoryTime: 3 });
    expect(generateCapnography(2, inverse, healthy, 38)).toBe(0);
    expect(generateCapnography(2, vcv, healthy, 38)).toBeGreaterThan(35);
  });

  it('produces a slower upstroke with high airway resistance', () => {
    const obstructed = { ...healthy, resistance: 30 };
    expect(generateCapnography(1.3, vcv, obstructed, 38)).toBeLessThan(generateCapnography(1.3, vcv, healthy, 38));
  });

  it('has no exhaled CO₂ when tidal volume cannot clear dead space', () => {
    const small = buildVentSettings({ ...params, mode: 'VCV', tidalVolume: 100 });
    for (let t = 0; t < 10; t += 0.02) expect(generateCapnography(t, small, healthy, 38)).toBe(0);
  });

  it('keeps APRV CO₂ in the release and inspiratory downstroke only', () => {
    const aprv = buildVentSettings({ ...params, mode: 'APRV', tHigh: 4, tLow: 0.5, pHigh: 25, pLow: 0 });
    expect(generateCapnography(3.9, aprv, healthy, 38)).toBe(0);
    expect(generateCapnography(4.4, aprv, healthy, 38)).toBeGreaterThan(30);
    expect(generateCapnography(4.7, aprv, healthy, 38)).toBe(0);
  });

  it('follows PSV flow cycling and remains flat without drive', () => {
    const s = buildVentSettings({ ...params, mode: 'PSV' });
    if (s.mode !== 'PSV') throw new Error('Expected PSV');
    const patient = { ...healthy, spontaneousRate: 12 };
    const ti = 0.12 + psvInspTime(s, patient);
    expect(generateCapnography(ti - 0.02, s, patient, 38)).toBe(0);
    expect(generateCapnography(ti + 0.8, s, patient, 38)).toBeGreaterThan(0);
    expect(generateCapnography(3, s, healthy, 38)).toBe(0);
  });

  it('uses separate mandatory and support expiration timing in SIMV', () => {
    const s = buildVentSettings({ ...params, mode: 'SIMV', respiratoryRate: 6 });
    if (s.mode !== 'SIMV') throw new Error('Expected SIMV');
    const patient = { ...healthy, spontaneousRate: 12 };
    const ti = simvSupportInspTime(s, patient);
    expect(generateCapnography(5 + ti - 0.02, s, patient, 38)).toBe(0);
    expect(generateVentWaveformPoint(5 + ti + 0.4, s, patient).flow).toBeLessThan(0);
    expect(generateCapnography(5 + ti + 0.4, s, patient, 38)).toBeGreaterThan(0);
  });

  it('stays finite and bounded across all modes', () => {
    for (const mode of ['VCV', 'PCV', 'PRVC', 'SIMV', 'PSV', 'APRV'] as const) {
      const s = buildVentSettings({ ...params, mode });
      for (let t = 0; t < 12; t += 0.02) {
        const v = generateCapnography(t, s, { ...healthy, spontaneousRate: 12 }, 38);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(38);
      }
    }
  });
});