import { MeasuredValues, Vitals } from './types';

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
  spo2Low: 90,
};

export function evaluateAlarms(
  measured: MeasuredValues,
  vitals: Vitals,
  limits: AlarmLimits
): Alarm[] {
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
      active: measured.measuredTV > 0 && measured.measuredTV < limits.tvLow,
    },
    {
      id: 'spo2-low',
      label: `Low SpO₂ (<${limits.spo2Low}%)`,
      severity: 'high',
      active: vitals.spo2 < limits.spo2Low,
    },
  ];
}

// Audio alarm using Web Audio API
let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
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
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch { /* ignore audio errors */ }
  };
  beep();
  const ms = severity === 'high' ? 800 : 1500;
  alarmInterval = window.setInterval(beep, ms);
}

export function stopAlarmSound() {
  if (alarmInterval !== null) {
    clearInterval(alarmInterval);
    alarmInterval = null;
  }
}
