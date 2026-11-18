import { describe, it, expect } from 'vitest';
import { patients, getDefaultAllParams } from '../patients';
import { buildVentSettings } from '../types';
import { LiveSimulation } from '../liveSimulation';
import { computeAPRV } from '../scoring';

const get = (id: string) => patients.find(p => p.id === id)!;
const aprv = () => buildVentSettings({ ...getDefaultAllParams(get('healthy')), mode: 'APRV', pHigh: 25, pLow: 0, tHigh: 4, tLow: 0.5 });

function settle(id: string) {
  const p = get(id);
  // Breath-measured live simulation (same core as the app).
  const sim = new LiveSimulation(aprv(), p);
  sim.run(150);
  return { p, v: sim.vitals };
}

describe('APRV in severe bronchospasm', () => {
  it('flags severe gas trapping and offers no recruitment benefit', () => {
    const a = computeAPRV(aprv() as never, get('bronchospasm'));
    expect(a.gasTrapping).toBeGreaterThan(0.5);
    expect(a.recruitmentScore).toBe(0);
  });
  it('worsens CO₂, oxygenation and blood pressure versus baseline', () => {
    const { p, v } = settle('bronchospasm');
    expect(v.paco2!).toBeGreaterThan(p.baseEtCO2 + 10);
    expect(v.spo2).toBeLessThan(p.baseSpO2);
    expect(v.sbp).toBeLessThan(p.baseSBP - 20);
  });
  it('does not penalise ARDS with gas trapping', () => {
    expect(computeAPRV(aprv() as never, get('ards')).gasTrapping).toBe(0);
  });
});
