import { PatientPhysiology, VentSettings, Vitals, MeasuredValues, WaveformBuffers, APRVSettings } from './types';
import {
  generateVentWaveformPoint,
  ecgAtBeat,
  abpAtBeat,
  plethAtBeat,
  beatTimeAt,
  type BeatTime,
  generateCapnography,
  simvSchedule,
  CapnoSensor,
} from './waveformGenerators';
import { clamp, computeAPRV, computeInverseRatio, computeShunt, deadSpaceMl } from './scoring';

export const BUFFER_SIZE = 500;      // 10 seconds at 50Hz
export const SAMPLE_RATE = 50;
// 10 s window: must span at least one full breath even at low rates (RR 6–8),
// otherwise slow breathers read as apnoea between breaths.
export const RECENT_WINDOW = SAMPLE_RATE * 10;
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
    paco2: patient.baseEtCO2,
  };
}

/** Normocapnic alveolar CO₂ (mmHg) at the patient's reference alveolar ventilation. */
const NORMO_CO2 = 38;

/** Alveolar ventilation (L/min) from measured values; prefers the breath-summed value. */
export function alveolarVentilation(measured: MeasuredValues, patient: PatientPhysiology): number {
  if (measured.alveolarVentilation !== undefined) return measured.alveolarVentilation;
  return Math.max(0, measured.measuredTV - deadSpaceMl(patient)) * measured.measuredRR / 1000;
}

/**
 * CO₂ production assumption: each case's VCO₂ is implied, not set — it is the
 * value that makes its reference ventilation (optimal VT and RR, minus the
 * shared dead space) normocapnic at NORMO_CO2. Alveolar CO₂ then follows
 * PACO₂ = 0.863 × VCO₂ / VA. Fever/sepsis/metabolic changes are not modelled.
 */
export function co2ProductionMlMin(patient: PatientPhysiology): number {
  return (referenceAlveolarVentilation(patient) * 1000 * NORMO_CO2) / 863;
}

/** Reference alveolar ventilation (L/min) that gives normocapnia for this case's CO₂ production. */
export function referenceAlveolarVentilation(patient: PatientPhysiology): number {
  return Math.max(0.3, (patient.optimalTV - deadSpaceMl(patient)) * patient.optimalRR / 1000);
}

/**
 * Steady-state alveolar CO₂ (mmHg): PACO₂ ∝ V̇CO₂ / V̇A (alveolar ventilation
 * equation), calibrated so the case's reference ventilation gives 38 mmHg.
 * Equal total minute ventilation with smaller breaths ⇒ less V̇A ⇒ higher CO₂.
 */
export function targetAlveolarCO2(measured: MeasuredValues, patient: PatientPhysiology): number {
  const va = alveolarVentilation(measured, patient);
  return clamp(NORMO_CO2 * referenceAlveolarVentilation(patient) / Math.max(va, 0.05), 15, 120);
}

/**
 * Oxygenation ceiling from alveolar ventilation: with V̇A near zero (apnoea,
 * or breaths no larger than dead space) alveolar O₂ is not replenished.
 * Returns the SpO₂ cap and whether the patient is hypoventilating.
 */
export function hypoventilationCap(measured: MeasuredValues, patient: PatientPhysiology) {
  const frac = alveolarVentilation(measured, patient) / referenceAlveolarVentilation(patient);
  const hypo = isApnoeic(measured) || frac < 0.4;
  return { hypo, cap: hypo ? 60 + 40 * clamp(frac / 0.4, 0, 1) * (isApnoeic(measured) ? 0 : 1) : 100 };
}

/** SpO₂ step: desaturation from hypoventilation follows O₂ stores (~1 min at FiO₂ 0.4, slower on more O₂). */
function spo2Step(current: number, target: number, rate: number, hypo: boolean, fio2: number): number {
  const k = target < current && hypo ? rate * 0.5 * 0.2 * Math.sqrt(0.21 / Math.max(0.21, fio2)) : rate * 0.5;
  return clamp(current + (target - current) * k, 40, 100);
}

