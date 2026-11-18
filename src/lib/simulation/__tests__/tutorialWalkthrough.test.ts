import { describe, it, expect } from 'vitest';
import { tutorials, evaluateStep } from '../tutorials';
import { patients, getDefaultAllParams } from '../patients';
import { AllModeParams, buildVentSettings } from '../types';
import { LiveSimulation } from '../liveSimulation';

const SETTLE_SEC = 120;

function walk(tIdx: number) {
  const t = tutorials[tIdx];
  const p = patients.find(x => x.id === t.patientId)!;
  let all: AllModeParams = getDefaultAllParams(p);
  const sim = new LiveSimulation(buildVentSettings(all), p);
  const results: { step: string; pass: boolean; detail: string }[] = [];
  for (const step of t.steps) {
    const patch = { ...step.solution };
    if ('ieRatio' in patch && !('inspiratoryTime' in patch)) patch.inspiratoryTime = 0;
    const modeChanged = patch.mode !== undefined && patch.mode !== all.mode;
    all = { ...all, ...patch };
    sim.setSettings(buildVentSettings(all), modeChanged);
    sim.run(SETTLE_SEC);
    const v = sim.displayedVitals(), m = sim.measured;
    results.push({
      step: step.title,
      pass: evaluateStep(step, all, v, m, { fresh: m.freshRevision === sim.revision }),
      detail: `VT ${m.measuredTV} RR ${m.measuredRR} MV ${m.minuteVentilation} Pplat ${m.plateauPressure} iPEEP ${m.autoPEEP} SpO2 ${v.spo2.toFixed(1)} Et ${v.etco2} SBP ${v.sbp.toFixed(0)}`,
    });
  }
  return { t, results };
}

describe('every tutorial passes a valid walkthrough using its hinted solutions', () => {
  it.each(tutorials.map((t, i) => [`${t.patientId}: ${t.title}`, i] as const))('%s', (_name, i) => {
    const { results } = walk(i);
    const failed = results.filter(r => !r.pass);
    expect(failed, JSON.stringify(results, null, 1)).toEqual([]);
  });
});
