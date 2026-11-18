import { describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
afterEach(cleanup);
import { VentilatorControls } from '@/components/simulator/VentilatorControls';
import { patients, getDefaultAllParams } from '@/lib/simulation/patients';
import { AllModeParams, buildVentSettings } from '@/lib/simulation/types';
import { generateVentWaveformPoint, vcvBreath } from '@/lib/simulation/waveformGenerators';
import { LiveSimulation } from '@/lib/simulation/liveSimulation';
import { evaluateAlarms, alarmLimitsFor } from '@/lib/simulation/alarms';

const P = (id: string) => patients.find(p => p.id === id)!;
const cfg = (id: string, patch: Partial<AllModeParams>) => buildVentSettings({ ...getDefaultAllParams(P(id)), ...patch });
const impossible = { respiratoryRate: 20, inspiratoryTime: 0.3, tidalVolume: 800, peep: 5, pLimit: 20 };

describe('SIMV/VCV mandatory pressure limit when delivery is impossible', () => {
  const copd = P('copd');
  it('required resistive pressure alone exceeds the limit (analytic check)', () => {
    const q = 0.8 / 0.3; // L/s
    expect(5 + q * copd.resistance).toBeGreaterThan(20);
  });
  for (const mode of ['SIMV', 'VCV'] as const) {
    it(`${mode}: Paw never exceeds the limit, no inspiratory flow, sub-ms included`, () => {
      const s = cfg('copd', { mode, ...impossible });
      for (const t0 of [0, 60, 120]) for (const dt of [0, 0.0001, 0.0003, 0.0009, 0.002, 0.1, 0.29]) {
        const w = generateVentWaveformPoint(t0 + dt, s, copd);
        expect(w.pressure).toBeLessThanOrEqual(20 + 1e-6);
        expect(w.flow).toBeLessThan(5); // only cardiogenic oscillation at most
      }
    });
  }
  it('VCV analytic branch returns a zero-volume breath', () => {
    const b = vcvBreath(cfg('copd', { mode: 'VCV', ...impossible }) as never, copd);
    expect(b.limited).toBe(true);
    expect(b.spec.vt).toBe(0);
  });
  it('live SIMV: apnoea / low-volume alarm with ~0 mL, then recovers on a feasible setting', () => {
    const sim = new LiveSimulation(cfg('copd', { mode: 'SIMV', ...impossible }), copd);
    sim.run(40);
    expect(sim.measured.measuredTV).toBeLessThan(50);
    expect(sim.measured.peakPressure).toBeLessThanOrEqual(20.5);
    const al = evaluateAlarms(sim.measured, sim.vitals, alarmLimitsFor(copd));
    expect(al.some((a: { active: boolean }) => a.active)).toBe(true);
    sim.setSettings(cfg('copd', { mode: 'SIMV', respiratoryRate: 12, inspiratoryTime: 1, tidalVolume: 450, peep: 5, pLimit: 40 }), false);
    sim.run(60);
    expect(sim.measured.measuredTV).toBeGreaterThan(350);
    expect(sim.measured.peakPressure).toBeLessThanOrEqual(40);
  });
});

describe('APRV release readout', () => {
  const aprv = { mode: 'APRV' as const, pHigh: 28, pLow: 0, tHigh: 5, tLow: 0.5 };
  it('spontaneous patient: readout says passive reference', () => {
    render(<VentilatorControls settings={cfg('healthy-spont', aprv)} patient={P('healthy-spont')} onUpdate={() => {}} />);
    expect(screen.getByText(/passive ref\./)).toBeInTheDocument();
    expect(screen.getByText(/passive reference release \d+ mL/)).toBeInTheDocument();
  });
  it('paralysed patient: plain release readout', () => {
    render(<VentilatorControls settings={cfg('healthy', aprv)} patient={P('healthy')} onUpdate={() => {}} />);
    expect(screen.queryByText(/passive ref/)).toBeNull();
    expect(screen.getByText(/release \d+ mL/)).toBeInTheDocument();
  });
});
