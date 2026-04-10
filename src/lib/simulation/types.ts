export type VentMode = 'VCV' | 'PCV' | 'PRVC' | 'SIMV' | 'PSV' | 'APRV';

export interface VentSettings {
  mode: VentMode;
  tidalVolume: number;      // mL
  respiratoryRate: number;  // breaths/min
  peep: number;             // cmH2O
  fio2: number;             // 0.21-1.0
  ieRatio: number;          // E component (I is always 1, so 2 means 1:2)
  pressureSupport: number;  // cmH2O above PEEP
  pInsp: number;            // cmH2O above PEEP (PCV)
  pHigh: number;            // cmH2O (APRV)
  pLow: number;             // cmH2O (APRV)
  tHigh: number;            // seconds (APRV)
  tLow: number;             // seconds (APRV)
  flowRate: number;         // L/min (VCV)
  pMax: number;             // cmH2O pressure limit (PRVC)
  inspiratoryTime: number;  // seconds
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