/** No exhaled gas: no breath within the apnoea time, or negligible tidal volume. */
export function isApnoeic(measured: MeasuredValues): boolean {
  return measured.apnoea === true || measured.measuredTV < 50 || measured.measuredRR < 1;
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
  /** Beat timing from the live CardiacClock; derived from `time` if omitted. */
  beat?: BeatTime,
  /** Stateful capnograph sensor (live simulation); a pure replay is used if omitted. */
  capnoSensor?: CapnoSensor,
): WaveformSample {
  const vent = generateVentWaveformPoint(time, settings, patient);
  const bt = beat ?? beatTimeAt(time, vitals.hr);
  return {
    pressure: vent.pressure,
    flow: vent.flow,
    volume: vent.volume,
    // All three cardiac traces share one beat clock, so the arterial and
    // pleth upstrokes always follow the QRS by a fixed delay.
    ecg: ecgAtBeat(bt),
    abp: abpAtBeat(bt, vitals.sbp, vitals.dbp),
    spo2Pleth: plethAtBeat(bt),
    // The capnogram is driven by modelled alveolar CO₂; displayed EtCO₂ is sampled from it.
    capno: capnoSensor
      ? capnoSensor.push(vent.flow, vent.volume, vitals.paco2 ?? vitals.etco2, 0.02)
      : generateCapnography(time, settings, patient, vitals.paco2 ?? vitals.etco2),
  };
}

/** Effective cycle rate: APRV cycles at 60/(tHigh+tLow), PSV at the patient's rate. */
export function effectiveRate(settings: VentSettings, patient: PatientPhysiology): number {
  if (settings.mode === 'APRV') return 60 / Math.max(0.2, settings.tHigh + settings.tLow);
  if (settings.mode === 'PSV') return Math.max(0, patient.spontaneousRate);
  if (settings.mode === 'SIMV') return simvSchedule(settings, patient).totalRate;
  return settings.respiratoryRate;
}

/** End-expiratory baseline pressure: P Low in APRV, PEEP elsewhere. */
export function baselinePressure(settings: VentSettings): number {
  return settings.mode === 'APRV' ? Math.min(settings.pLow, settings.pHigh) : settings.peep;
}

/** Compute measured values from the most-recent 5s of pressure & volume. */
export function computeMeasured(
  recentPressure: ArrayLike<number>,
  recentVolume: ArrayLike<number>,
  actualRR: number,
  peep: number,
  /** Respiratory-system compliance (mL/cmH₂O). Needed for model-derived plateau / auto-PEEP. */
  complianceMl: number = 0,
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

  // Tidal volume is the max−min swing, not the absolute max: the absolute
  // max includes trapped/auto-PEEP volume (VCV with stacking) or the APRV
  // end-expiratory volume, inflating TV and falsely improving EtCO₂.
  let volMax = -Infinity;
  let volMin = Infinity;
  for (let i = 0; i < recentVolume.length; i++) {
    const v = recentVolume[i];
    if (v > volMax) volMax = v;
    if (v < volMin) volMin = v;
  }
  const measuredTV = isFinite(volMax) && isFinite(volMin) ? Math.max(0, volMax - volMin) : 0;

  // Plateau = end-inspiratory ALVEOLAR pressure (what an inspiratory hold
  // reads): baseline + total lung volume above FRC / compliance. Auto-PEEP =
  // end-expiratory alveolar pressure above baseline (expiratory hold).
  const hasModel = complianceMl > 0 && isFinite(volMax) && isFinite(volMin);
  const plateau = hasModel ? Math.min(peakPressure, peep + Math.max(0, volMax) / complianceMl) : peakPressure * 0.85;
  const autoPEEP = hasModel ? Math.max(0, volMin) / complianceMl : 0;

  return {
    peakPressure: Math.round(peakPressure * 10) / 10,
    plateauPressure: Math.round(plateau * 10) / 10,
    meanPressure: Math.round(meanPressure * 10) / 10,
    measuredTV: Math.round(measuredTV),
    minuteVentilation: Math.round((measuredTV * actualRR) / 100) / 10,
    measuredRR: actualRR,
    dynamicCompliance: measuredTV > 0 && peakPressure > peep
      ? Math.round(measuredTV / (peakPressure - peep))
      : 0,
    autoPEEP: Math.round(autoPEEP * 10) / 10,
  };
}

