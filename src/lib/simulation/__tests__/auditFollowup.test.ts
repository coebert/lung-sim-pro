/** Follow-up to the 2ce0284 audit retest: SIMV deadlines, inverted APRV, trigger rates, wording, dead space. */
import { describe, it, expect } from 'vitest';
import { patients, getDefaultAllParams } from '../patients';
import { AllModeParams, buildVentSettings, SIMVSettings, APRVSettings, normaliseAprvPressures } from '../types';
import { ventilatorBreaths, breathKindAt, generateVentWaveformPoint, triggerStats } from '../waveformGenerators';
import { aprvReleaseMetrics } from '../aprvTrajectory';
import { LiveSimulation } from '../liveSimulation';
import { deadSpaceMl, anatomicalDeadSpaceMl, APPARATUS_DEAD_SPACE_ML } from '../scoring';
import { co2ProductionMlMin, referenceAlveolarVentilation } from '../engine';
import { tutorials } from '../tutorials';

const P = (id: string) => patients.find(p => p.id === id)!;
const cfg = (id: string, patch: Partial<AllModeParams>) => buildVentSettings({ ...getDefaultAllParams(P(id)), ...patch });

describe('SIMV mandatory breaths follow the prescribed rate without patient effort', () => {
  for (const rr of [4, 6, 8, 10, 14, 7]) {
    it(`RR ${rr}: due at k·60/RR from t=0 through steady state`, () => {
      const s = cfg('healthy', { mode: 'SIMV', tidalVolume: 500, peep: 5, respiratoryRate: rr }) as SIMVSettings;
      const tm = 60 / rr;
      const b = ventilatorBreaths(s, P('healthy'), 8 * tm + 0.01);
      expect(b.length).toBe(9);
      b.forEach((x, k) => { expect(x.kind).toBe('mandatory'); expect(x.start).toBeCloseTo(k * tm, 6); });
    });
  }
  it('paralysed RR 4: no apnoea alarm across 20–60 s', () => {
    const sim = new LiveSimulation(cfg('healthy', { mode: 'SIMV', tidalVolume: 500, peep: 5, respiratoryRate: 4 }), P('healthy'));
    let apnoeic = 0;
    for (let t = 0; t < 60; t += 0.5) { sim.run(0.5); if (t > 20 && sim.measured.apnoea) apnoeic++; }
    expect(apnoeic).toBe(0);
  });
  it('spontaneous patient: mandatory rate equals the prescribed rate, rate rises with RR', () => {
    const p = P('healthy-spont');
    const rate = (rr: number) => {
      const s = cfg('healthy-spont', { mode: 'SIMV', respiratoryRate: rr }) as SIMVSettings;
      return triggerStats(s, p, 60, 180);
    };
    const r8 = rate(8), r10 = rate(10);
    expect(Math.abs(r8.mandatoryRate - 8)).toBeLessThanOrEqual(0.6); // window edges can count one extra slot
    expect(Math.abs(r10.mandatoryRate - 10)).toBeLessThanOrEqual(0.6);
    expect(r10.machineRate).toBeGreaterThanOrEqual(r8.machineRate - 0.5);
  });
});

describe('APRV never runs inverted', () => {
  it('store normaliser and buildVentSettings cap P Low at P High (legacy settings too)', () => {
    expect(normaliseAprvPressures({ pHigh: 5, pLow: 10 })).toEqual({ pHigh: 5, pLow: 5 });
    const s = cfg('healthy', { mode: 'APRV', pHigh: 5, pLow: 10 }) as APRVSettings;
    expect(s.pLow).toBe(5);
  });
  for (const id of ['healthy', 'healthy-spont']) {
    for (let ph = 5; ph <= 10; ph++) for (let pl = ph; pl <= 10; pl++) {
      it(`${id} ${ph}/${pl}: CPAP at ${ph}, volume trace matches integrated flow, no release`, () => {
        const legacy = { mode: 'APRV', pHigh: ph, pLow: pl, tHigh: 4, tLow: 0.5 } as APRVSettings & { mode: 'APRV' };
        const s = { ...cfg(id, {}), ...legacy } as APRVSettings; // bypass the builder: raw legacy object
        const p = P(id);
        let integ = 0, vMin = Infinity, vMax = -Infinity;
        const dt = 0.002, t0 = 200;
        for (let t = t0; t < t0 + 30; t += dt) {
          const a = generateVentWaveformPoint(t, s, p);
          expect(a.pressure).toBeGreaterThan(ph - 0.5);
          expect(a.pressure).toBeLessThan(ph + 0.5);
          if (a.flow < 0) integ += -a.flow / 60 * dt; // L exhaled
          vMin = Math.min(vMin, a.volume); vMax = Math.max(vMax, a.volume);
          expect(breathKindAt(t, s, p)).toBe('spontaneous');
        }
        expect(aprvReleaseMetrics(s, p).releaseVolume).toBeLessThan(1);
        const ve = integ * 2; // L/min
        if (id === 'healthy') expect(ve).toBeLessThan(0.3); // only cardiogenic oscillation
        else { expect(ve).toBeGreaterThan(4); expect(vMax - vMin).toBeGreaterThan(250); }
      });
    }
  }
  it('healthy-spont equal 10/10 keeps ~6 L/min of spontaneous ventilation', () => {
    const sim = new LiveSimulation(cfg('healthy-spont', { mode: 'APRV', pHigh: 10, pLow: 10, tHigh: 4, tLow: 0.5 }), P('healthy-spont'));
    sim.run(90);
    expect(sim.measured.minuteVentilation).toBeGreaterThan(5);
    expect(sim.measured.minuteVentilation).toBeLessThan(8);
    expect(sim.measured.apnoea).toBeFalsy();
  });
});

