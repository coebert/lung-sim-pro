/**
 * Regression tests for the November 2026 physiology/tutorial audit (issues 1–12).
 * Expected values are computed independently in each test from the linear
 * single-compartment RC model (C, R, set pressures) rather than from the app.
 */
import { describe, it, expect } from 'vitest';
import { patients, getDefaultAllParams } from '../patients';
import { AllModeParams, buildVentSettings, MeasuredValues, PRVCSettings, APRVSettings, VentSettings, PatientPhysiology } from '../types';
import { generateVentWaveformPoint, prvcInspPressure, aprvReleaseMetrics } from '../waveformGenerators';
import { LiveSimulation } from '../liveSimulation';
import { computeIE } from '../scoring';
import { evaluateAlarms, alarmLimitsFor } from '../alarms';
import { createInitialVitals, updateVitals } from '../engine';
import { tutorials, evaluateStep } from '../tutorials';

const P = (id: string) => patients.find(p => p.id === id)!;
const cfg = (id: string, patch: Partial<AllModeParams>) => buildVentSettings({ ...getDefaultAllParams(P(id)), ...patch });
function sim(id: string, patch: Partial<AllModeParams>, secs = 90) {
  const s = new LiveSimulation(cfg(id, patch), P(id));
  s.run(secs);
  return s;
}
/** Fine-grid scan of one cycle: min/max volume, start/end volume, ∫flow. */
function scan(s: VentSettings, p: PatientPhysiology, cycle: number, t0 = 100 * cycle, dt = 0.0002) {
  let vMin = Infinity, vMax = -Infinity, integ = 0;
  const start = generateVentWaveformPoint(t0, s, p).volume;
  for (let t = t0; t < t0 + cycle - dt / 2; t += dt) {
    const a = generateVentWaveformPoint(t, s, p);
    vMin = Math.min(vMin, a.volume); vMax = Math.max(vMax, a.volume);
    const b = generateVentWaveformPoint(t + dt, s, p);
    integ += ((a.flow + b.flow) / 2 / 60) * dt * 1000; // trapezoid, mL
  }
  const end = generateVentWaveformPoint(t0 + cycle - 1e-9, s, p).volume;
  return { vMin, vMax, vt: vMax - vMin, start, end, integ };
}

