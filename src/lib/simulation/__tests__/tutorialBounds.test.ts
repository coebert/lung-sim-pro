/** Every tutorial tolerance tested just inside and just outside its stated limits. */
import { describe, it, expect } from 'vitest';
import { tutorials, evaluateStep } from '../tutorials';
import { patients, getDefaultAllParams } from '../patients';
import { buildVentSettings, type AllModeParams, type MeasuredValues, type Vitals } from '../types';
import { LiveSimulation } from '../liveSimulation';

const P = (id: string) => patients.find(p => p.id === id)!;
const lesson = (id: string, tab?: string) => tab === 'APRV' ? tutorials.find(t => t.patientId === id && t.title.startsWith('APRV'))! : tutorials.find(t => t.patientId === id && (tab ? t.tabLabel === tab : !t.tabLabel))!;
const goodV: Vitals = { spo2: 93, etco2: 40, etco2Status: 'plateau', paco2: 40, hr: 80, sbp: 120, dbp: 70, map: 87 } as Vitals;
const goodM = (vt: number): MeasuredValues => ({ peakPressure: 20, plateauPressure: 20, meanPressure: 10, autoPEEP: 0, measuredTV: vt, minuteVentilation: 7, measuredRR: 20, dynamicCompliance: 40, warmingUp: false, freshRevision: 1 });
function ok(id: string, step: number, patch: Partial<AllModeParams>, opts: { tab?: string; v?: Partial<Vitals>; m?: Partial<MeasuredValues> } = {}) {
  const t = lesson(id, opts.tab);
  const s = { ...getDefaultAllParams(P(id)), ...patch } as AllModeParams;
  const vt = (patch.tidalVolume ?? s.tidalVolume);
  return evaluateStep(t.steps[step], s, { ...goodV, ...opts.v }, { ...goodM(vt), ...opts.m }, { fresh: true });
}

