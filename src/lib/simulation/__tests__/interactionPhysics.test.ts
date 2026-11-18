/**
 * Independent checks of the event-timed SIMV/PSV and APRV-with-effort models:
 * expected values come from integrating the emitted flow trace, not from the
 * model's own summaries.
 */
import { describe, it, expect } from 'vitest';
import { patients, getDefaultAllParams } from '../patients';
import { buildVentSettings, type AllModeParams } from '../types';
import { generateVentWaveformPoint } from '../waveformGenerators';
import { LiveSimulation } from '../liveSimulation';

const P = (id: string) => patients.find(p => p.id === id)!;
const S = (id: string, patch: Partial<AllModeParams>) => buildVentSettings({ ...getDefaultAllParams(P(id)), ...patch } as AllModeParams);
const DT = 0.002;

function scan(id: string, patch: Partial<AllModeParams>, t0: number, t1: number) {
  const s = S(id, patch), p = P(id);
  let exhaled = 0, inspired = 0, maxJump = 0, maxMismatch = 0;
  let prev = generateVentWaveformPoint(t0, s, p);
  const v0 = prev.volume;
  let integ = v0;
  for (let t = t0 + DT; t <= t1 + 1e-9; t += DT) {
    const cur = generateVentWaveformPoint(t, s, p);
    const fMean = (prev.flow + cur.flow) / 2 / 60 * 1000; // mL/s
    if (fMean < 0) exhaled -= fMean * DT; else inspired += fMean * DT;
    integ += fMean * DT;
    const allowed = Math.max(Math.abs(prev.flow), Math.abs(cur.flow)) / 60 * 1000 * DT + 1;
    maxJump = Math.max(maxJump, Math.abs(cur.volume - prev.volume) - allowed);
    maxMismatch = Math.max(maxMismatch, Math.abs(integ - cur.volume));
    prev = cur;
  }
  return { exhaled, inspired, maxJump, maxMismatch, netVol: prev.volume - v0 };
}

describe('SIMV event timing (#1)', () => {
  it.each([[8], [10], [7]])('healthy-spont SIMV RR %i: measured MV matches integrated exhaled flow over 60–120 s', (rr) => {
    const patch = { mode: 'SIMV' as const, respiratoryRate: rr, pressureSupport: 5 };
    const sim = new LiveSimulation(S('healthy-spont', patch), P('healthy-spont'));
    sim.run(120);
    const { exhaled, maxJump } = scan('healthy-spont', patch, 60, 120);
    expect(sim.measured.minuteVentilation * 1000).toBeGreaterThan(exhaled * 0.93);
    expect(sim.measured.minuteVentilation * 1000).toBeLessThan(exhaled * 1.07);
    expect(maxJump).toBeLessThan(1); // volume continuous across variable intervals (incommensurate 60/7 vs 60/14 s)
  });
  it('mandatory and supported breaths both deliver volume, and no tick-boundary residual is lost', () => {
    const patch = { mode: 'SIMV' as const, respiratoryRate: 7, pressureSupport: 5, tidalVolume: 500 };
    const r = scan('healthy-spont', patch, 30, 150);
    // Over a long window inspired ≈ exhaled (residual carried, no drift).
    expect(Math.abs(r.inspired - r.exhaled)).toBeLessThan(0.03 * r.exhaled);
    const sim = new LiveSimulation(S('healthy-spont', patch), P('healthy-spont'));
    sim.run(90);
    expect(sim.measured.vtMandatory).toBeGreaterThan(400);
    expect(sim.measured.vtSupported).toBeGreaterThan(150);
  });
});

describe('APRV with spontaneous effort (#2)', () => {
  it('trace flow integrates to trace volume through releases and effort overlaps', () => {
    const r = scan('healthy-spont', { mode: 'APRV', pHigh: 20, pLow: 5, tHigh: 4, tLow: 0.6 }, 10, 70);
    expect(r.maxMismatch).toBeLessThan(5);
    expect(r.maxJump).toBeLessThan(1);
  });
  it('equal pressures: expired gas equals the patient’s own breathing, zero for a paralysed patient', () => {
    const spont = scan('healthy-spont', { mode: 'APRV', pHigh: 10, pLow: 10 }, 10, 70);
    expect(spont.exhaled / 1000).toBeGreaterThan(4); // L/min from effort alone
    const para = scan('healthy', { mode: 'APRV', pHigh: 10, pLow: 10 }, 10, 70);
    expect(para.exhaled).toBeLessThan(20);
  });
});
