import { PatientPhysiology, VentSettings } from './types';

const SAMPLE_RATE = 50; // Hz

// --- Breath Stacking / Air Trapping ---
// For high-resistance patients, if expiratory time is too short relative to
// the time constant (tau = R * C), exhaled volume doesn't reach zero before
// the next breath, causing progressive volume stacking (auto-PEEP).

function calcTrappedVolume(s: VentSettings, p: PatientPhysiology, deliveredVolumeMl: number): number {
  const C = p.compliance / 1000;
  const R = p.resistance;
  const tau = R * C;
  const cycleTime = 60 / s.respiratoryRate;
  const iTime = s.inspiratoryTime > 0 ? s.inspiratoryTime : cycleTime / (1 + s.ieRatio);
  const eTime = cycleTime - iTime;

  // Fraction of volume remaining after expiration = e^(-eTime/tau)
  const retainedFraction = Math.exp(-eTime / tau);

  // With repeated breaths, trapped volume converges to a geometric series:
  // trappedVol = deliveredVol * retainedFraction / (1 - retainedFraction)
  if (retainedFraction > 0.01) {
    return (deliveredVolumeMl * retainedFraction) / (1 - retainedFraction);
  }
  return 0;
}

// --- Ventilator Waveforms ---

export function generateVentWaveformPoint(
  time: number,
  settings: VentSettings,
  patient: PatientPhysiology
): { pressure: number; flow: number; volume: number } {
  switch (settings.mode) {
    case 'VCV': return vcvWaveform(time, settings, patient);
    case 'PCV': return pcvWaveform(time, settings, patient);
    case 'PRVC': return prvcWaveform(time, settings, patient);
    case 'SIMV': return simvWaveform(time, settings, patient);
    case 'PSV': return psvWaveform(time, settings, patient);
    case 'APRV': return aprvWaveform(time, settings, patient);
    default: return { pressure: settings.peep, flow: 0, volume: 0 };
  }
}

/** Resolve inspiratory time: prefer explicit Ti, fall back to I:E ratio */
function getITime(s: VentSettings): number {
  if (s.inspiratoryTime > 0) return s.inspiratoryTime;
  const cycleTime = 60 / s.respiratoryRate;
  return cycleTime / (1 + s.ieRatio);
}

function vcvWaveform(time: number, s: VentSettings, p: PatientPhysiology) {
  const cycleTime = 60 / s.respiratoryRate;
  const iTime = getITime(s);
  const phase = time % cycleTime;
  const C = p.compliance / 1000;
  const R = p.resistance;
  const tau = R * C;

  const trapped = calcTrappedVolume(s, p, s.tidalVolume);
  const autoPEEP = (trapped / 1000) / C;

  if (phase < iTime) {
    const flow = (s.tidalVolume / 1000) / iTime;
    const volume = trapped + flow * phase * 1000;
    const pressure = s.peep + autoPEEP + ((flow * phase * 1000) / 1000) / C + flow * R;
    return { pressure, flow: flow * 60, volume };
  } else {
    const ePhase = phase - iTime;
    const vol0 = s.tidalVolume;
    const exhaledVolume = vol0 * Math.exp(-ePhase / tau);
    const volume = trapped + exhaledVolume;
    const flow = -(exhaledVolume / 1000) / tau;
    const pressure = s.peep + (volume / 1000) / C;
    return { pressure: Math.max(pressure, s.peep + autoPEEP), flow: flow * 60, volume: Math.max(volume, 0) };
  }
}

function pcvWaveform(time: number, s: VentSettings, p: PatientPhysiology) {
  const cycleTime = 60 / s.respiratoryRate;
  const iTime = getITime(s);
  const phase = time % cycleTime;
  const C = p.compliance / 1000;
  const R = p.resistance;
  const tau = R * C;

  // Calculate trapped volume from breath stacking
  const deliveredVol = s.pInsp * C * (1 - Math.exp(-iTime / tau)) * 1000;
  const trapped = calcTrappedVolume(s, p, deliveredVol);
  const autoPEEP = (trapped / 1000) / C;

  if (phase < iTime) {
    const volume = trapped + s.pInsp * C * (1 - Math.exp(-phase / tau)) * 1000;
    const flow = (s.pInsp / R) * Math.exp(-phase / tau);
    const pressure = s.peep + autoPEEP + s.pInsp;
    return { pressure, flow: flow * 60, volume };
  } else {
    const ePhase = phase - iTime;
    const vol0 = deliveredVol;
    const exhaledVolume = vol0 * Math.exp(-ePhase / tau);
    const volume = trapped + exhaledVolume;
    const flow = -(exhaledVolume / 1000) / tau;
    const pressure = s.peep + (volume / 1000) / C;
    return { pressure: Math.max(pressure, s.peep + autoPEEP), flow: flow * 60, volume: Math.max(volume, 0) };
  }
}

