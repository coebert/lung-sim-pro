import { describe, expect, it } from 'vitest';
import { breathDrive, lungPose3D, lungShape } from './lungMotion';

const vol = (trough: number, peak: number) => Array.from({ length: 300 }, (_, i) => trough + (peak - trough) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 100)));

describe('3D lung pose from the live presentation drive', () => {
  it('has no motion when the volume buffer is frozen at the same sample', () => {
    const v = vol(0, 500);
    const d = breathDrive(v, 500, 100);
    const a = lungPose3D(d, lungShape(d, 1, 0), 0);
    const b = lungPose3D(breathDrive(v, 500, 100), lungShape(breathDrive(v, 500, 100), 1, 0), 0);
    expect(a).toEqual(b);
  });

  it('tidal offset is zero at end-expiration and grows with delivered volume', () => {
    const v = vol(0, 500);
    const atTrough = breathDrive(v, 500, 100, 0);
    const atPeak = breathDrive(v, 500, 100, 500);
    expect(lungPose3D(atTrough, lungShape(atTrough, 1, 0), 0).tidal).toBeCloseTo(0, 6);
    expect(lungPose3D(atPeak, lungShape(atPeak, 1, 0), 0).tidal).toBeGreaterThan(0.15);
  });

  it('trapped gas raises the persistent baseline and flattens/lowers the diaphragm', () => {
    const normal = breathDrive(vol(0, 500), 500, 100, 0);
    const trapped = breathDrive(vol(450, 700), 500, 100, 450);
    const pn = lungPose3D(normal, lungShape(normal, 1, 0), 0);
    const pt = lungPose3D(trapped, lungShape(trapped, 1, 0), 0);
    expect(pt.base).toBeGreaterThan(pn.base + 0.15);
    expect(pt.flat).toBe(1);
    expect(pt.drop).toBeGreaterThan(pn.drop);
    expect(pn.flat).toBe(0);
  });

  it('regional atelectasis is per lung: one lung can lose basal volume while the other does not', () => {
    const d = breathDrive(vol(0, 400), 500, 100, 200);
    const s = lungShape(d, 0.8, 0.8);
    const right = lungPose3D(d, s, 0.8);
    const left = lungPose3D(d, s, 0);
    expect(right.basal).toBeCloseTo(0.36, 6);
    expect(left.basal).toBe(0);
    expect(right.tidal).toBe(left.tidal);
  });
});