describe('tolerances match the copy', () => {
  type Row = [string, string, number, keyof AllModeParams, number[], number[], string?];
  it.each<Row>([
    ['ards PEEP 12–16', 'ards', 1, 'peep', [11, 17], [12, 16]],
    ['obese VT 420–560', 'obese', 0, 'tidalVolume', [410, 570], [420, 560]],
    ['obese PEEP 10–14', 'obese', 1, 'peep', [9, 15], [10, 14]],
    ['bronchospasm PEEP 3–5', 'bronchospasm', 2, 'peep', [2, 6], [3, 5]],
    ['restrictive RR 18–22', 'restrictive', 1, 'respiratoryRate', [17, 23], [18, 22]],
    ['copd VT 420–560', 'copd', 0, 'tidalVolume', [410, 570], [420, 560]],
    ['aprv P High 25–30', 'ards', 1, 'pHigh', [24, 31], [25, 30], 'APRV'],
  ])('%s', (_n, id, step, field, outside, inside, tab) => {
    const base: Partial<AllModeParams> = tab ? { mode: 'APRV' } : { mode: 'VCV' };
    for (const x of outside) expect(ok(id, step, { ...base, [field]: x }, { tab })).toBe(false);
    for (const x of inside) expect(ok(id, step, { ...base, [field]: x }, { tab })).toBe(true);
  });
  it('restrictive VT 325–390 set and delivered', () => {
    for (const x of [320, 400]) expect(ok('restrictive', 0, { mode: 'VCV', tidalVolume: x })).toBe(false);
    for (const x of [330, 390]) expect(ok('restrictive', 0, { mode: 'VCV', tidalVolume: x })).toBe(true);
  });
  it('restrictive oxygenation needs PEEP 5–8', () => {
    for (const x of [0, 4, 9, 15]) expect(ok('restrictive', 2, { mode: 'VCV', peep: x })).toBe(false);
    for (const x of [5, 8]) expect(ok('restrictive', 2, { mode: 'VCV', peep: x })).toBe(true);
  });
  it('COPD rate 10–14 (RR 4 is not credited)', () => {
    for (const x of [4, 9, 15]) expect(ok('copd', 1, { mode: 'VCV', respiratoryRate: x, ieRatio: 4, inspiratoryTime: 0 })).toBe(false);
    for (const x of [10, 14]) expect(ok('copd', 1, { mode: 'VCV', respiratoryRate: x, ieRatio: 4, inspiratoryTime: 0 })).toBe(true);
    expect(ok('copd', 2, { mode: 'VCV', respiratoryRate: 4 }, { v: { spo2: 90 } })).toBe(false);
  });
  it('APRV P Low must be exactly 0 as taught', () => {
    for (const x of [1, 2]) expect(ok('ards', 2, { mode: 'APRV', pLow: x, pHigh: 28 }, { tab: 'APRV' })).toBe(false);
    expect(ok('ards', 2, { mode: 'APRV', pLow: 0, pHigh: 28 }, { tab: 'APRV' })).toBe(true);
  });
  it('ARDSNet: 4 mL/kg floor (280) and RR ≤ 35 in the final step; FiO₂ must be an exact table row', () => {
    const v = { spo2: 90, etco2: 55 };
    expect(ok('ards', 5, { mode: 'VCV', tidalVolume: 250, respiratoryRate: 35 }, { tab: 'ARDSNet', v })).toBe(false);
    expect(ok('ards', 5, { mode: 'VCV', tidalVolume: 280, respiratoryRate: 35 }, { tab: 'ARDSNet', v })).toBe(true);
    expect(ok('ards', 5, { mode: 'VCV', tidalVolume: 280, respiratoryRate: 36 }, { tab: 'ARDSNet', v })).toBe(false);
    expect(ok('ards', 3, { mode: 'VCV', fio2: 0.76, peep: 14 }, { tab: 'ARDSNet', v })).toBe(false);
    expect(ok('ards', 3, { mode: 'VCV', fio2: 0.8, peep: 14 }, { tab: 'ARDSNet', v })).toBe(true);
  });
  it('healthy: no "minimal FiO₂" praise at FiO₂ 1.0', () => {
    expect(ok('healthy', 2, { mode: 'VCV', peep: 5, fio2: 1 }, { v: { spo2: 100 } })).toBe(false);
    expect(ok('healthy', 2, { mode: 'VCV', peep: 5, fio2: 0.4 }, { v: { spo2: 97 } })).toBe(true);
    expect(ok('healthy', 2, { mode: 'VCV', peep: 5, fio2: 0.41 }, { v: { spo2: 97 } })).toBe(false);
  });
  it('healthy MV accepted 5.5–9 L/min as stated', () => {
    expect(ok('healthy', 1, { mode: 'VCV', respiratoryRate: 14 }, { m: { minuteVentilation: 5.4 } })).toBe(false);
    expect(ok('healthy', 1, { mode: 'VCV', respiratoryRate: 14 }, { m: { minuteVentilation: 5.5 } })).toBe(true);
    expect(ok('healthy', 1, { mode: 'VCV', respiratoryRate: 14 }, { m: { minuteVentilation: 9.1 } })).toBe(false);
  });
  it('sepsis SBP ≥ 80 as worded', () => {
    expect(ok('sepsis', 2, { mode: 'VCV', peep: 8 }, { v: { spo2: 93, sbp: 80 } })).toBe(true);
    expect(ok('sepsis', 2, { mode: 'VCV', peep: 8 }, { v: { spo2: 93, sbp: 79 } })).toBe(false);
  });
});

describe('no false reassurance from undelivered volume', () => {
  it('ARDS on target-limited PRVC (VT 350, PEEP 10, Pmax 17, RR 14): step 1 is not credited', () => {
    const s = buildVentSettings({ ...getDefaultAllParams(P('ards')), mode: 'PRVC', tidalVolume: 350, peep: 10, pMax: 17, respiratoryRate: 14 } as AllModeParams);
    const sim = new LiveSimulation(s, P('ards'));
    sim.run(100);
    expect(sim.measured.measuredTV).toBeLessThan(150);
    const all = { ...getDefaultAllParams(P('ards')), mode: 'PRVC', tidalVolume: 350, peep: 10, pMax: 17, respiratoryRate: 14 } as AllModeParams;
    expect(evaluateStep(lesson('ards').steps[0], all, sim.displayedVitals(), sim.measured, { fresh: true })).toBe(false);
  });
  it('ARDS step 1: delivered VT below 270 mL fails even when the set VT is protective', () => {
    expect(ok('ards', 0, { mode: 'VCV', tidalVolume: 350 }, { m: { measuredTV: 260 } })).toBe(false);
    expect(ok('ards', 0, { mode: 'VCV', tidalVolume: 350 }, { m: { measuredTV: 350 } })).toBe(true);
  });
});
