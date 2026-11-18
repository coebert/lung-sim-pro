export type VentMode = 'VCV' | 'PCV' | 'PRVC' | 'SIMV' | 'PSV' | 'APRV';

/** Ventilator parameters common to every mode. */
export interface CommonSettings {
  peep: number;             // cmH2O — used as baseline expiratory pressure for all conventional modes
  fio2: number;             // 0.21–1.0
  respiratoryRate: number;  // breaths/min (interpreted differently by APRV: derived from tHigh + tLow)
  ieRatio: number;          // E component (I is always 1, so 2 means 1:2)
  inspiratoryTime: number;  // seconds — overrides ieRatio when > 0
}

/** Mode-specific parameter shapes. Each variant only carries the fields that are
 * meaningful for that mode, so the compiler flags out-of-mode access at the call site. */
export type VentSettings =
  | (CommonSettings & { mode: 'VCV';  tidalVolume: number; flowRate: number; pLimit: number })
  | (CommonSettings & { mode: 'PCV';  pInsp: number; riseTime: number })
  | (CommonSettings & { mode: 'PRVC'; tidalVolume: number; pMax: number; riseTime: number })
  | (CommonSettings & { mode: 'SIMV'; tidalVolume: number; pressureSupport: number; riseTime: number; ets: number; triggerSens: number; pLimit: number })
  | (CommonSettings & { mode: 'PSV';  pressureSupport: number; riseTime: number; ets: number; triggerSens: number })
  | (CommonSettings & { mode: 'APRV'; pHigh: number; pLow: number; tHigh: number; tLow: number });

export type VCVSettings  = Extract<VentSettings, { mode: 'VCV'  }>;
export type PCVSettings  = Extract<VentSettings, { mode: 'PCV'  }>;
export type PRVCSettings = Extract<VentSettings, { mode: 'PRVC' }>;
export type SIMVSettings = Extract<VentSettings, { mode: 'SIMV' }>;
export type PSVSettings  = Extract<VentSettings, { mode: 'PSV'  }>;
export type APRVSettings = Extract<VentSettings, { mode: 'APRV' }>;

/**
 * Superset of every parameter across every mode. The store persists this
 * internally so users don't lose per-mode values when switching modes.
 * `VentSettings` is derived from this + the active `mode`.
 */
export interface AllModeParams extends CommonSettings {
  mode: VentMode;
  tidalVolume: number;
  flowRate: number;
  pInsp: number;
  pMax: number;
  pressureSupport: number;
  /** Pressure rise time (s) for pressure-targeted breaths (PCV/PRVC/PSV/SIMV support). */
  riseTime: number;
  /** PSV / SIMV-support expiratory trigger sensitivity: cycle off at this % of peak flow. */
  ets: number;
  /** Flow trigger sensitivity (L/min) for patient-triggered breaths (PSV, SIMV). */
  triggerSens: number;
  /** High airway-pressure limit (cmH₂O): a volume breath that reaches it is terminated (VCV, SIMV mandatory). */
  pLimit: number;
  pHigh: number;
  pLow: number;
  tHigh: number;
  tLow: number;
}

/** Build the mode-narrowed `VentSettings` from the persistent superset. */
export function buildVentSettings(all: AllModeParams): VentSettings {
  const common: CommonSettings = {
    peep: all.peep,
    fio2: all.fio2,
    respiratoryRate: all.respiratoryRate,
    ieRatio: all.ieRatio,
    inspiratoryTime: all.inspiratoryTime,
  };
  switch (all.mode) {
    case 'VCV':  return { ...common, mode: 'VCV',  tidalVolume: all.tidalVolume, flowRate: all.flowRate, pLimit: all.pLimit };
    case 'PCV':  return { ...common, mode: 'PCV',  pInsp: all.pInsp, riseTime: all.riseTime };
    case 'PRVC': return { ...common, mode: 'PRVC', tidalVolume: all.tidalVolume, pMax: all.pMax, riseTime: all.riseTime };
    case 'SIMV': return { ...common, mode: 'SIMV', tidalVolume: all.tidalVolume, pressureSupport: all.pressureSupport, riseTime: all.riseTime, ets: all.ets, triggerSens: all.triggerSens, pLimit: all.pLimit };
    case 'PSV':  return { ...common, mode: 'PSV',  pressureSupport: all.pressureSupport, riseTime: all.riseTime, ets: all.ets, triggerSens: all.triggerSens };
    case 'APRV': return { ...common, mode: 'APRV', pHigh: all.pHigh, pLow: Math.min(all.pLow, all.pHigh), tHigh: all.tHigh, tLow: all.tLow };
  }
}

/** Literal union of every patient in `patients.ts`. Using a union rather than
 * `string` means `patient.id === 'ards'` checks are validated at compile time
 * and mis-typed IDs surface as errors instead of silently failing at runtime. */