describe('1 · pressure breaths keep trapped volume (closed-form periodic RC)', () => {
  // Independent reference: C 0.07 L/cmH₂O, R 20 → τ 1.4 s; Ti 1.4, Te 0.1, ΔP 15 step.
  const tau = 1.4, C = 0.07, D = 15, kI = Math.exp(-1.4 / tau), kE = Math.exp(-0.1 / tau);
  const fill = D * C * (1 - kI) * 1000;
  const v0 = fill * kE / (1 - kI * kE);
  const refVT = fill - v0 * (1 - kI);
  it('reference values match the audit (≈70 mL, ≈13.4 cmH₂O)', () => {
    expect(refVT).toBeCloseTo(70, -1);
    expect(v0 / 70).toBeCloseTo(13.4, 1);
  });
  const copd = cfg('copd', { mode: 'PCV', respiratoryRate: 40, inspiratoryTime: 1.4, peep: 5, pInsp: 15, riseTime: 0 });
  it('COPD PCV RR 40 reproduces VT and intrinsic PEEP within 5%', () => {
    const r = scan(copd, P('copd'), 1.5);
    expect(Math.abs(r.vt - refVT) / refVT).toBeLessThan(0.05);
    expect(Math.abs(r.vMin / 70 - 13.4) / 13.4).toBeLessThan(0.05);
  });
  it('volume is continuous at the cycle boundary and at end-inspiration; ∫flow matches ΔV', () => {
    const r = scan(copd, P('copd'), 1.5);
    expect(Math.abs(r.end - r.start)).toBeLessThan(1);
    const t = 150 + 1.4;
    const a = generateVentWaveformPoint(t - 1e-6, copd, P('copd')).volume;
    const b = generateVentWaveformPoint(t + 1e-6, copd, P('copd')).volume;
    expect(Math.abs(a - b)).toBeLessThan(0.5);
    expect(Math.abs(r.integ)).toBeLessThan(1); // periodic ⇒ net flow ≈ 0
  });
  it('live measurement agrees with the reference (VT, iPEEP, PIP 20)', () => {
    const m = sim('copd', { mode: 'PCV', respiratoryRate: 40, inspiratoryTime: 1.4, peep: 5, pInsp: 15, riseTime: 0 }).measured;
    expect(Math.abs(m.measuredTV - refVT)).toBeLessThan(7);
    expect(m.autoPEEP).toBeCloseTo(13.4, 0);
    expect(m.peakPressure).toBe(20);
  });
  it.each([
    ['healthy, RR 40, Ti 3 requested, rise 0', 'healthy', { respiratoryRate: 40, inspiratoryTime: 3, peep: 0, pMax: 50, tidalVolume: 200, riseTime: 0 }],
    ['COPD long τ, short Te', 'copd', { respiratoryRate: 30, inspiratoryTime: 1.6, peep: 5, pMax: 50, tidalVolume: 300, riseTime: 0.15 }],
    ['maximum rise 0.6 s', 'healthy', { respiratoryRate: 14, peep: 5, pMax: 40, tidalVolume: 450, riseTime: 0.6 }],
  ] as const)('uncapped PRVC delivers its target VT: %s', (_n, id, patch) => {
    const s = cfg(id, { mode: 'PRVC', ...patch }) as PRVCSettings;
    const r = prvcInspPressure(s, P(id));
    expect(r.limited).toBe(false);
    const cyc = 60 / s.respiratoryRate, t0 = 100 * cyc;
    // Exhaled VT = end-inspiratory − end-expiratory volume.
    const vt = generateVentWaveformPoint(t0 + computeIE(s).iTime - 1e-9, s, P(id)).volume - generateVentWaveformPoint(t0, s, P(id)).volume;
    expect(Math.abs(vt - s.tidalVolume)).toBeLessThan(Math.max(20, 0.1 * s.tidalVolume) / 4);
  });
  it('target-limited PRVC caps Pinsp at Pmax − 5 − PEEP and delivers less', () => {
    const s = cfg('healthy', { mode: 'PRVC', tidalVolume: 800, pMax: 20, peep: 5 }) as PRVCSettings;
    const r = prvcInspPressure(s, P('healthy'));
    expect(r.limited).toBe(true);
    expect(r.pInsp).toBe(10);
    expect(scan(s, P('healthy'), 60 / 14).vt).toBeLessThan(800);
  });
});

describe('2 · APRV gas exchange follows delivered ventilation', () => {
  it('equal pressures: apnoea, no EtCO₂ number, oxygenation falls', () => {
    const s = sim('healthy', { mode: 'APRV', pHigh: 10, pLow: 10, tHigh: 4, tLow: 0.5, fio2: 0.4 }, 120);
    const v = s.displayedVitals();
    expect(s.measured.apnoea).toBe(true);
    expect(v.etco2).toBe(0);
    expect(v.etco2Status).toBe('unavailable');
    expect(v.spo2).toBeLessThan(P('healthy').baseSpO2 - 10);
  });
  it('longer T High (fewer releases) raises CO₂ with other settings fixed', () => {
    const co2 = [1, 4, 8].map(t => sim('ards', { mode: 'APRV', pHigh: 28, pLow: 0, tHigh: t, tLow: 0.5 }, 150).vitals.paco2!);
    expect(co2[1]).toBeGreaterThan(co2[0]);
    expect(co2[2]).toBeGreaterThan(co2[1]);
  });
});

describe('3 · paediatric case', () => {
  it('defaults are weight-based (7 mL/kg of 20 kg, RR 24, PEEP 6)', () => {
    const d = getDefaultAllParams(P('paediatric'));
    expect(d.tidalVolume).toBe(140);
    expect(d.respiratoryRate).toBe(24);
    expect(d.peep).toBe(6);
  });
  it('low-VT alarm limit is 4 mL/kg (80 mL) for the child, 200 mL for adults', () => {
    expect(alarmLimitsFor(P('paediatric')).tvLow).toBe(80);
    expect(alarmLimitsFor(P('healthy')).tvLow).toBe(200);
  });
  it('PCV 11, RR 24, PEEP 6 lands in 120–160 mL without a low-volume alarm', () => {
    const s = sim('paediatric', { mode: 'PCV', pInsp: 11, respiratoryRate: 24, peep: 6 });
    expect(s.measured.measuredTV).toBeGreaterThanOrEqual(120);
    expect(s.measured.measuredTV).toBeLessThanOrEqual(160);
    const a = evaluateAlarms(s.measured, s.displayedVitals(), alarmLimitsFor(P('paediatric')));
    expect(a.find(x => x.id === 'tv-low')!.active).toBe(false);
  });
});

