import { describe, it, expect } from 'vitest';
import { breathDrive, cardiacDrive, lungShape, smoothStep } from './lungMotion';
import { CardiacClock, ecgAtBeat, generateVentWaveformPoint } from '@/lib/simulation/waveformGenerators';
import { patients, getDefaultAllParams } from '@/lib/simulation/patients';
import { buildVentSettings, AllModeParams } from '@/lib/simulation/types';

const P = (id: string) => patients.find(p => p.id === id)!;
const trace = (id: string, patch: Partial<AllModeParams>, secs = 30) => {
  const s = buildVentSettings({ ...getDefaultAllParams(P(id)), ...patch });
  return Array.from({ length: secs * 50 }, (_, i) => generateVentWaveformPoint(100 + i / 50, s, P(id)).volume);
};

describe('Lung View breath drive follows the live volume trace', () => {
  it('healthy VCV: near-zero end-expiratory volume, full tidal excursion at peak', () => {
    const v = trace('healthy', { mode: 'VCV', tidalVolume: 500, respiratoryRate: 12 });
    const win = 300;
    const peakIdx = v.length - win + v.slice(-win).indexOf(Math.max(...v.slice(-win)));
    const d = breathDrive(v.slice(0, peakIdx + 1), P('healthy').optimalTV, win);
    expect(d.eev).toBeLessThan(25);
    expect(d.tidal).toBeGreaterThan(400);
  });
  it('severe bronchospasm at fast rate: persistent end-expiratory volume raises baseline, diaphragm lower and flatter', () => {
    const fast = trace('bronchospasm', { mode: 'VCV', respiratoryRate: 28, tidalVolume: 500 });
    const slow = trace('bronchospasm', { mode: 'VCV', respiratoryRate: 8, tidalVolume: 500 });
    const ref = P('bronchospasm').optimalTV;
    const dF = breathDrive(fast, ref, 120), dS = breathDrive(slow, ref, 420);
    expect(dF.eev).toBeGreaterThan(dS.eev + 50);
    const sF = lungShape({ ...dF, tidal: 0, tidalFrac: 0 }, 1, 0), sS = lungShape({ ...dS, tidal: 0, tidalFrac: 0 }, 1, 0);
    expect(sF.baseline).toBeGreaterThan(sS.baseline);
    expect(sF.diaphragmY).toBeGreaterThan(sS.diaphragmY);
    expect(sF.domeHeight).toBeLessThan(sS.domeHeight);
  });
  it('reduced tidal volume reduces excursion, not baseline', () => {
    const a = lungShape({ eev: 0, tidal: 500, trapFrac: 0, tidalFrac: 1 }, 1, 0);
    const b = lungShape({ eev: 0, tidal: 250, trapFrac: 0, tidalFrac: 0.5 }, 1, 0);
    expect(a.baseline).toBe(b.baseline);
    expect(a.expansion).toBeGreaterThan(b.expansion);
  });
  it('atelectasis is regional (basal loss), not global over-inflation', () => {
    const d = { eev: 0, tidal: 0, trapFrac: 0, tidalFrac: 0 };
    const atel = lungShape(d, 0.8, 0.8), none = lungShape(d, 0.8, 0);
    expect(atel.basalLoss).toBeGreaterThan(0.3);
    expect(atel.expansion).toBe(none.expansion);
    expect(atel.diaphragmY).toBeLessThan(none.diaphragmY); // base rises with lower-zone collapse
  });
  it('frozen buffer gives a static drive; smoothing is bounded', () => {
    const v = trace('healthy', { mode: 'VCV' }, 10);
    expect(breathDrive(v, 500, 300)).toEqual(breathDrive([...v], 500, 300));
    expect(smoothStep(0, 100, 1000)).toBeLessThanOrEqual(100);
    expect(smoothStep(0, 100, 16)).toBeGreaterThan(0);
  });
});

describe('heart motion uses the shared ECG beats', () => {
  it('ventricles contract only after QRS, atria before the next R, period equals RR', () => {
    for (const hr of [60, 90, 130]) {
      const clk = new CardiacClock();
      const ecg = Array.from({ length: 500 }, () => ecgAtBeat(clk.next(hr)));
      const cyc = Math.round((60 / hr) * 50);
      let seenV = false;
      for (let n = 200; n < 500; n++) {
        const c = cardiacDrive(ecg.slice(0, n));
        expect(c.rr).toBeCloseTo(cyc / 50, 6);
        if (c.sinceR! < 0.05) expect(c.ventricular).toBe(0);
        if (c.ventricular > 0) { seenV = true; expect(c.atrial).toBe(0); }
      }
      expect(seenV).toBe(true);
      const a = cardiacDrive(ecg.slice(0, 300)), b = cardiacDrive(ecg.slice(0, 300 + cyc));
      expect(b.ventricular).toBeCloseTo(a.ventricular, 9);
    }
  });
});