export function updateVitals(
  settings: VentSettings,
  patient: PatientPhysiology,
  vitals: Vitals,
  measured: MeasuredValues,
  prone: boolean = false,
  /** Number of 20 ms engine ticks this update represents (store calls at 4 Hz). */
  ticks: number = 1,
): Vitals {
  const rate = 1 - Math.pow(1 - VITALS_RESPONSE_RATE, ticks);

  // Prone positioning V/Q benefit — patient-specific (see patients.ts)
  const proneVQBonus = prone ? patient.proneVQBonus : 0;

  if (settings.mode === 'APRV') {
    return updateVitalsAPRV(settings, patient, vitals, measured, rate, prone, proneVQBonus);
  }

  const fio2Ratio = settings.fio2 / patient.optimalFiO2;
  const peepRatio = settings.peep / patient.optimalPEEP;
  // PEEP only matters in proportion to how recruitable/collapsed the lung is:
  // normal lungs oxygenate well even at PEEP 0, ARDS lungs do not.
  const peepFloor = clamp(0.9 - (patient.optimalPEEP - 5) * 0.09, 0, 0.9);
  const peepPart = Math.min(1.2, peepFloor + (1 - peepFloor) * peepRatio);
  const oxygenScore = Math.min(fio2Ratio, 1.2) * peepPart;

  const { shuntFraction } = computeShunt(settings, patient);
  // Inverse-ratio ventilation: longer inspiratory time raises mean airway
  // pressure, recruiting collapsed units in recruitable lung disease.
  const irv = computeInverseRatio(settings, patient);
  const irvOxyBonus = irv.recruitmentBonus * 0.35;

  let targetSpO2 = patient.baseSpO2;
  const effectiveOxyScore = oxygenScore + proneVQBonus + irvOxyBonus;
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

  const minuteVent = measured.minuteVentilation;
  const optimalMV = (patient.optimalTV * patient.optimalRR) / 1000;
  const ventRatio = minuteVent / optimalMV;

  let targetEtCO2 = targetAlveolarCO2(measured, patient);
  targetEtCO2 += shuntFraction * 20;
  // Inverse ratio shortens expiratory time → less effective CO₂ clearance.
  if (irv.isInverse) targetEtCO2 += Math.min(10, (irv.ie.ieActual - 1) * 5);
  // Apnoea / no exhaled gas: no CO₂ reaches the sensor, while arterial CO₂ climbs.
  const apnoeic = isApnoeic(measured);

  // Dynamic hyperinflation: trapped gas raises intrathoracic pressure,
  // cutting venous return (hypotension, tachycardia) and adding dead space.
  const hyperinflation = Math.max(0, measured.autoPEEP - 2);
  targetEtCO2 += hyperinflation * 1.5;

  // Over-supply of O₂/PEEP is not "distress"; under-ventilation and
  // gross over-ventilation both are.
  const distress = Math.max(0, 1 - oxygenScore) + Math.abs(1 - Math.min(ventRatio, 2)) + shuntFraction * 3;
  const targetHR = patient.baseHR + distress * 25 + hyperinflation * 2;

  const peepEffect = Math.max(0, settings.peep - patient.optimalPEEP) * 2 + hyperinflation * 4;
  const shuntBPPenalty = shuntFraction * 30;
  // Sustained high mean airway pressure (inverse ratio) impedes venous return.
  const irvBPPenalty = irv.haemodynamicBurden * 15;
  const targetSBP = patient.baseSBP - peepEffect - shuntBPPenalty - irvBPPenalty + distress * 10;
  const targetDBP = patient.baseDBP - peepEffect * 0.5 - shuntBPPenalty * 0.5 - irvBPPenalty * 0.5 + distress * 5;

  // Apnoea / no effective alveolar ventilation: progressive hypoxaemia.
  const hv = hypoventilationCap(measured, patient);
  targetSpO2 = Math.min(targetSpO2, hv.cap);

  // Overdistension (model-derived plateau, not resistive peak) worsens V/Q.
  if (measured.plateauPressure > 35) {
    targetSpO2 -= (measured.plateauPressure - 35) * 0.5;
  }

  return {
    hr: clamp(vitals.hr + (targetHR - vitals.hr) * rate, 30, 200),
    sbp: clamp(vitals.sbp + (targetSBP - vitals.sbp) * rate, 50, 250),
    dbp: clamp(vitals.dbp + (targetDBP - vitals.dbp) * rate, 20, 150),
    spo2: spo2Step(vitals.spo2, targetSpO2, rate, hv.hypo, settings.fio2),
    ...co2Update(vitals, targetEtCO2, apnoeic, rate),
  };
}

