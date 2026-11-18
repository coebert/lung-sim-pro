import type { AllModeParams, PatientPhysiology, VentMode } from './types';

export interface ControlRange { min: number; max: number; step: number }

const ALL: VentMode[] = ['VCV', 'PCV', 'PRVC', 'SIMV', 'PSV', 'APRV'];
const TIMED: VentMode[] = ['VCV', 'PCV', 'PRVC', 'SIMV'];

/** Which modes show each control, and its range. Single source for the UI and reachability tests. */
const SPECS: Partial<Record<keyof AllModeParams, { modes: VentMode[]; range: (p?: PatientPhysiology) => ControlRange }>> = {
  peep: { modes: ['VCV', 'PCV', 'PRVC', 'SIMV', 'PSV'], range: () => ({ min: 0, max: 25, step: 1 }) },
  fio2: { modes: ALL, range: () => ({ min: 0.21, max: 1, step: 0.01 }) },
  tidalVolume: {
    modes: ['VCV', 'PRVC', 'SIMV'],
    range: (p) => ((p ? p.predictedBodyWeight ?? p.weight : 70) < 40 ? { min: 40, max: 400, step: 5 } : { min: 200, max: 800, step: 10 }),
  },
  respiratoryRate: { modes: TIMED, range: () => ({ min: 4, max: 40, step: 1 }) },
  ieRatio: { modes: TIMED, range: () => ({ min: 0.25, max: 4, step: 0.25 }) },
  inspiratoryTime: { modes: TIMED, range: () => ({ min: 0.3, max: 3, step: 0.1 }) },
  pInsp: { modes: ['PCV'], range: () => ({ min: 5, max: 40, step: 1 }) },
  pMax: { modes: ['PRVC'], range: () => ({ min: 15, max: 50, step: 1 }) },
  riseTime: { modes: ['PCV', 'PRVC', 'SIMV', 'PSV'], range: () => ({ min: 0, max: 0.6, step: 0.05 }) },
  pressureSupport: { modes: ['SIMV', 'PSV'], range: () => ({ min: 0, max: 30, step: 1 }) },
  ets: { modes: ['SIMV', 'PSV'], range: () => ({ min: 5, max: 80, step: 5 }) },
  triggerSens: { modes: ['SIMV', 'PSV'], range: () => ({ min: 0.5, max: 10, step: 0.5 }) },
  pLimit: { modes: ['VCV', 'SIMV'], range: () => ({ min: 20, max: 60, step: 1 }) },
  pHigh: { modes: ['APRV'], range: () => ({ min: 5, max: 40, step: 1 }) },
  pLow: { modes: ['APRV'], range: () => ({ min: 0, max: 10, step: 1 }) },
  tHigh: { modes: ['APRV'], range: () => ({ min: 1, max: 8, step: 0.5 }) },
  tLow: { modes: ['APRV'], range: () => ({ min: 0.1, max: 2, step: 0.1 }) },
};

export function controlSpec(field: keyof AllModeParams, mode: VentMode, patient?: PatientPhysiology): ControlRange | null {
  const s = SPECS[field];
  if (!s || !s.modes.includes(mode)) return null;
  return s.range(patient);
}

/** True when a learner can set `value` for `field` in `mode` with the on-screen control. */
export function isReachable(field: keyof AllModeParams, value: unknown, mode: VentMode, patient?: PatientPhysiology): boolean {
  if (field === 'mode') return ALL.includes(value as VentMode);
  if (field === 'inspiratoryTime' && value === 0) return controlSpec('ieRatio', mode, patient) !== null; // I:E basis
  const r = controlSpec(field, mode, patient);
  if (!r || typeof value !== 'number') return false;
  const k = (value - r.min) / r.step;
  return value >= r.min - 1e-9 && value <= r.max + 1e-9 && Math.abs(k - Math.round(k)) < 1e-6;
}
