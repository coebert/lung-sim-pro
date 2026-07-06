/**
 * Resolved theme constants for the simulator.
 *
 * Canvas contexts and inline SVG can't consume CSS custom-property syntax
 * directly (they need concrete color strings), so the semantic tokens in
 * `index.css` are mirrored here as literal HSL values. Change both in
 * lockstep — a single source per surface (React/CSS vs canvas/SVG).
 */

export const WAVE_COLOR = {
  pressure: 'hsl(55, 100%, 50%)',
  flow:     'hsl(180, 100%, 50%)',
  volume:   'hsl(120, 100%, 45%)',
  ecg:      'hsl(120, 100%, 50%)',
  abp:      'hsl(0, 100%, 55%)',
  spo2:     'hsl(180, 100%, 55%)',
  capno:    'hsl(45, 100%, 70%)',
} as const;

export const VITAL_COLOR = {
  hr:      WAVE_COLOR.ecg,
  abp:     WAVE_COLOR.abp,
  spo2Ok:  WAVE_COLOR.spo2,
  spo2Low: 'hsl(0, 100%, 55%)',
  etco2:   WAVE_COLOR.capno,
  danger:  'hsl(0, 100%, 55%)',
} as const;

export const MONITOR_COLOR = {
  bg:        'hsl(220, 30%, 3%)',
  grid:      'hsl(216, 20%, 10%)',
  scaleText: 'hsl(215, 15%, 40%)',
} as const;

export function spo2Color(spo2: number): string {
  return spo2 < 90 ? VITAL_COLOR.spo2Low : VITAL_COLOR.spo2Ok;
}

export function hrColor(hr: number): string {
  return hr > 120 || hr < 50 ? VITAL_COLOR.danger : VITAL_COLOR.hr;
}
