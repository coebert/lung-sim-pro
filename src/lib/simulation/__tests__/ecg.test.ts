import { describe, it, expect } from 'vitest';
import { generateECG } from '../waveformGenerators';

/**
 * The original ECG generator used a very narrow piecewise-sine QRS complex
 * (~2 samples wide at 50 Hz).  Because the cardiac cycle rarely aligns with
 * the 50 Hz sample grid, the R-wave peak was captured at different phases on
 * successive beats, producing a visible beat-to-beat amplitude variation that
 * looked like electrical alternans.  These tests ensure the new smooth, broad
 * P-QRS-T produces a consistent amplitude across a wide range of heart rates
 * and sampling rates.
 */
const HEART_RATES = [30, 40, 50, 60, 72, 84, 96, 110, 120, 140, 160, 180, 200];
const SAMPLE_RATES = [50, 60, 100, 200];

function ecgPeaks(hr: number, sampleRate: number, seconds = 20): number[] {
  const dt = 1 / sampleRate;
  const samples = Math.floor(seconds / dt);
  const values: number[] = [];
  for (let i = 0; i < samples; i++) {
    values.push(generateECG(i * dt, hr));
  }
  const peaks: number[] = [];
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] >= values[i - 1] && values[i] > values[i + 1] && values[i] > 0.5) {
      peaks.push(values[i]);
    }
  }
  return peaks;
}

describe('ECG amplitude consistency', () => {
  for (const sampleRate of SAMPLE_RATES) {
    describe(`at ${sampleRate} Hz sampling`, () => {
      it.each(HEART_RATES)('has no visible amplitude variation at HR %i', (hr) => {
        const peaks = ecgPeaks(hr, sampleRate);
        expect(peaks.length).toBeGreaterThan(2);
        const variation = Math.max(...peaks) - Math.min(...peaks);
        expect(variation).toBeLessThan(0.08);
      });

      it.each(HEART_RATES)('has no odd/even beat alternation at HR %i', (hr) => {
        const peaks = ecgPeaks(hr, sampleRate);
        const odd = peaks.filter((_, i) => i % 2 === 0);
        const even = peaks.filter((_, i) => i % 2 === 1);
        const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
        // Electrical alternans = systematic difference between alternate beats.
        // Tolerance is 3% of the R-wave amplitude: at heart rates that are
        // exactly commensurate with the sample rate (e.g. HR 96 at 60 Hz) a
        // residual sub-sample difference is unavoidable, but below this level
        // it is invisible on screen.
        expect(Math.abs(mean(odd) - mean(even))).toBeLessThan(0.03);
      });

      it.each(HEART_RATES)('produces exactly one R-wave per cardiac cycle at HR %i', (hr) => {
        const seconds = 20;
        const peaks = ecgPeaks(hr, sampleRate, seconds);
        const expected = (hr / 60) * seconds;
        expect(peaks.length).toBeGreaterThanOrEqual(Math.floor(expected) - 1);
        expect(peaks.length).toBeLessThanOrEqual(Math.ceil(expected) + 1);
      });
    });
  }
});
