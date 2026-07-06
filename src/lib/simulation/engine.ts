import { PatientPhysiology, VentSettings, Vitals, MeasuredValues, WaveformBuffers } from './types';
import {
  generateVentWaveformPoint,
  generateECG,
  generateABP,
  generateSpO2Pleth,
  generateCapnography,
} from './waveformGenerators';
import { clamp, computeAPRV, computeShunt } from './scoring';

export const BUFFER_SIZE = 500;      // 10 seconds at 50Hz
export const SAMPLE_RATE = 50;
export const RECENT_WINDOW = SAMPLE_RATE * 5; // 5s window for measured values
export const TICK_DT = 1 / SAMPLE_RATE;       // 0.02s per tick

const VITALS_RESPONSE_RATE = 0.005;

export function createInitialBuffers(): WaveformBuffers {
  const zeros = () => new Array(BUFFER_SIZE).fill(0);
  return {
    pressure: zeros(),
    flow: zeros(),
    volume: zeros(),
    ecg: zeros(),
    abp: zeros(),
    spo2Pleth: zeros(),
    capno: zeros(),
  };
}

export function createInitialVitals(patient: PatientPhysiology): Vitals {
  return {
    hr: patient.baseHR,
    sbp: patient.baseSBP,
    dbp: patient.baseDBP,
    spo2: patient.baseSpO2,
    etco2: patient.baseEtCO2,
    rr: patient.spontaneousRate || 14,
  };
}

/** All seven waveform samples for a single simulator tick. */
export interface WaveformSample {
  pressure: number;
  flow: number;
  volume: number;
  ecg: number;
  abp: number;
  spo2Pleth: number;
  capno: number;
}

export function generateWaveformSample(
  time: number,
  settings: VentSettings,
  patient: PatientPhysiology,
  vitals: Vitals,
): WaveformSample {
  const vent = generateVentWaveformPoint(time, settings, patient);
  const actualRR = settings.mode === 'PSV'
    ? (patient.spontaneousRate || 12)
    : settings.respiratoryRate;
  return {
    pressure: vent.pressure,
    flow: vent.flow,
    volume: vent.volume,
    ecg: generateECG(time, vitals.hr),
    abp: generateABP(time, vitals.hr, vitals.sbp, vitals.dbp),
    spo2Pleth: generateSpO2Pleth(time, vitals.hr),
    capno: generateCapnography(time, actualRR, vitals.etco2, patient.spontaneousRate),
  };
}

/** Compute measured values from the most-recent 5s of pressure & volume. */
export function computeMeasured(
  recentPressure: ArrayLike<number>,
  recentVolume: ArrayLike<number>,
  actualRR: number,
  peep: number,
): MeasuredValues {
  let peakPressure = -Infinity;
  let sumPressure = 0;
  for (let i = 0; i < recentPressure.length; i++) {
    const v = recentPressure[i];
    if (v > peakPressure) peakPressure = v;
    sumPressure += v;
  }
  if (!isFinite(peakPressure)) peakPressure = 0;
  const meanPressure = recentPressure.length > 0 ? sumPressure / recentPressure.length : 0;

  let measuredTV = -Infinity;
  for (let i = 0; i < recentVolume.length; i++) {
    const v = recentVolume[i];
    if (v > measuredTV) measuredTV = v;
  }
  if (!isFinite(measuredTV)) measuredTV = 0;

  return {
    peakPressure: Math.round(peakPressure * 10) / 10,
    plateauPressure: Math.round(peakPressure * 0.85 * 10) / 10,
    meanPressure: Math.round(meanPressure * 10) / 10,
    measuredTV: Math.round(measuredTV),
    minuteVentilation: Math.round((measuredTV * actualRR) / 100) / 10,
    measuredRR: actualRR,
    dynamicCompliance: measuredTV > 0 && peakPressure > peep
      ? Math.round(measuredTV / (peakPressure - peep))
      : 0,
  };
}