describe('4 · tutorial predicates need the right mode and real ventilation', () => {
  const apnoeic: MeasuredValues = { peakPressure: 5, plateauPressure: 5, meanPressure: 5, measuredTV: 0, minuteVentilation: 0, measuredRR: 0, dynamicCompliance: 0, autoPEEP: 0, apnoea: true };
  const good: MeasuredValues = { peakPressure: 20, plateauPressure: 22, meanPressure: 10, measuredTV: 350, minuteVentilation: 7, measuredRR: 22, dynamicCompliance: 30, autoPEEP: 0, alveolarVentilation: 4 };
  const v = { hr: 90, sbp: 110, dbp: 65, spo2: 92, etco2: 45 };
  const ards = tutorials.find(t => t.patientId === 'ards' && !t.tabLabel && !t.title.startsWith('APRV'))!;
  const net = tutorials.find(t => t.tabLabel === 'ARDSNet')!;
  const base = { ...getDefaultAllParams(P('ards')), tidalVolume: 350 };
  it('ARDS step 1 cannot pass in PSV with zero ventilation', () => {
    expect(evaluateStep(ards.steps[0], { ...base, mode: 'PSV' }, v, apnoeic)).toBe(false);
    expect(evaluateStep(ards.steps[0], { ...base, mode: 'VCV' }, v, apnoeic)).toBe(false);
    expect(evaluateStep(ards.steps[0], { ...base, mode: 'VCV' }, v, good)).toBe(true);
  });
  it('ARDSNet final CO₂ step cannot pass after switching to PSV with EtCO₂ 0', () => {
    const last = net.steps[net.steps.length - 1];
    expect(evaluateStep(last, { ...base, mode: 'PSV' }, { ...v, etco2: 0 }, apnoeic)).toBe(false);
    expect(evaluateStep(last, { ...base, mode: 'VCV' }, { ...v, etco2: 0 }, apnoeic)).toBe(false);
  });
  const all = tutorials.flatMap(t => t.steps.map((s, i) => ({ t, s, i })));
  it.each(all.filter(x => x.s.needsVentilation).map(x => [`${x.t.title} #${x.i + 1}`, x] as const))('%s fails during apnoea and with stale measurements', (_n, { s }) => {
    const ok = { ...getDefaultAllParams(P('ards')), ...s.solution, mode: s.modes?.[0] ?? 'VCV' };
    expect(evaluateStep(s, ok, v, apnoeic)).toBe(false);
    expect(evaluateStep(s, ok, v, good, { fresh: false })).toBe(false);
    expect(evaluateStep(s, ok, v, { ...good, warmingUp: true })).toBe(false);
  });
  it.each(all.filter(x => x.s.modes).map(x => [`${x.t.title} #${x.i + 1}`, x] as const))('%s fails in a mode it does not apply to', (_n, { s }) => {
    const wrong = (['VCV', 'PCV', 'PRVC', 'SIMV', 'PSV', 'APRV'] as const).find(m => !s.modes!.includes(m))!;
    expect(evaluateStep(s, { ...getDefaultAllParams(P('ards')), ...s.solution, mode: wrong }, v, good)).toBe(false);
  });
  it('oxygen targets have upper bounds: ARDS 95%, COPD 92% (borderline)', () => {
    const fio2Step = ards.steps[2];
    const s = { ...base, mode: 'VCV' as const, fio2: 0.7 };
    expect(evaluateStep(fio2Step, s, { ...v, spo2: 95 }, good)).toBe(true);
    expect(evaluateStep(fio2Step, s, { ...v, spo2: 95.5 }, good)).toBe(false);
    const copd = tutorials.find(t => t.patientId === 'copd')!.steps[2];
    const cs = { ...getDefaultAllParams(P('copd')), mode: 'VCV' as const };
    expect(evaluateStep(copd, cs, { ...v, spo2: 92 }, { ...good, autoPEEP: 1 })).toBe(true);
    expect(evaluateStep(copd, cs, { ...v, spo2: 92.5 }, { ...good, autoPEEP: 1 })).toBe(false);
  });
  it('obstruction steps use applied expiration, not a dormant I:E value', () => {
    const step = tutorials.find(t => t.patientId === 'bronchospasm')!.steps[1];
    // I:E 1:4 stored but Ti 2.5 s active at RR 10 ⇒ applied 1:1.4
    const s = { ...getDefaultAllParams(P('bronchospasm')), respiratoryRate: 10, ieRatio: 4, inspiratoryTime: 2.5 };
    expect(evaluateStep(step, s, v, good)).toBe(false);
    expect(evaluateStep(step, { ...s, inspiratoryTime: 1.2 }, v, good)).toBe(true);
  });
});

