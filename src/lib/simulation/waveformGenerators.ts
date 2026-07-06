import { PatientPhysiology, VentSettings, CommonSettings, VCVSettings, PCVSettings, PRVCSettings, SIMVSettings, PSVSettings, APRVSettings } from './types';

const SAMPLE_RATE = 50; // Hz (kept for parity; not currently used here)
void SAMPLE_RATE;

// --- Breath Stacking / Air Trapping ---
// For high-resistance patients, if expiratory time is too short relative to
// the time constant (tau = R * C), exhaled volume doesn't reach zero before
// the next breath, causing progressive volume stacking (auto-PEEP).

function calcTrappedVolume(s: CommonSettings, p: PatientPhysiology, deliveredVolumeMl: number): number {
  const C = p.compliance / 1000;
  const R = p.resistance;
  const tau = R * C;
  const cycleTime = 60 / s.respiratoryRate;
  const iTime = s.inspiratoryTime > 0 ? s.inspiratoryTime : cycleTime / (1 + s.ieRatio);
  const eTime = cycleTime - iTime;

  const retainedFraction = Math.exp(-eTime / tau);
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
    case 'VCV':  return vcvWaveform(time, settings, patient);
    case 'PCV':  return pcvWaveform(time, settings, patient);
    case 'PRVC': return prvcWaveform(time, settings, patient);
    case 'SIMV': return simvWaveform(time, settings, patient);
    case 'PSV':  return psvWaveform(time, settings, patient);
    case 'APRV': return aprvWaveform(time, settings, patient);
  }
}

/** Resolve inspiratory time: prefer explicit Ti, fall back to I:E ratio */
function getITime(s: CommonSettings): number {
  if (s.inspiratoryTime > 0) return s.inspiratoryTime;
  const cycleTime = 60 / s.respiratoryRate;
  return cycleTime / (1 + s.ieRatio);
}

/** Structural subtypes — a VCV breath just needs common timing + tidalVolume. */
type VCVLike = CommonSettings & { tidalVolume: number };
type PCVLike = CommonSettings & { pInsp: number };