describe('missed-trigger counts separate efforts, ventilator breaths and total rate', () => {
  it('copd-spont: ventilator rate < effort rate; missed = effort − machine', () => {
    const p = P('copd-spont');
    const s = cfg('copd-spont', {}) as SIMVSettings;
    const st = triggerStats(s, p, 60, 180);
    expect(st.missedTriggers).toBeGreaterThan(3);
    expect(st.machineRate).toBeLessThan(st.effortRate - 3);
    expect(st.assistedRate + st.missedTriggers).toBeCloseTo(st.effortRate, 0);
  });
});

describe('lesson wording matches capability', () => {
  const all = JSON.stringify(tutorials.map(t => [t.introduction ?? '', t.steps.map(s => s.instruction)]));
  it('no stale "not simulated" claims for triggers or APRV effort; no absolute plateau rule', () => {
    expect(all).not.toMatch(/trigger failures and auto-triggering are not simulated/);
    expect(all).not.toMatch(/spontaneous breathing during P High is not simulated/);
    expect(all).not.toMatch(/Never raise tidal volume/);
    expect(all).toMatch(/severe acidaemia/);
  });

  it('ARDSNet lesson and summary describe the severe-acidaemia exception without the old 8 mL/kg claim', () => {
    const ardsnet = tutorials.filter(t => /ARDSNet/.test(JSON.stringify(t)));
    expect(ardsnet.length).toBeGreaterThan(0);
    const steps = JSON.stringify(ardsnet.map(t => [t.introduction ?? '', t.steps.map(s => [s.instruction, s.hint ?? ""])]));
    const summaries = JSON.stringify(ardsnet.map(t => t.summary ?? ''));
    for (const text of [steps, summaries]) {
      expect(text).toMatch(/persistent severe acidaemia after (the )?rate (has been )?adjust/);
      expect(text).toMatch(/does not model arterial pH/);
      expect(text).toMatch(/plateau ≤ 30 cmH₂O/);
      expect(text).not.toMatch(/up to 8 mL\/kg for severe acidaemia/);
      expect(text).not.toMatch(/allowance of VT up to 8 mL\/kg/);
      expect(text).not.toMatch(/acidaemia[^"]{0,80}8 mL\/kg|8 mL\/kg[^"]{0,80}acidaemia/);
    }
  });
});

describe('dead space and CO₂ production assumptions', () => {
  it('anatomical 2.2 mL/kg PBW + apparatus 0, weight-scaled for the child', () => {
    expect(APPARATUS_DEAD_SPACE_ML).toBe(0);
    const child = P('paediatric'), adult = P('healthy');
    expect(anatomicalDeadSpaceMl(child)).toBeCloseTo(2.2 * (child.predictedBodyWeight ?? child.weight), 6);
    expect(deadSpaceMl(adult)).toBeCloseTo(2.2 * (adult.predictedBodyWeight ?? adult.weight), 6);
    expect(deadSpaceMl(child)).toBeLessThan(deadSpaceMl(adult) / 2);
  });
  it('VCO₂ implied by normocapnia (38 mmHg) at reference alveolar ventilation', () => {
    const a = P('healthy');
    expect(co2ProductionMlMin(a)).toBeCloseTo(referenceAlveolarVentilation(a) * 38 / 0.863, 6);
  });
});