function prvcWaveform(time: number, s: VentSettings, p: PatientPhysiology) {
  // PRVC auto-adjusts pressure to achieve target volume
  const C = p.compliance / 1000;
  const R = p.resistance;
  const tau = R * C;
  const cycleTime = 60 / s.respiratoryRate;
  const iTime = getITime(s);
  
  // Calculate required pressure to achieve target TV
  const targetPressure = Math.min(
    (s.tidalVolume / 1000) / (C * (1 - Math.exp(-iTime / tau))),
    s.pMax
  );
  
  const modSettings = { ...s, pInsp: targetPressure };
  return pcvWaveform(time, modSettings, p);
}

function simvWaveform(time: number, s: VentSettings, p: PatientPhysiology) {
  const cycleTime = 60 / s.respiratoryRate;
  const mandatoryCycles = s.respiratoryRate;
  const totalCycleTime = 60 / Math.max(mandatoryCycles, p.spontaneousRate || mandatoryCycles);
  const phase = time % cycleTime;
  
  // Alternate between mandatory VCV breaths and spontaneous PS breaths
  const breathIndex = Math.floor(time / cycleTime);
  const isMandatory = breathIndex % 2 === 0 || p.spontaneousRate === 0;
  
  if (isMandatory) {
    return vcvWaveform(time, s, p);
  } else {
    // Spontaneous breath with pressure support
    const spontSettings = { ...s, pInsp: s.pressureSupport };
    const spontCycle = 60 / Math.max(p.spontaneousRate, 6);
    const spontPhase = time % spontCycle;
    return pcvWaveform(spontPhase, { ...spontSettings, respiratoryRate: p.spontaneousRate || 10 }, p);
  }
}

function psvWaveform(time: number, s: VentSettings, p: PatientPhysiology) {
  const rate = p.spontaneousRate > 0 ? p.spontaneousRate : 12;
  const psSettings = { ...s, pInsp: s.pressureSupport, respiratoryRate: rate, ieRatio: 2 };
  const result = pcvWaveform(time, psSettings, p);
  
  // Add a small negative deflection for patient trigger
  const cycleTime = 60 / rate;
  const phase = time % cycleTime;
  if (phase < 0.15) {
    result.pressure -= 1.5 * Math.sin(phase / 0.15 * Math.PI);
  }
  
  return result;
}

function aprvWaveform(time: number, s: VentSettings, p: PatientPhysiology) {
  const totalCycle = s.tHigh + s.tLow;
  const phase = time % totalCycle;
  const C = p.compliance / 1000;
  const R = p.resistance;
  const tau = R * C;

  if (phase < s.tHigh) {
    // High pressure phase
    const transitionTime = Math.min(phase, tau * 3);
    const pressure = s.pHigh;
    const volume = (s.pHigh - s.pLow) * C * (1 - Math.exp(-transitionTime / tau)) * 1000;
    const flow = phase < tau * 3 ? ((s.pHigh - s.pLow) / R) * Math.exp(-transitionTime / tau) * 60 : 0;
    return { pressure, flow, volume };
  } else {
    // Low pressure (release) phase
    const ePhase = phase - s.tHigh;
    const vol0 = (s.pHigh - s.pLow) * C * 1000;
    const volume = vol0 * Math.exp(-ePhase / (tau * 0.3));
    const flow = -(volume / 1000) / (tau * 0.3) * 60;
    const pressure = s.pLow + (volume / 1000) / C;
    return { pressure: Math.max(pressure, s.pLow), flow, volume: Math.max(volume, 0) };
  }
}

// --- Patient Monitor Waveforms ---

