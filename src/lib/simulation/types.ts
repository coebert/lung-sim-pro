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
  | (CommonSettings & { mode: 'VCV';  tidalVolume: number; flowRate: number })
  | (CommonSettings & { mode: 'PCV';  pInsp: number })
  | (CommonSettings & { mode: 'PRVC'; tidalVolume: number; pMax: number })
  | (CommonSettings & { mode: 'SIMV'; tidalVolume: number; pressureSupport: number })
  | (CommonSettings & { mode: 'PSV';  pressureSupport: number })
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
    case 'VCV':  return { ...common, mode: 'VCV',  tidalVolume: all.tidalVolume, flowRate: all.flowRate };
    case 'PCV':  return { ...common, mode: 'PCV',  pInsp: all.pInsp };
    case 'PRVC': return { ...common, mode: 'PRVC', tidalVolume: all.tidalVolume, pMax: all.pMax };
    case 'SIMV': return { ...common, mode: 'SIMV', tidalVolume: all.tidalVolume, pressureSupport: all.pressureSupport };
    case 'PSV':  return { ...common, mode: 'PSV',  pressureSupport: all.pressureSupport };
    case 'APRV': return { ...common, mode: 'APRV', pHigh: all.pHigh, pLow: all.pLow, tHigh: all.tHigh, tLow: all.tLow };
  }
}

export interface PatientPhysiology {
  id: string;
  name: string;
  description: string;
  weight: number;           // kg
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
}

export interface Vitals {
  hr: number;
  sbp: number;
  dbp: number;
  spo2: number;
  etco2: number;
  rr: number;  // actual measured RR
}

export interface MeasuredValues {
  peakPressure: number;
  plateauPressure: number;
  meanPressure: number;
  measuredTV: number;
  minuteVentilation: number;
  measuredRR: number;
  dynamicCompliance: number;
}

export interface WaveformBuffers {
  pressure: number[];
  flow: number[];
  volume: number[];
  ecg: number[];
  abp: number[];
  spo2Pleth: number[];
  capno: number[];
}