function vcvWaveform(time: number, s: VCVLike, p: PatientPhysiology) {
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

function pcvWaveform(time: number, s: PCVLike, p: PatientPhysiology) {
  const cycleTime = 60 / s.respiratoryRate;
  const iTime = getITime(s);
  const phase = time % cycleTime;
  const C = p.compliance / 1000;
  const R = p.resistance;
  const tau = R * C;

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

function prvcWaveform(time: number, s: PRVCSettings, p: PatientPhysiology) {
  // PRVC auto-adjusts pressure to achieve target volume
  const C = p.compliance / 1000;
  const R = p.resistance;
  const tau = R * C;
  const iTime = getITime(s);

  const targetPressure = Math.min(
    (s.tidalVolume / 1000) / (C * (1 - Math.exp(-iTime / tau))),
    s.pMax
  );

  const pcvLike: PCVLike = { ...pickCommon(s), pInsp: targetPressure };
  return pcvWaveform(time, pcvLike, p);
}

function simvWaveform(time: number, s: SIMVSettings, p: PatientPhysiology) {
  const cycleTime = 60 / s.respiratoryRate;
  const breathIndex = Math.floor(time / cycleTime);
  const isMandatory = breathIndex % 2 === 0 || p.spontaneousRate === 0;

  if (isMandatory) {
    // Mandatory VCV breath using the SIMV target TV
    const vcvLike: VCVLike = { ...pickCommon(s), tidalVolume: s.tidalVolume };
    return vcvWaveform(time, vcvLike, p);
  }
  // Spontaneous PS breath
  const spontRate = p.spontaneousRate || 10;
  const spontCycle = 60 / spontRate;
  const spontPhase = time % spontCycle;
  const psLike: PCVLike = {
    ...pickCommon(s),
    respiratoryRate: spontRate,
    pInsp: s.pressureSupport,
  };
  return pcvWaveform(spontPhase, psLike, p);
}

function psvWaveform(time: number, s: PSVSettings, p: PatientPhysiology) {
  const rate = p.spontaneousRate > 0 ? p.spontaneousRate : 12;
  const psLike: PCVLike = {
    ...pickCommon(s),
    respiratoryRate: rate,
    ieRatio: 2,
    pInsp: s.pressureSupport,
  };
  const result = pcvWaveform(time, psLike, p);

  // Small negative deflection for patient trigger
  const cycleTime = 60 / rate;
  const phase = time % cycleTime;
  if (phase < 0.15) {
    result.pressure -= 1.5 * Math.sin(phase / 0.15 * Math.PI);
  }
  return result;
}

function aprvWaveform(time: number, s: APRVSettings, p: PatientPhysiology) {
  const totalCycle = s.tHigh + s.tLow;
  const phase = time % totalCycle;
  const C = p.compliance / 1000;
  const R = p.resistance;
  const tau = R * C;

  if (phase < s.tHigh) {
    const transitionTime = Math.min(phase, tau * 3);
    const pressure = s.pHigh;
    const volume = (s.pHigh - s.pLow) * C * (1 - Math.exp(-transitionTime / tau)) * 1000;
    const flow = phase < tau * 3 ? ((s.pHigh - s.pLow) / R) * Math.exp(-transitionTime / tau) * 60 : 0;
    return { pressure, flow, volume };
  } else {
    const ePhase = phase - s.tHigh;
    const vol0 = (s.pHigh - s.pLow) * C * 1000;
    const volume = vol0 * Math.exp(-ePhase / (tau * 0.3));
    const flow = -(volume / 1000) / (tau * 0.3) * 60;
    const pressure = s.pLow + (volume / 1000) / C;
    return { pressure: Math.max(pressure, s.pLow), flow, volume: Math.max(volume, 0) };
  }
}

function pickCommon(s: CommonSettings): CommonSettings {
  return {
    peep: s.peep,
    fio2: s.fio2,
    respiratoryRate: s.respiratoryRate,
    ieRatio: s.ieRatio,
    inspiratoryTime: s.inspiratoryTime,
  };
}

// Re-exports so the type surface for waveform callers is complete.
export type { VCVSettings, PCVSettings };

// --- Patient Monitor Waveforms ---

export function generateECG(time: number, hr: number): number {
  const cycleTime = 60 / hr;
  const phase = (time % cycleTime) / cycleTime;

  if (phase >= 0.0 && phase < 0.08) return 0.15 * Math.sin((phase / 0.08) * Math.PI);
  if (phase >= 0.08 && phase < 0.12) return 0;
  if (phase >= 0.12 && phase < 0.14) return -0.1 * Math.sin(((phase - 0.12) / 0.02) * Math.PI);
  if (phase >= 0.14 && phase < 0.18) return 1.0 * Math.sin(((phase - 0.14) / 0.04) * Math.PI);
  if (phase >= 0.18 && phase < 0.21) return -0.2 * Math.sin(((phase - 0.18) / 0.03) * Math.PI);
  if (phase >= 0.21 && phase < 0.3) return 0;
  if (phase >= 0.3 && phase < 0.45) return 0.3 * Math.sin(((phase - 0.3) / 0.15) * Math.PI);
  return 0;
}

export function generateABP(time: number, hr: number, sbp: number, dbp: number): number {
  const cycleTime = 60 / hr;
  const phase = (time % cycleTime) / cycleTime;
  const pp = sbp - dbp;

  if (phase < 0.1) {
    return dbp + pp * Math.sin((phase / 0.1) * Math.PI * 0.5);
  } else if (phase < 0.15) {
    return sbp - pp * 0.15 * ((phase - 0.1) / 0.05);
  } else if (phase < 0.2) {
    const notchPhase = (phase - 0.15) / 0.05;
    return (sbp - pp * 0.15) - pp * 0.08 * Math.sin(notchPhase * Math.PI);
  } else {
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
  const iRatio = 1 / 3;
  const dropDuration = 0.04;

  if (phase < dropDuration) {
    return etco2 * (1 - phase / dropDuration);
  } else if (phase < iRatio) {
    return 0;
  } else {
    const ePhase = (phase - iRatio) / (1 - iRatio);
    let co2: number;
    if (ePhase < 0.08) {
      co2 = etco2 * 0.75 * (ePhase / 0.08);
    } else if (ePhase < 0.9) {
      co2 = etco2 * (0.75 + 0.25 * ((ePhase - 0.08) / 0.82));
    } else {
      co2 = etco2;
    }

    if (spontaneousRate > 0 && ePhase >= 0.3 && ePhase <= 0.65) {
      const cleftCenter = 0.475;
      const cleftWidth = 0.12;
      const cleftPos = (ePhase - cleftCenter) / cleftWidth;
      if (Math.abs(cleftPos) < 1) {
        const cleftDepth = Math.min(0.25, spontaneousRate / 60) * etco2;
        co2 -= cleftDepth * (0.5 + 0.5 * Math.cos(cleftPos * Math.PI));
      }
    }

    return co2;
  }
}

// Keep unused imports silent.
void VCVSettings; void PCVSettings;