/** Advance modelled alveolar CO₂; the monitor reading is absent when no gas is exhaled. */
function co2Update(vitals: Vitals, target: number, apnoeic: boolean, rate: number): Pick<Vitals, 'etco2' | 'paco2'> {
  const prev = vitals.paco2 ?? vitals.etco2;
  const paco2 = apnoeic
    ? clamp(prev + (120 - prev) * rate * 0.3, 5, 120) // CO₂ accumulates during apnoea
    : clamp(prev + (target - prev) * rate * 0.3, 5, 120);
  return { paco2, etco2: apnoeic ? 0 : paco2 };
}

function updateVitalsAPRV(
  settings: APRVSettings,
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

  const proneShuntReduction = prone ? patient.proneShuntReduction : 0;
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

  // Obstructive lungs: incomplete release → breath stacking, hyperinflation,
  // dead space and impaired venous return.
  const trap = aprv.gasTrapping;
  targetSpO2 -= trap * 18;

  // CO₂ clearance from the delivered release volumes (alveolar ventilation),
  // not from configured pressures: T High, T Low and P High − P Low act through
  // release volume and release frequency.
  const apnoeic = isApnoeic(measured);
  let targetEtCO2 = targetAlveolarCO2(measured, patient);
  targetEtCO2 += trap * 30;
  const hv = hypoventilationCap(measured, patient);
  targetSpO2 = Math.min(targetSpO2, hv.cap);

  const mapExcess = Math.max(0, aprv.meanAirwayPressure - 20);
  const distress = Math.max(0, 1 - aprv.recruitmentScore) + Math.max(0, 1 - oxygenation);
  const targetHR = patient.baseHR + distress * 20 + mapExcess * 0.5 + trap * 30;
  const targetSBP = patient.baseSBP - mapExcess * 1.5 + distress * 8 - trap * 45;
  const targetDBP = patient.baseDBP - mapExcess * 0.8 + distress * 4 - trap * 25;

  return {
    hr: clamp(vitals.hr + (targetHR - vitals.hr) * rate, 30, 200),
    sbp: clamp(vitals.sbp + (targetSBP - vitals.sbp) * rate, 50, 250),
    dbp: clamp(vitals.dbp + (targetDBP - vitals.dbp) * rate, 20, 150),
    spo2: spo2Step(vitals.spo2, targetSpO2, rate, hv.hypo, settings.fio2),
    ...co2Update(vitals, targetEtCO2, apnoeic, rate),
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
  const measured = computeMeasured(
    newBuffers.pressure.slice(-RECENT_WINDOW),
    newBuffers.volume.slice(-RECENT_WINDOW),
    effectiveRate(settings, patient),
    baselinePressure(settings),
    patient.compliance,
  );
  const newVitals = updateVitals(settings, patient, vitals, measured, prone);
  return { vitals: newVitals, measured, buffers: newBuffers };
}
