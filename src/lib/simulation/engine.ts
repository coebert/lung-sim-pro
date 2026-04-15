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
  
  // Calculate oxygenation adequacy
  const fio2Ratio = settings.fio2 / patient.optimalFiO2;
  const peepRatio = settings.peep / patient.optimalPEEP;
  const oxygenScore = Math.min(fio2Ratio, 1.2) * Math.min(peepRatio, 1.2);
  
  // --- Shunting from excessive PEEP + long inspiratory time ---
  // High PEEP overdistends compliant alveoli, compressing adjacent capillaries
  // Long I-time (short E-time / high I:E) raises mean airway pressure further
  // Both together cause significant intrapulmonary shunt
  const peepExcess = Math.max(0, settings.peep - patient.optimalPEEP * 1.3);
  const cycleTime = 60 / settings.respiratoryRate;
  const iTime = settings.inspiratoryTime > 0
    ? settings.inspiratoryTime
    : cycleTime / (1 + settings.ieRatio);
  const ieActual = iTime / Math.max(cycleTime - iTime, 0.1); // I:E as a single number (>1 = inverse ratio)
  const ieExcess = Math.max(0, ieActual - 0.8); // normal ~0.5, problematic >0.8

  // Shunt fraction: rises with combined PEEP excess + IE excess
  // Each factor alone causes mild shunt; together they compound
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

  // Apply shunt penalty — shunted blood bypasses gas exchange
  // Even high FiO2 cannot fully compensate (refractory hypoxemia)
  if (shuntFraction > 0.02) {
    const shuntPenalty = shuntFraction * 60; // up to 30% SpO2 drop at max shunt
    const fio2Compensation = Math.min(shuntFraction * 0.3, (settings.fio2 - 0.21) * 0.15);
    targetSpO2 -= (shuntPenalty - fio2Compensation * 60);
  }

  // Calculate ventilation adequacy
  const minuteVent = (measured.measuredTV * measured.measuredRR) / 1000;
  const optimalMV = (patient.optimalTV * patient.optimalRR) / 1000;
  const ventRatio = minuteVent / optimalMV;

  // Target EtCO2 based on ventilation
  // Shunting also increases dead space ventilation, raising CO2
  let targetEtCO2 = 38;
  if (ventRatio < 0.7) {
    targetEtCO2 = 38 + (0.7 - ventRatio) * 60;
  } else if (ventRatio > 1.5) {
    targetEtCO2 = 38 - (ventRatio - 1.5) * 20;
    targetEtCO2 = Math.max(15, targetEtCO2);
  }
  targetEtCO2 += shuntFraction * 20; // shunt raises EtCO2

  // HR response to distress — shunting causes additional tachycardia
  const distress = Math.abs(1 - oxygenScore) + Math.abs(1 - ventRatio) + shuntFraction * 3;
  const targetHR = patient.baseHR + distress * 25;

  // BP response - high PEEP reduces BP; shunting worsens haemodynamics
  const peepEffect = Math.max(0, settings.peep - patient.optimalPEEP) * 2;
  const shuntBPPenalty = shuntFraction * 30;
  const targetSBP = patient.baseSBP - peepEffect - shuntBPPenalty + distress * 10;
  const targetDBP = patient.baseDBP - peepEffect * 0.5 - shuntBPPenalty * 0.5 + distress * 5;

  // Overpressure alarm - very high pressures cause harm
  let pressurePenalty = 0;
  if (measured.peakPressure > 40) {
    pressurePenalty = (measured.peakPressure - 40) * 0.5;
    targetSpO2 -= pressurePenalty;
  }

  // Gradually move toward targets
  return {
    hr: clamp(vitals.hr + (targetHR - vitals.hr) * rate, 30, 200),
    sbp: clamp(vitals.sbp + (targetSBP - vitals.sbp) * rate, 50, 250),
    dbp: clamp(vitals.dbp + (targetDBP - vitals.dbp) * rate, 20, 150),
    spo2: clamp(vitals.spo2 + (targetSpO2 - vitals.spo2) * rate * 0.5, 40, 100),
    etco2: clamp(vitals.etco2 + (targetEtCO2 - vitals.etco2) * rate * 0.3, 5, 100),
    rr: measured.measuredRR,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
