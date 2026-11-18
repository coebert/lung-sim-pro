import { describe, it, expect } from 'vitest';
import { ecgAtBeat, ecgTiming, abpAtBeat, plethAtBeat, CardiacClock } from '../waveformGenerators';

const at = (t0: number, cycle: number) => ecgAtBeat({ t0, cycle });
const RATES = [50, 60, 72, 90, 110, 130, 150, 180];

describe('sinus ECG morphology', () => {
  it('adult timing at 72/min: PR 0.16 s, QRS 0.08 s, T separate', () => {
    const e = ecgTiming(60 / 72);
    expect(e.pr).toBeCloseTo(0.16, 6);
    expect(e.qrsEnd - e.qrsOn).toBeCloseTo(0.08, 6);
    expect(e.tOn).toBeGreaterThan(e.qrsEnd + 0.05);
  });
  for (const hr of RATES) {
    const c = Math.round((60 / hr) * 50) / 50;
    it(`HR ${hr}: upright P, flat PR, narrow QRS, upright T ending before next P`, () => {
      const e = ecgTiming(c);
      const dt = 0.001;
      const pPeak = Math.max(...Array.from({ length: Math.round(e.pDur / dt) }, (_, i) => at(i * dt, c)));
      expect(pPeak).toBeGreaterThan(0.12);
      for (let t = e.pDur; t < e.qrsOn; t += dt) expect(Math.abs(at(t, c))).toBeLessThan(1e-9);
      expect(e.qrsOn - e.pDur).toBeGreaterThanOrEqual(0.03);
      expect(at(e.rPeak, c)).toBeCloseTo(1, 6);
      expect(at(e.qrsOn + 0.02, c)).toBeLessThan(-0.05);
      expect(at(e.qrsOn + 0.06, c)).toBeLessThan(-0.15);
      for (let t = e.qrsEnd; t < e.tOn; t += dt) expect(Math.abs(at(t, c))).toBeLessThan(1e-9);
      expect(at((e.tOn + e.tEnd) / 2, c)).toBeCloseTo(0.3, 6);
      expect(e.tEnd).toBeLessThanOrEqual(c - 0.029);
      for (let t = e.tEnd; t < c; t += dt) expect(Math.abs(at(t, c))).toBeLessThan(1e-9);
    });
  }
  it('50 Hz live clock: identical R every beat, HR beat count, R → ABP → pleth order', () => {
    for (const hr of [60, 72, 88, 120, 150]) {
      const clk = new CardiacClock();
      const ecg: number[] = [], abp: number[] = [], pl: number[] = [];
      for (let i = 0; i < 50 * 60; i++) { const bt = clk.next(hr); ecg.push(ecgAtBeat(bt)); abp.push(abpAtBeat(bt, 120, 70)); pl.push(plethAtBeat(bt)); }
      const peaks = ecg.map((v, i) => (v > 0.5 && v >= ecg[i - 1] && v > ecg[i + 1] ? i : -1)).filter(i => i > 0);
      const amps = peaks.map(i => ecg[i]);
      expect(Math.max(...amps) - Math.min(...amps)).toBeLessThan(1e-9);
      const cyc = Math.round((60 / hr) * 50);
      expect(peaks.length).toBe(Math.floor((3000 - peaks[0]) / cyc) + (((3000 - peaks[0]) % cyc) ? 1 : 0));
      const gaps = peaks.slice(1).map((p, i) => p - peaks[i]);
      expect(new Set(gaps).size).toBe(1);
      const k = peaks[3], argmax = (a: number[]) => { let m = k; for (let i = k; i < k + cyc; i++) if (a[i] > a[m]) m = i; return m; };
      expect(argmax(abp)).toBeGreaterThan(k);
      expect(argmax(pl)).toBeGreaterThan(argmax(abp));
    }
  });
});