export function updateVitals(
  settings: VentSettings,
  patient: PatientPhysiology,
  vitals: Vitals,
  measured: MeasuredValues,
  prone: boolean = false,
): Vitals {
  const rate = VITALS_RESPONSE_RATE;

  // Prone positioning V/Q benefit (mostly ARDS)
  const proneVQBonus = prone ? (patient.id === 'ards' ? 0.20 : 0.05) : 0;

  if (settings.mode === 'APRV') {
    return updateVitalsAPRV(settings, patient, vitals, measured, rate, prone, proneVQBonus);
  }

  const fio2Ratio = settings.fio2 / patient.optimalFiO2;
  const peepRatio = settings.peep / patient.optimalPEEP;
  const oxygenScore = Math.min(fio2Ratio, 1.2) * Math.min(peepRatio, 1.2);

  const { shuntFraction } = computeShunt(settings, patient);

  let targetSpO2 = patient.baseSpO2;
  const effectiveOxyScore = oxygenScore + proneVQBonus;
  if (effectiveOxyScore > 0.8) {
    targetSpO2 = Math.min(100, patient.baseSpO2 + (effectiveOxyScore - 0.8) * 30);
  } else {
    targetSpO2 = Math.max(60, patient.baseSpO2 - (0.8 - effectiveOxyScore) * 40);
  }

  if (shuntFraction > 0.02) {
    const shuntPenalty = shuntFraction * 60;
    const fio2Compensation = Math.min(shuntFraction * 0.3, (settings.fio2 - 0.21) * 0.15);
    targetSpO2 -= shuntPenalty - fio2Compensation * 60;
  }

  const minuteVent = (measured.measuredTV * measured.measuredRR) / 1000;
  const optimalMV = (patient.optimalTV * patient.optimalRR) / 1000;
  const ventRatio = minuteVent / optimalMV;

  let targetEtCO2 = 38;
  if (ventRatio < 0.7) {
    targetEtCO2 = 38 + (0.7 - ventRatio) * 60;
  } else if (ventRatio > 1.5) {
    targetEtCO2 = Math.max(15, 38 - (ventRatio - 1.5) * 20);
  }
  targetEtCO2 += shuntFraction * 20;

  const distress = Math.abs(1 - oxygenScore) + Math.abs(1 - ventRatio) + shuntFraction * 3;
  const targetHR = patient.baseHR + distress * 25;

  const peepEffect = Math.max(0, settings.peep - patient.optimalPEEP) * 2;
  const shuntBPPenalty = shuntFraction * 30;
  const targetSBP = patient.baseSBP - peepEffect - shuntBPPenalty + distress * 10;
  const targetDBP = patient.baseDBP - peepEffect * 0.5 - shuntBPPenalty * 0.5 + distress * 5;

  if (measured.peakPressure > 40) {
    targetSpO2 -= (measured.peakPressure - 40) * 0.5;
  }

  return {
    hr: clamp(vitals.hr + (targetHR - vitals.hr) * rate, 30, 200),
    sbp: clamp(vitals.sbp + (targetSBP - vitals.sbp) * rate, 50, 250),
    dbp: clamp(vitals.dbp + (targetDBP - vitals.dbp) * rate, 20, 150),
    spo2: clamp(vitals.spo2 + (targetSpO2 - vitals.spo2) * rate * 0.5, 40, 100),
    etco2: clamp(vitals.etco2 + (targetEtCO2 - vitals.etco2) * rate * 0.3, 5, 100),
    rr: measured.measuredRR,
  };
}