export function generateECG(time: number, hr: number): number {
  const cycleTime = 60 / hr;
  const phase = (time % cycleTime) / cycleTime;

  // P wave
  if (phase >= 0.0 && phase < 0.08) return 0.15 * Math.sin((phase / 0.08) * Math.PI);
  // PR segment
  if (phase >= 0.08 && phase < 0.12) return 0;
  // Q
  if (phase >= 0.12 && phase < 0.14) return -0.1 * Math.sin(((phase - 0.12) / 0.02) * Math.PI);
  // R
  if (phase >= 0.14 && phase < 0.18) return 1.0 * Math.sin(((phase - 0.14) / 0.04) * Math.PI);
  // S
  if (phase >= 0.18 && phase < 0.21) return -0.2 * Math.sin(((phase - 0.18) / 0.03) * Math.PI);
  // ST segment
  if (phase >= 0.21 && phase < 0.3) return 0;
  // T wave
  if (phase >= 0.3 && phase < 0.45) return 0.3 * Math.sin(((phase - 0.3) / 0.15) * Math.PI);
  return 0;
}

export function generateABP(time: number, hr: number, sbp: number, dbp: number): number {
  const cycleTime = 60 / hr;
  const phase = (time % cycleTime) / cycleTime;
  const pp = sbp - dbp;

  if (phase < 0.1) {
    // Systolic upstroke
    return dbp + pp * Math.sin((phase / 0.1) * Math.PI * 0.5);
  } else if (phase < 0.15) {
    // Systolic peak to dicrotic notch
    return sbp - pp * 0.15 * ((phase - 0.1) / 0.05);
  } else if (phase < 0.2) {
    // Dicrotic notch
    const notchPhase = (phase - 0.15) / 0.05;
    return (sbp - pp * 0.15) - pp * 0.08 * Math.sin(notchPhase * Math.PI);
  } else {
    // Diastolic decay
    const decayPhase = (phase - 0.2) / 0.8;
    return dbp + pp * 0.3 * Math.exp(-decayPhase * 4);
  }
}

export function generateSpO2Pleth(time: number, hr: number): number {
  const cycleTime = 60 / hr;
  const phase = (time % cycleTime) / cycleTime;

  if (phase < 0.25) {
    return Math.sin((phase / 0.25) * Math.PI * 0.5);
  } else if (phase < 0.35) {
    return 1.0 - 0.15 * ((phase - 0.25) / 0.1);
  } else {
    return 0.85 * Math.exp(-((phase - 0.35) / 0.65) * 3);
  }
}

export function generateCapnography(time: number, rr: number, etco2: number, spontaneousRate: number = 0): number {
  const cycleTime = 60 / rr;
  const phase = (time % cycleTime) / cycleTime;
  const iRatio = 1 / 3; // Inspiration takes 1/3 of cycle
  const dropDuration = 0.04; // fraction of cycle for the descending limb

  if (phase < dropDuration) {
    // Descending limb - sharp drop from EtCO2 to 0 at start of inspiration
    return etco2 * (1 - phase / dropDuration);
  } else if (phase < iRatio) {
    // Rest of inspiration - CO2 at zero (inspiratory baseline)
    return 0;
  } else {
    const ePhase = (phase - iRatio) / (1 - iRatio);
    let co2: number;
    if (ePhase < 0.08) {
      // Phase II - rapid upstroke
      co2 = etco2 * 0.75 * (ePhase / 0.08);
    } else if (ePhase < 0.9) {
      // Phase III - alveolar plateau with slight upward slope
      co2 = etco2 * (0.75 + 0.25 * ((ePhase - 0.08) / 0.82));
    } else {
      // End of plateau at EtCO2 (just before next inspiration drops it)
      co2 = etco2;
    }

    // Curare cleft: spontaneous inspiratory effort during phase III
    // creates a transient dip in CO2 as fresh gas is drawn in
    if (spontaneousRate > 0 && ePhase >= 0.3 && ePhase <= 0.65) {
      const cleftCenter = 0.475;
      const cleftWidth = 0.12;
      const cleftPos = (ePhase - cleftCenter) / cleftWidth;
      if (Math.abs(cleftPos) < 1) {
        // Smooth dip using cosine shape, depth proportional to effort
        const cleftDepth = Math.min(0.25, spontaneousRate / 60) * etco2;
        co2 -= cleftDepth * (0.5 + 0.5 * Math.cos(cleftPos * Math.PI));
      }
    }

    return co2;
  }
}