export type PatientId =
  | 'healthy'
  | 'healthy-spont'
  | 'obese'
  | 'ards'
  | 'bronchospasm'
  | 'restrictive'
  | 'spontaneous'
  | 'copd'
  | 'asthma'
  | 'sepsis'
  | 'paediatric'
  | 'autotrigger'
  | 'copd-spont'
  | 'pressure-limited';

export interface PatientPhysiology {
  id: PatientId;
  name: string;
  description: string;
  weight: number;           // kg (actual)
  /** Predicted body weight (kg) for mL/kg tidal-volume dosing; defaults to `weight`. */
  predictedBodyWeight?: number;
  compliance: number;       // mL/cmH2O
  resistance: number;       // cmH2O/L/s
  frc: number;              // mL
  spontaneousRate: number;  // breaths/min (0 = no spontaneous breathing)
  spontaneousTidalVolume: number; // mL
  baseHR: number;
  baseSBP: number;
  baseDBP: number;
  baseSpO2: number;
  baseEtCO2: number;
  optimalTV: number;        // mL
  optimalRR: number;
  optimalPEEP: number;
  optimalFiO2: number;
  optimalPS: number;        // for PSV mode
  /** Alveolar opening pressure (cmH₂O). Falls back to `optimalPEEP * 1.5` if unset. */
  openingPressure?: number;
  /** V/Q oxygenation bonus gained from prone positioning (fraction; e.g. 0.20 = +20%). */
  proneVQBonus: number;
  /** Intrapulmonary shunt reduction gained from prone positioning (fraction). */
  proneShuntReduction: number;
  /** Cardiogenic flow oscillation amplitude at the airway (L/min) — can auto-trigger a sensitive flow trigger. */
  cardiogenicOscillation?: number;
  /** Case starting settings layered over the shared defaults (teaching scenarios). */
  defaultSettings?: Partial<AllModeParams>;
}

export interface Vitals {
  hr: number;
  sbp: number;
  dbp: number;
  spo2: number;
  /** Displayed end-tidal CO₂ (mmHg). In the live app this is sampled from the capnogram. */
  etco2: number;
  /** Modelled alveolar/arterial CO₂ (mmHg) driving the capnogram; not measured by the monitor. */
  paco2?: number;
  /** Capnogram quality: plateau reached, no plateau (value under-reads), or no exhaled gas. */
  etco2Status?: 'plateau' | 'no-plateau' | 'unavailable' | 'measuring';
  // NB: respiratory rate lives on `MeasuredValues.measuredRR` — a single source of truth.
}

export interface MeasuredValues {
  peakPressure: number;
  plateauPressure: number;
  meanPressure: number;
  measuredTV: number;
  minuteVentilation: number;
  measuredRR: number;
  dynamicCompliance: number;
  /** Intrinsic PEEP (cmH₂O): end-expiratory alveolar pressure above set PEEP / P Low from trapped gas. */
  autoPEEP: number;
  /** Alveolar ventilation (L/min): Σ(VT − dead space) over the observation window. */
  alveolarVentilation?: number;
  /** Last mandatory / last supported breath exhaled VT (mL), when present. */
  vtMandatory?: number;
  vtSupported?: number;
  /** Seconds since the last breath started. */
  secondsSinceBreath?: number;
  /** True when no breath has started within the apnoea time. */
  apnoea?: boolean;
  /** True until a complete breath has been measured on the current settings. */
  warmingUp?: boolean;
  /** Settings revision whose complete breaths these values come from. */
  freshRevision?: number;
  /** Observation window (s) used for minute ventilation and rate. */
  windowSec?: number;
  /** Per-minute counts over the window: patient efforts, efforts that failed to trigger, ventilator auto-triggers. */
  effortRate?: number;
  missedTriggers?: number;
  /** Ventilator breaths/min (excludes unsupported efforts), patient-triggered subset, SIMV mandatory subset. */
  machineRate?: number;
  assistedRate?: number;
  mandatoryRate?: number;
  autoTriggers?: number;
  /** Volume breaths terminated at the high-pressure limit, per minute. */
  pressureLimited?: number;
}

/** Named channels for the seven live waveform buffers. */
export type WaveformChannel =
  | 'pressure' | 'flow' | 'volume'
  | 'ecg' | 'abp' | 'spo2Pleth' | 'capno';

/** Mapped type so adding a new channel updates every consumer via one edit. */
export type WaveformBuffers = Record<WaveformChannel, number[]> & {
  /**
   * APRV only: 1 at samples where the ventilator cycles back to P High
   * (end of T Low), 0 elsewhere. Aligned sample-for-sample with `flow`.
   */
  aprvCycleMarkers?: number[];
};

/** APRV never runs inverted: P Low is capped at P High (equal = CPAP at that pressure).
 * Lowering P High drags P Low down with it; raising P Low stops at P High. Legacy
 * inverted settings are resolved the same way so every path sees one pressure. */
export function normaliseAprvPressures<T extends { pHigh: number; pLow: number }>(all: T, _patch?: Partial<T>): T {
  return all.pLow > all.pHigh ? { ...all, pLow: all.pHigh } : all;
}
