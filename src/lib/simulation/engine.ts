import { PatientPhysiology, VentSettings, Vitals, MeasuredValues, WaveformBuffers } from './types';
import { generateVentWaveformPoint, generateECG, generateABP, generateSpO2Pleth, generateCapnography } from './waveformGenerators';

const BUFFER_SIZE = 500; // 10 seconds at 50Hz
const SAMPLE_RATE = 50;
const VITALS_RESPONSE_RATE = 0.005; // How fast vitals change per tick

export function createInitialBuffers(): WaveformBuffers {
  return {
    pressure: new Array(BUFFER_SIZE).fill(0),
    flow: new Array(BUFFER_SIZE).fill(0),
    volume: new Array(BUFFER_SIZE).fill(0),
    ecg: new Array(BUFFER_SIZE).fill(0),
    abp: new Array(BUFFER_SIZE).fill(0),
    spo2Pleth: new Array(BUFFER_SIZE).fill(0),
    capno: new Array(BUFFER_SIZE).fill(0),
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

export function simulationTick(
  time: number,
  settings: VentSettings,
  patient: PatientPhysiology,
  vitals: Vitals,
  buffers: WaveformBuffers
): { vitals: Vitals; measured: MeasuredValues; buffers: WaveformBuffers } {
  // Generate ventilator waveform point
  const vent = generateVentWaveformPoint(time, settings, patient);
  
  // Generate monitor waveform points
  const ecg = generateECG(time, vitals.hr);
  const abp = generateABP(time, vitals.hr, vitals.sbp, vitals.dbp);
  const spo2 = generateSpO2Pleth(time, vitals.hr);
  const actualRR = settings.mode === 'PSV' ? (patient.spontaneousRate || 12) : settings.respiratoryRate;
  const capno = generateCapnography(time, actualRR, vitals.etco2, patient.spontaneousRate);

  // Push to buffers (shift left, add right)
  const newBuffers: WaveformBuffers = {
    pressure: [...buffers.pressure.slice(1), vent.pressure],
    flow: [...buffers.flow.slice(1), vent.flow],
    volume: [...buffers.volume.slice(1), vent.volume],
    ecg: [...buffers.ecg.slice(1), ecg],
    abp: [...buffers.abp.slice(1), abp],
    spo2Pleth: [...buffers.spo2Pleth.slice(1), spo2],
    capno: [...buffers.capno.slice(1), capno],
  };

  // Calculate measured values
  const recentPressure = buffers.pressure.slice(-SAMPLE_RATE * 5);
  const recentVolume = buffers.volume.slice(-SAMPLE_RATE * 5);
  
  const peakPressure = Math.max(...recentPressure);
  const measuredTV = Math.max(...recentVolume);
  const meanPressure = recentPressure.reduce((a, b) => a + b, 0) / recentPressure.length;

  const measured: MeasuredValues = {
    peakPressure: Math.round(peakPressure * 10) / 10,
    plateauPressure: Math.round((peakPressure * 0.85) * 10) / 10,
    meanPressure: Math.round(meanPressure * 10) / 10,
    measuredTV: Math.round(measuredTV),
    minuteVentilation: Math.round(measuredTV * actualRR / 100) / 10,
    measuredRR: actualRR,
    dynamicCompliance: measuredTV > 0 ? Math.round(measuredTV / (peakPressure - settings.peep)) : 0,
  };

  // Update vitals based on ventilation adequacy
  const newVitals = updateVitals(settings, patient, vitals, measured);

  return { vitals: newVitals, measured, buffers: newBuffers };
}

function updateVitals(
  settings: VentSettings,
  patient: PatientPhysiology,
  vitals: Vitals,
  measured: MeasuredValues
): Vitals {
  const rate = VITALS_RESPONSE_RATE;

  // ── APRV-specific physiology ──
  if (settings.mode === 'APRV') {
    return updateVitalsAPRV(settings, patient, vitals, measured, rate);
  }
  
  // Calculate oxygenation adequacy
  const fio2Ratio = settings.fio2 / patient.optimalFiO2;
  const peepRatio = settings.peep / patient.optimalPEEP;
  const oxygenScore = Math.min(fio2Ratio, 1.2) * Math.min(peepRatio, 1.2);
  
  // --- Shunting from excessive PEEP + long inspiratory time ---
  const peepExcess = Math.max(0, settings.peep - patient.optimalPEEP * 1.3);
  const cycleTime = 60 / settings.respiratoryRate;
  const iTime = settings.inspiratoryTime > 0
    ? settings.inspiratoryTime
    : cycleTime / (1 + settings.ieRatio);
  const ieActual = iTime / Math.max(cycleTime - iTime, 0.1);
  const ieExcess = Math.max(0, ieActual - 0.8);

  const shuntFraction = Math.min(
    0.5,
    (peepExcess * 0.02) + (ieExcess * 0.08) + (peepExcess * ieExcess * 0.03)
  );

  // Target SpO2 based on oxygenation
  let targetSpO2 = patient.baseSpO2;
  if (oxygenScore > 0.8) {
    targetSpO2 = Math.min(100, patient.baseSpO2 + (oxygenScore - 0.8) * 30);
  } else {
    targetSpO2 = Math.max(60, patient.baseSpO2 - (0.8 - oxygenScore) * 40);
  }

  // Apply shunt penalty
  if (shuntFraction > 0.02) {
    const shuntPenalty = shuntFraction * 60;
    const fio2Compensation = Math.min(shuntFraction * 0.3, (settings.fio2 - 0.21) * 0.15);
    targetSpO2 -= (shuntPenalty - fio2Compensation * 60);
  }

  // Calculate ventilation adequacy
  const minuteVent = (measured.measuredTV * measured.measuredRR) / 1000;
  const optimalMV = (patient.optimalTV * patient.optimalRR) / 1000;
  const ventRatio = minuteVent / optimalMV;

  // Target EtCO2
  let targetEtCO2 = 38;
  if (ventRatio < 0.7) {
    targetEtCO2 = 38 + (0.7 - ventRatio) * 60;
  } else if (ventRatio > 1.5) {
    targetEtCO2 = 38 - (ventRatio - 1.5) * 20;
    targetEtCO2 = Math.max(15, targetEtCO2);
  }
  targetEtCO2 += shuntFraction * 20;

  // HR response
  const distress = Math.abs(1 - oxygenScore) + Math.abs(1 - ventRatio) + shuntFraction * 3;
  const targetHR = patient.baseHR + distress * 25;

  // BP response
  const peepEffect = Math.max(0, settings.peep - patient.optimalPEEP) * 2;
  const shuntBPPenalty = shuntFraction * 30;
  const targetSBP = patient.baseSBP - peepEffect - shuntBPPenalty + distress * 10;
  const targetDBP = patient.baseDBP - peepEffect * 0.5 - shuntBPPenalty * 0.5 + distress * 5;

  // Overpressure
  let pressurePenalty = 0;
  if (measured.peakPressure > 40) {
    pressurePenalty = (measured.peakPressure - 40) * 0.5;
    targetSpO2 -= pressurePenalty;
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

/**
 * APRV-specific vitals update.
 *
 * Recruitment quality depends on:
 *  - P High must be high enough to open collapsed alveoli (≥20 cmH₂O for ARDS,
 *    scaled by patient optimal PEEP as a proxy for disease severity)
 *  - T High must be long enough for recruitment to occur (≥3 s ideal, <2 s poor)
 *  - T Low must be short enough to maintain auto-PEEP and prevent de-recruitment
 *    (0.3–0.8 s ideal; >1.2 s causes full exhalation → derecruitment)
 *  - P Low should be 0 (or very low) to maximize pressure differential;
 *    setting P Low high wastes driving pressure
 */
function updateVitalsAPRV(
  settings: VentSettings,
  patient: PatientPhysiology,
  vitals: Vitals,
  measured: MeasuredValues,
  rate: number
): Vitals {
  const { pHigh, pLow, tHigh, tLow, fio2 } = settings;

  // ── 1. Recruitment score (0 = no recruitment, 1 = optimal) ──

  // P High adequacy: need enough driving pressure above the lung's opening pressure
  // Opening pressure roughly correlates with optimal PEEP * 1.5
  const openingPressure = patient.optimalPEEP * 1.5;
  const drivingPressure = pHigh - pLow;
  // Score 0-1: need driving pressure ≥ opening pressure; extra is slightly beneficial
  const pHighScore = clamp((drivingPressure - openingPressure * 0.5) / (openingPressure * 1.0), 0, 1);

  // T High adequacy: ≥4s optimal, 2-4s partial, <2s poor
  const tHighScore = clamp((tHigh - 1.5) / 3.0, 0, 1);

  // T Low adequacy: 0.3-0.8s optimal; too short (<0.2) gives no release;
  // too long (>1.2) allows full exhalation → derecruitment
  let tLowScore: number;
  if (tLow < 0.1) {
    tLowScore = 0.1; // essentially no release
  } else if (tLow <= 0.8) {
    tLowScore = clamp(tLow / 0.3, 0, 1); // ramps up from 0.1 to 0.3s
  } else {
    // >0.8s: progressively worse, full derecruitment by ~1.5s
    tLowScore = clamp(1.0 - (tLow - 0.8) / 0.7, 0, 1);
  }

  // P Low penalty: ideally 0; higher P Low reduces the pressure differential
  // and diminishes the release effect
  const pLowPenalty = clamp(pLow / 10, 0, 0.5); // up to 50% reduction

  // Combined recruitment score
  const recruitmentScore = clamp(
    pHighScore * tHighScore * tLowScore * (1 - pLowPenalty),
    0, 1
  );

  // ── 2. Mean airway pressure (drives oxygenation in APRV) ──
  const cycleDuration = tHigh + tLow;
  const meanAirwayPressure = (pHigh * tHigh + pLow * tLow) / cycleDuration;

  // ── 3. Oxygenation ──
  const fio2Ratio = fio2 / patient.optimalFiO2;
  // Recruitment drives how much of the lung participates in gas exchange
  // Without recruitment, even high FiO2 can't compensate (shunt)
  const effectiveShunt = 0.4 * (1 - recruitmentScore); // up to 40% shunt if no recruitment
  const baseOxyScore = Math.min(fio2Ratio, 1.2);
  // Mean airway pressure also contributes to oxygenation
  const mapScore = clamp(meanAirwayPressure / (patient.optimalPEEP * 2), 0.3, 1.2);

  let targetSpO2 = patient.baseSpO2;
  const oxygenation = baseOxyScore * mapScore * (1 - effectiveShunt * 0.7);
  if (oxygenation > 0.8) {
    targetSpO2 = Math.min(100, patient.baseSpO2 + (oxygenation - 0.8) * 35);
  } else {
    targetSpO2 = Math.max(55, patient.baseSpO2 - (0.8 - oxygenation) * 45);
  }

  // Overdistension penalty: P High too high damages lung
  if (pHigh > 35) {
    targetSpO2 -= (pHigh - 35) * 2;
  }

  // ── 4. Ventilation / CO2 ──
  // CO2 clearance in APRV is driven by the brief release phase
  // Short T Low = less CO2 clearance; but too long = derecruitment
  const co2Clearance = clamp(tLow / 0.5, 0.2, 1.5) * clamp(drivingPressure / 20, 0.3, 1.5);
  let targetEtCO2 = 38;
  if (co2Clearance < 0.7) {
    targetEtCO2 = 38 + (0.7 - co2Clearance) * 40; // hypercapnia
  } else if (co2Clearance > 1.3) {
    targetEtCO2 = Math.max(18, 38 - (co2Clearance - 1.3) * 25);
  }

  // ── 5. Haemodynamics ──
  // High mean airway pressure impedes venous return
  const mapExcess = Math.max(0, meanAirwayPressure - 20);
  const distress = Math.max(0, 1 - recruitmentScore) + Math.max(0, 1 - oxygenation);
  const targetHR = patient.baseHR + distress * 20 + mapExcess * 0.5;
  const targetSBP = patient.baseSBP - mapExcess * 1.5 + distress * 8;
  const targetDBP = patient.baseDBP - mapExcess * 0.8 + distress * 4;

  return {
    hr: clamp(vitals.hr + (targetHR - vitals.hr) * rate, 30, 200),
    sbp: clamp(vitals.sbp + (targetSBP - vitals.sbp) * rate, 50, 250),
    dbp: clamp(vitals.dbp + (targetDBP - vitals.dbp) * rate, 20, 150),
    spo2: clamp(vitals.spo2 + (targetSpO2 - vitals.spo2) * rate * 0.5, 40, 100),
    etco2: clamp(vitals.etco2 + (targetEtCO2 - vitals.etco2) * rate * 0.3, 5, 100),
    rr: Math.round(60 / (tHigh + tLow)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