describe('5 · PCV rise and shared timing', () => {
  it('Rise changes the PCV pressure and flow ramp', () => {
    const a = cfg('healthy', { mode: 'PCV', riseTime: 0 }), b = cfg('healthy', { mode: 'PCV', riseTime: 0.6 });
    const pa = generateVentWaveformPoint(0.1, a, P('healthy')), pb = generateVentWaveformPoint(0.1, b, P('healthy'));
    expect(pa.pressure).toBeCloseTo(20, 5);
    expect(pb.pressure).toBeCloseTo(5 + 15 * 0.1 / 0.6, 5);
    expect(pb.flow).toBeLessThan(pa.flow);
  });
  it('RR 40 with Ti 3.0 applies Ti 1.4 / Te 0.1 and reports the limit', () => {
    const ie = computeIE({ peep: 5, fio2: 0.4, respiratoryRate: 40, ieRatio: 2, inspiratoryTime: 3 });
    expect(ie.iTime).toBeCloseTo(1.4, 6);
    expect(ie.eTime).toBeCloseTo(0.1, 6);
    expect(ie.limited).toBe(true);
    expect(ie.basis).toBe('ti');
  });
});

describe('6 · SIMV minute ventilation sums the actual breaths', () => {
  it('MV equals Σ per-breath VT over the window, not largest VT × total rate', () => {
    const s = sim('healthy-spont', { mode: 'SIMV', respiratoryRate: 8, tidalVolume: 500, pressureSupport: 1 }, 120);
    const m = s.measured;
    expect(m.vtMandatory).toBeDefined();
    expect(m.vtSupported).toBeDefined();
    const expected = 8 * (m.vtMandatory! + m.vtSupported!) / 1000; // 1 mandatory + 1 supported per 7.5 s
    expect(Math.abs(m.minuteVentilation - expected)).toBeLessThan(0.15 * expected);
    expect(m.measuredRR).toBeCloseTo(16, 0);
  });
});

describe('7 · patient effort', () => {
  it('PS 0 in the self-ventilating adult still gives a patient-driven VT near 450 mL', () => {
    const m = sim('healthy-spont', { mode: 'PSV', pressureSupport: 0, peep: 5 }).measured;
    expect(m.apnoea).toBe(false);
    expect(m.measuredTV).toBeGreaterThan(400);
    expect(m.measuredTV).toBeLessThan(500);
    expect(m.measuredRR).toBeCloseTo(14, 0);
  });
  it('PSV in a paralysed patient produces no breaths (apnoea)', () => {
    expect(sim('healthy', { mode: 'PSV', pressureSupport: 10 }, 40).measured.apnoea).toBe(true);
  });
});

describe('8 · slow mandatory ventilation', () => {
  it('RR 4 (15 s breaths) stays stable and never alarms apnoea', () => {
    const s = new LiveSimulation(cfg('healthy', { respiratoryRate: 4, ieRatio: 4 }), P('healthy'));
    s.run(20);
    for (let k = 0; k < 40; k++) {
      s.run(1);
      expect(s.measured.apnoea).toBe(false);
      expect(s.measured.measuredTV).toBeGreaterThan(470);
    }
    expect(s.measured.minuteVentilation).toBeCloseTo(2.0, 1);
  });
  it('genuine absence of breaths alarms only after the apnoea time', () => {
    const s = new LiveSimulation(cfg('healthy', { mode: 'PSV' }), P('healthy'));
    s.run(15);
    expect(s.measured.apnoea).toBe(false);
    s.run(10);
    expect(s.measured.apnoea).toBe(true);
  });
});

