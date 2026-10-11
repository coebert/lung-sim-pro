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

import { CardiacClock, ecgAtBeat, abpAtBeat, plethAtBeat } from '../waveformGenerators';

describe('CardiacClock — shared beat timing', () => {
  it('keeps QRS amplitude identical while HR drifts, and pulses lag the R wave', () => {
    const clock = new CardiacClock();
    const peaks: number[] = [];
    let beatMax = -Infinity, rIdx = 0, abpIdx = 0, plIdx = 0, abpMax = -Infinity, plMax = -Infinity, i = 0, beatLen = 1;
    let lags: Array<[number, number]> = [];
    let hr = 80;
    for (let n = 0; n < 50 * 120; n++) {
      hr = 80 + 30 * Math.sin(n / 1500); // drifting heart rate
      const bt = clock.next(hr);
      if (bt.t0 === 0 && n > 0) {
        peaks.push(beatMax);
        const m = (x: number) => ((x % beatLen) + beatLen) % beatLen; // pulse peaks may wrap into next beat
        lags.push([m(abpIdx - rIdx), m(plIdx - rIdx)]);
        i = 0;
        beatMax = -Infinity; abpMax = -Infinity; plMax = -Infinity;
      }
      beatLen = Math.round(bt.cycle * 50);
      const e = ecgAtBeat(bt), a = abpAtBeat(bt, 120, 70), p = plethAtBeat(bt);
      if (e > beatMax) { beatMax = e; rIdx = i; }
      if (a > abpMax) { abpMax = a; abpIdx = i; }
      if (p > plMax) { plMax = p; plIdx = i; }
      i++;
    }
    // Morphology may change slowly with rate, but consecutive beats must
    // match (beat-to-beat alternation would mimic electrical alternans).
    for (let b = 1; b < peaks.length; b++) {
      expect(Math.abs(peaks[b] - peaks[b - 1])).toBeLessThan(0.005);
    }
    lags = lags.slice(1);
    for (const [abpLag, plLag] of lags) {
      expect(abpLag).toBeGreaterThan(0);
      expect(plLag).toBeGreaterThan(abpLag);
    }
  });
});
