import { MeasuredValues, PatientPhysiology, VentSettings, Vitals } from './types';
import { prvcInspPressure, PRVC_PMAX_RESERVE } from './waveformGenerators';
import { APNOEA_TIME_SEC } from './measurement';

export type AlarmSeverity = 'high' | 'medium' | 'low';

export interface Alarm {
  id: string;
  label: string;
  severity: AlarmSeverity;
  active: boolean;
}

export interface AlarmLimits {
  pipHigh: number;
  tvLow: number;
  spo2Low: number;
}

export const DEFAULT_ALARM_LIMITS: AlarmLimits = {
  pipHigh: 40,
  tvLow: 200,
  spo2Low: 88, // ARDS target range is 88–95%
};

/**
 * Case-appropriate limits. Low exhaled VT is set at 4 mL/kg predicted body
 * weight, capped at the adult default (200 mL), so a 20 kg child's
 * 6–8 mL/kg target (120–160 mL) does not trip an adult alarm.
 */
export function alarmLimitsFor(patient: PatientPhysiology): AlarmLimits {
  const pbw = patient.predictedBodyWeight ?? patient.weight;
  return {
    ...DEFAULT_ALARM_LIMITS,
    tvLow: Math.min(DEFAULT_ALARM_LIMITS.tvLow, Math.round(4 * pbw)),
    pipHigh: pbw < 40 ? 35 : DEFAULT_ALARM_LIMITS.pipHigh,
  };
}

export function evaluateAlarms(
  measured: MeasuredValues,
  vitals: Vitals,
  limits: AlarmLimits,
  settings?: VentSettings,
  patient?: PatientPhysiology,
): Alarm[] {
  const apnoea = measured.apnoea ?? measured.measuredTV < 50;
  const warming = measured.warmingUp === true;
  const prvc = settings?.mode === 'PRVC' && patient ? prvcInspPressure(settings, patient) : null;
  const extra: Alarm[] = prvc ? [
    {
      id: 'prvc-conflict',
      label: `Pmax ${settings!.mode === 'PRVC' ? settings!.pMax : ''} ≤ PEEP + ${PRVC_PMAX_RESERVE}: no breath possible`,
      severity: 'high',
      active: prvc.conflict,
    },
    {
      id: 'prvc-target',
      label: 'Target VT not reached (pressure limited)',
      severity: 'medium',
      active: !prvc.conflict && prvc.limited,
    },
  ] : [];
  return [
    {
      id: 'pip-high',
      label: `High PIP (>${limits.pipHigh})`,
      severity: 'high',
      active: measured.peakPressure > limits.pipHigh,
    },
    {
      id: 'tv-low',
      label: `Low VTe (<${limits.tvLow})`,
      severity: 'medium',
      active: !apnoea && !warming && measured.measuredTV >= 50 && measured.measuredTV < limits.tvLow,
    },
    {
      id: 'apnoea',
      label: `Apnoea (no breath for >${APNOEA_TIME_SEC} s)`,
      severity: 'high',
      active: apnoea,
    },
    {
      id: 'spo2-low',
      label: `Low SpO₂ (<${limits.spo2Low}%)`,
      severity: 'high',
      active: vitals.spo2 < limits.spo2Low,
    },
    {
      id: 'p-limit',
      label: 'High pressure limit — breath terminated, VT not delivered',
      severity: 'high',
      active: (measured.pressureLimited ?? 0) > 0,
    },
    ...extra,
  ];
}

// Audio alarm using Web Audio API
let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') void audioCtx.resume().catch(() => {});
  return audioCtx;
}

let alarmInterval: number | null = null;

export function startAlarmSound(severity: AlarmSeverity) {
  stopAlarmSound();
  const beep = () => {
    try {
      const ctx = getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = severity === 'high' ? 880 : 660;
      gain.gain.value = 0.15;
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch { /* ignore audio errors */ }
  };
  beep();
  const ms = severity === 'high' ? 800 : 1500;
  alarmInterval = window.setInterval(beep, ms);
}

// Browsers only allow audio after a user gesture — unlock on first interaction.
if (typeof window !== 'undefined') {
  const unlock = () => { try { getAudioCtx(); } catch { /* ignore */ } };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

export function stopAlarmSound() {
  if (alarmInterval !== null) {
    clearInterval(alarmInterval);
    alarmInterval = null;
  }
}
