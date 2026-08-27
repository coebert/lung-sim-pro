import { describe, it, expect } from 'vitest';
import { generateECG } from '../waveformGenerators';

/**
 * The original ECG generator used a very narrow piecewise-sine QRS complex
 * (~2 samples wide at 50 Hz).  Because the cardiac cycle rarely aligns with
 * the 50 Hz sample grid, the R-wave peak was captured at different phases on
 * successive beats, producing a visible beat-to-beat amplitude variation that
 * looked like electrical alternans.  These tests ensure the new smooth, broad
 * P-QRS-T produces a consistent amplitude across common heart rates.
 */
function ecgPeaks(hr: number, seconds = 10): number[] {
  const dt = 0.02;
  const samples = Math.floor(seconds / dt);
  const values: number[] = [];
  for (let i = 0; i < samples; i++) {
    values.push(generateECG(i * dt, hr));
  }
  const peaks: number[] = [];
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] > values[i - 1] && values[i] > values[i + 1] && values[i] > 0.5) {
      peaks.push(values[i]);
    }
  }
  return peaks;
}

describe('ECG amplitude consistency', () => {
  it.each([60, 72, 90, 120, 150])('has no visible alternans at HR %i', (hr) => {
    const peaks = ecgPeaks(hr);
    expect(peaks.length).toBeGreaterThan(0);
    const variation = Math.max(...peaks) - Math.min(...peaks);
    expect(variation).toBeLessThan(0.08);
  });
});
