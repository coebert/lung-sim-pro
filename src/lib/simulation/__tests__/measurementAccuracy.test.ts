/**
 * Monitor accuracy against the trace itself: true VT is the trough-to-peak
 * volume excursion at 0.5 ms resolution; exhaled MV is ∫ negative flow.
 * The live monitor (50 Hz LiveSimulation) must match both.
 */
import { describe, it, expect } from 'vitest';
import { patients, getDefaultAllParams } from '../patients';
import { buildVentSettings, type AllModeParams, type PRVCSettings } from '../types';
import { generateVentWaveformPoint, prvcInspPressure } from '../waveformGenerators';
import { computeAPRV } from '../scoring';
import { LiveSimulation } from '../liveSimulation';

const P = (id: string) => patients.find(p => p.id === id)!;
const S = (id: string, patch: Partial<AllModeParams>) => buildVentSettings({ ...getDefaultAllParams(P(id)), ...patch } as AllModeParams);

function truth(id: string, patch: Partial<AllModeParams>, t0 = 60, t1 = 120) {
  const s = S(id, patch), p = P(id), dt = 0.0005;
  let mx = -Infinity, mn = Infinity, ex = 0;
  for (let t = t0; t < t1; t += dt) {
    const r = generateVentWaveformPoint(t, s, p);
    mx = Math.max(mx, r.volume); mn = Math.min(mn, r.volume);
    if (r.flow < 0) ex -= (r.flow / 60) * 1000 * dt;
  }
  return { vt: mx - mn, trough: mn, mvExhaled: (ex / 1000) * (60 / (t1 - t0)) };
}
function monitor(id: string, patch: Partial<AllModeParams>) {
  const sim = new LiveSimulation(S(id, patch), P(id));
  sim.run(120);
  return sim.measured;
}

describe('uncapped PRVC targets the exhaled (trough-to-peak) VT', () => {
  const cases: [string, Partial<AllModeParams>][] = [
    ['healthy', { respiratoryRate: 40, inspiratoryTime: 1.4, riseTime: 0.6, peep: 0, pMax: 50, tidalVolume: 200 }],
    ['ards', { respiratoryRate: 40, inspiratoryTime: 1.4, riseTime: 0.6, peep: 0, pMax: 50, tidalVolume: 200 }],
    ['copd', { respiratoryRate: 25, inspiratoryTime: 1.8, riseTime: 0.6, pMax: 50, tidalVolume: 200 }],
  ];
  // Matrix: rates, rise times and targets across lungs.
  for (const id of ['healthy', 'ards', 'copd', 'restrictive', 'bronchospasm']) {
    for (const rr of [10, 20, 35]) for (const rise of [0, 0.3, 0.6]) for (const vt of [300, 500]) {
      cases.push([id, { respiratoryRate: rr, inspiratoryTime: Math.min(1.4, 60 / rr - 0.2), riseTime: rise, peep: 5, pMax: 60, tidalVolume: vt }]);
    }
  }
  it.each(cases.map(([id, p]) => [`${id} ${JSON.stringify(p)}`, id, p] as const))('%s', (_n, id, patch) => {
    const s = S(id, { mode: 'PRVC', ...patch }) as PRVCSettings;
    if (prvcInspPressure(s, P(id)).limited) return; // capped cases are tested elsewhere
    const t = truth(id, { mode: 'PRVC', ...patch }, 30, 40);
    expect(Math.abs(t.vt - s.tidalVolume)).toBeLessThan(0.02 * s.tidalVolume + 1);
  });
  it.each([0, 1, 2])('live 50 Hz monitor shows the target: case %i', (i) => {
    const [id, patch] = cases[i];
    const m = monitor(id, { mode: 'PRVC', ...patch });
    expect(Math.abs(m.measuredTV - 200)).toBeLessThanOrEqual(5);
  });
});

describe('monitor VTe, MVe and PEEPi match the trace between samples', () => {
  it('healthy PCV RR12 Ti1 PEEP5 Pinsp15 rise0: VTe = true VT, no invented trapping', () => {
    const patch = { mode: 'PCV' as const, respiratoryRate: 12, inspiratoryTime: 1, peep: 5, pInsp: 15, riseTime: 0 };
    const t = truth('healthy', patch), m = monitor('healthy', patch);
    expect(t.vt).toBeGreaterThan(700);
    expect(Math.abs(m.measuredTV - t.vt)).toBeLessThan(0.02 * t.vt);
    expect(m.autoPEEP).toBeLessThan(0.3);
  });
  it('healthy VCV 600 mL RR40 Ti0.3: VTe steady at 600, MVe = ∫ exhaled flow (24 L/min), no invented PEEPi', () => {
    const patch = { mode: 'VCV' as const, tidalVolume: 600, respiratoryRate: 40, inspiratoryTime: 0.3 };
    const t = truth('healthy', patch);
    const sim = new LiveSimulation(S('healthy', patch), P('healthy'));
    const seen: number[] = [];
    for (let k = 0; k < 40; k++) { sim.run(3); if (k > 20) seen.push(sim.measured.measuredTV); }
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(590);
    expect(Math.max(...seen)).toBeLessThanOrEqual(610);
    expect(Math.abs(sim.measured.minuteVentilation - t.mvExhaled)).toBeLessThan(0.03 * t.mvExhaled);
    expect(sim.measured.autoPEEP).toBeLessThanOrEqual(t.trough / P('healthy').compliance + 0.3);
  });
});

describe('APRV scoring uses the waveform’s own release', () => {
  const frac = (id: string, patch: Partial<AllModeParams>) => {
    const s = S(id, { mode: 'APRV', ...patch }) as any, p = P(id);
    const c = s.tHigh + s.tLow, k = Math.ceil(100 / c);
    const vr = generateVentWaveformPoint(k * c + s.tHigh - 1e-4, s, p).volume;
    const ve = generateVentWaveformPoint((k + 1) * c - 1e-4, s, p).volume;
    return { score: computeAPRV(s, p), wave: vr > 1 ? (vr - ve) / vr : 0 };
  };
  it('equal pressures: no release in score or waveform', () => {
    const r = frac('healthy', { pHigh: 10, pLow: 10, tHigh: 4, tLow: 0.5 });
    expect(r.score.releaseFraction).toBe(0);
    expect(r.score.noRelease).toBe(true);
    expect(r.wave).toBe(0);
  });
  it.each([
    ['healthy', { pHigh: 28, pLow: 0, tHigh: 5, tLow: 0.1 }],
    ['ards', { pHigh: 28, pLow: 0, tHigh: 4.5, tLow: 0.2 }],
    ['bronchospasm', { pHigh: 25, pLow: 0, tHigh: 4, tLow: 0.5 }],
  ] as const)('%s: score release fraction = waveform release fraction', (id, patch) => {
    const r = frac(id, patch);
    expect(Math.abs(r.score.releaseFraction - r.wave)).toBeLessThan(0.005);
  });
});