describe('9 · APRV pressure, flow and volume share one trajectory', () => {
  const s = cfg('ards', { mode: 'APRV', pHigh: 28, pLow: 0, tHigh: 5, tLow: 0.5 }) as APRVSettings;
  it('net integrated flow over the periodic cycle ≈ 0', () => {
    expect(Math.abs(scan(s, P('ards'), 5.5, 0, 0.0002).integ)).toBeLessThan(1);
  });
  it('flow equals the volume derivative at 0.12 s', () => {
    const dt = 1e-3;
    const dv = (generateVentWaveformPoint(0.12 + dt, s, P('ards')).volume - generateVentWaveformPoint(0.12 - dt, s, P('ards')).volume) / (2 * dt);
    const flow = generateVentWaveformPoint(0.12, s, P('ards')).flow;
    expect(Math.abs(flow - dv * 60 / 1000) / flow).toBeLessThan(0.015);
  });
  it('release metrics: end-release flow falls with longer T Low', () => {
    const a = aprvReleaseMetrics(s, P('ards')).endToPeakFlowPct;
    const b = aprvReleaseMetrics({ ...s, tLow: 0.2 }, P('ards')).endToPeakFlowPct;
    expect(b).toBeGreaterThan(a);
    // Independent: ≈ e^(−T Low / 1.25τ), τ = 8 × 0.04 = 0.32 s, plus the 30 ms valve opening.
    expect(Math.abs(b - 100 * Math.exp(-0.2 / 0.4))).toBeLessThan(10);
  });
});

describe('10 · PRVC Pmax/PEEP conflict', () => {
  it('flags the conflict, separates it from the target alarm, and recovers from either setting', () => {
    const p = P('healthy');
    const bad = cfg('healthy', { mode: 'PRVC', peep: 25, pMax: 15 });
    const m = sim('healthy', { mode: 'PRVC', peep: 25, pMax: 15 }, 30);
    const a = evaluateAlarms(m.measured, m.displayedVitals(), alarmLimitsFor(p), bad, p);
    expect(a.find(x => x.id === 'prvc-conflict')!.active).toBe(true);
    expect(a.find(x => x.id === 'prvc-target')!.active).toBe(false);
    expect(prvcInspPressure(cfg('healthy', { mode: 'PRVC', peep: 25, pMax: 35 }) as PRVCSettings, p).conflict).toBe(false);
    expect(prvcInspPressure(cfg('healthy', { mode: 'PRVC', peep: 5, pMax: 15 }) as PRVCSettings, p).conflict).toBe(false);
  });
});

describe('11 · CO₂ and oxygenation basis', () => {
  it('equal total MV with smaller breaths gives lower alveolar ventilation and higher CO₂', () => {
    const small = sim('healthy', { tidalVolume: 200, respiratoryRate: 30 }, 150);
    const large = sim('healthy', { tidalVolume: 600, respiratoryRate: 10 }, 150);
    expect(Math.abs(small.measured.minuteVentilation - large.measured.minuteVentilation)).toBeLessThan(0.5);
    expect(small.measured.alveolarVentilation!).toBeLessThan(large.measured.alveolarVentilation!);
    expect(small.vitals.paco2!).toBeGreaterThan(large.vitals.paco2! + 20);
  });
  it('displayed EtCO₂ is sampled from the capnogram and flags a missing plateau', () => {
    const small = sim('healthy', { tidalVolume: 200, respiratoryRate: 30 }, 60).displayedVitals();
    expect(small.etco2Status).toBe('no-plateau');
    expect(small.etco2).toBeLessThan(small.paco2!);
  });
  it('a high resistive PIP with an acceptable plateau does not lower SpO₂', () => {
    const p = P('asthma'), s = cfg('asthma', {});
    const m = (peak: number): MeasuredValues => ({ peakPressure: peak, plateauPressure: 25, meanPressure: 10, measuredTV: 400, minuteVentilation: 5.6, measuredRR: 14, dynamicCompliance: 20, autoPEEP: 0 });
    let a = createInitialVitals(p), b = createInitialVitals(p);
    for (let i = 0; i < 200; i++) { a = updateVitals(s, p, a, m(50), false, 12.5); b = updateVitals(s, p, b, m(20), false, 12.5); }
    expect(a.spo2).toBeCloseTo(b.spo2, 6);
  });
});

describe('12 · obstructive APRV response is retained', () => {
  it('COPD on default APRV: intrinsic PEEP, desaturation, hypotension and hypercapnia', () => {
    const s = sim('copd', { mode: 'APRV' }, 150);
    expect(s.measured.autoPEEP).toBeGreaterThan(10);
    expect(s.vitals.spo2).toBeLessThan(85);
    expect(s.vitals.sbp).toBeLessThan(P('copd').baseSBP - 20);
    expect(s.vitals.paco2!).toBeGreaterThan(50);
  });
});