function updateVitalsAPRV(
  settings: VentSettings,
  patient: PatientPhysiology,
  vitals: Vitals,
  measured: MeasuredValues,
  rate: number,
  prone: boolean,
  proneVQBonus: number,
): Vitals {
  const aprv = computeAPRV(settings, patient);
  const { pHigh, fio2 } = settings;

  const fio2Ratio = fio2 / patient.optimalFiO2;
  const effectiveShunt = 0.4 * (1 - aprv.recruitmentScore);
  const baseOxyScore = Math.min(fio2Ratio, 1.2);
  const mapScore = clamp(aprv.meanAirwayPressure / (patient.optimalPEEP * 2), 0.3, 1.2);

  const proneShuntReduction = prone ? (patient.id === 'ards' ? 0.15 : 0.03) : 0;
  const adjustedShunt = Math.max(0, effectiveShunt - proneShuntReduction);
  const oxygenation = (baseOxyScore + proneVQBonus) * mapScore * (1 - adjustedShunt * 0.7);

  let targetSpO2 = patient.baseSpO2;
  if (oxygenation > 0.8) {
    targetSpO2 = Math.min(100, patient.baseSpO2 + (oxygenation - 0.8) * 35);
  } else {
    targetSpO2 = Math.max(55, patient.baseSpO2 - (0.8 - oxygenation) * 45);
  }

  if (pHigh > 35) {
    targetSpO2 -= (pHigh - 35) * 2;
  }

  const co2Clearance = clamp(settings.tLow / 0.5, 0.2, 1.5)
    * clamp(aprv.drivingPressure / 20, 0.3, 1.5);
  let targetEtCO2 = 38;
  if (co2Clearance < 0.7) targetEtCO2 = 38 + (0.7 - co2Clearance) * 40;
  else if (co2Clearance > 1.3) targetEtCO2 = Math.max(18, 38 - (co2Clearance - 1.3) * 25);

  const mapExcess = Math.max(0, aprv.meanAirwayPressure - 20);
  const distress = Math.max(0, 1 - aprv.recruitmentScore) + Math.max(0, 1 - oxygenation);
  const targetHR = patient.baseHR + distress * 20 + mapExcess * 0.5;
  const targetSBP = patient.baseSBP - mapExcess * 1.5 + distress * 8;
  const targetDBP = patient.baseDBP - mapExcess * 0.8 + distress * 4;

  return {
    hr: clamp(vitals.hr + (targetHR - vitals.hr) * rate, 30, 200),
    sbp: clamp(vitals.sbp + (targetSBP - vitals.sbp) * rate, 50, 250),
    dbp: clamp(vitals.dbp + (targetDBP - vitals.dbp) * rate, 20, 150),
    spo2: clamp(vitals.spo2 + (targetSpO2 - vitals.spo2) * rate * 0.5, 40, 100),
    etco2: clamp(vitals.etco2 + (targetEtCO2 - vitals.etco2) * rate * 0.3, 5, 100),
    rr: Math.round(60 / (settings.tHigh + settings.tLow)),
  };
}

/**
 * Legacy immutable tick — kept for callers/tests that expect a pure function.
 * The live app uses `SimulationStore` (see `simulationStore.ts`) which manages
 * ring buffers in place and avoids the per-tick array cloning below.
 */
export function simulationTick(
  time: number,
  settings: VentSettings,
  patient: PatientPhysiology,
  vitals: Vitals,
  buffers: WaveformBuffers,
  prone: boolean = false,
): { vitals: Vitals; measured: MeasuredValues; buffers: WaveformBuffers } {
  const sample = generateWaveformSample(time, settings, patient, vitals);
  const newBuffers: WaveformBuffers = {
    pressure: [...buffers.pressure.slice(1), sample.pressure],
    flow: [...buffers.flow.slice(1), sample.flow],
    volume: [...buffers.volume.slice(1), sample.volume],
    ecg: [...buffers.ecg.slice(1), sample.ecg],
    abp: [...buffers.abp.slice(1), sample.abp],
    spo2Pleth: [...buffers.spo2Pleth.slice(1), sample.spo2Pleth],
    capno: [...buffers.capno.slice(1), sample.capno],
  };
  const actualRR = settings.mode === 'PSV'
    ? (patient.spontaneousRate || 12)
    : settings.respiratoryRate;
  const measured = computeMeasured(
    newBuffers.pressure.slice(-RECENT_WINDOW),
    newBuffers.volume.slice(-RECENT_WINDOW),
    actualRR,
    settings.peep,
  );
  const newVitals = updateVitals(settings, patient, vitals, measured, prone);
  return { vitals: newVitals, measured, buffers: newBuffers };
}
