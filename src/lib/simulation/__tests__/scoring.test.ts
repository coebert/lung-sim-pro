/**
 * Golden-file tests for the physiology scoring primitives.
 *
 * These snapshots pin the *behaviour* of `computeIE`, `computeShunt` and
 * `computeAPRV`. Any refactor that silently changes a coefficient or clamp
 * bound will show up here as a snapshot diff, forcing a conscious update
 * rather than an unnoticed drift in trainer-visible physiology.
 */

import { describe, it, expect } from 'vitest';
import { computeIE, computeShunt, computeAPRV } from '../scoring';
import { patients } from '../patients';
import type { APRVSettings, CommonSettings, PatientPhysiology } from '../types';

// A small, deterministic snapshot helper: round every numeric field so
// floating-point noise from JS math doesn't churn the golden files.
function round<T>(obj: T, dp = 4): unknown {
  const factor = 10 ** dp;
  if (typeof obj === 'number') return Math.round(obj * factor) / factor;
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(v => round(v, dp));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = round(v, dp);
  return out;
}

const byId = new Map<string, PatientPhysiology>(patients.map(p => [p.id, p]));
const patient = (id: string): PatientPhysiology => {
  const p = byId.get(id);
  if (!p) throw new Error(`unknown patient ${id}`);
  return p;
};

// ─── I:E timing ─────────────────────────────────────────────────────

describe('computeIE — I:E timing', () => {
  const scenarios: Array<[string, CommonSettings]> = [
    ['normal 1:2 @ RR12', { peep: 5, fio2: 0.4, respiratoryRate: 12, ieRatio: 2, inspiratoryTime: 0 }],
    ['inverse 2:1 via ieRatio 0.5', { peep: 5, fio2: 0.4, respiratoryRate: 15, ieRatio: 0.5, inspiratoryTime: 0 }],
    ['fixed iTime 1.0s @ RR20',    { peep: 8, fio2: 0.5, respiratoryRate: 20, ieRatio: 2, inspiratoryTime: 1.0 }],
    ['bronchospasm 1:4 @ RR10',    { peep: 5, fio2: 0.5, respiratoryRate: 10, ieRatio: 4, inspiratoryTime: 0 }],
  ];

  it.each(scenarios)('%s', (_label, s) => {
    expect(round(computeIE(s))).toMatchSnapshot();
  });
});

// ─── Shunt fraction ─────────────────────────────────────────────────

describe('computeShunt — PEEP + I-time driven shunt', () => {
  const settings = (over: Partial<CommonSettings>): CommonSettings => ({
    peep: 5, fio2: 0.4, respiratoryRate: 14, ieRatio: 2, inspiratoryTime: 0, ...over,
  });

  const cases: Array<[string, string, Partial<CommonSettings>]> = [
    ['healthy — sane settings',        'healthy',      {}],
    ['healthy — excessive PEEP',       'healthy',      { peep: 18 }],
    ['ards — normal PEEP for ARDS',    'ards',         { peep: 14 }],
    ['ards — PEEP overshoot',          'ards',         { peep: 24 }],
    ['ards — inverse ratio',           'ards',         { peep: 14, ieRatio: 0.5 }],
    ['bronchospasm — long i-time',     'bronchospasm', { peep: 5, inspiratoryTime: 2.0, respiratoryRate: 10 }],
  ];

  it.each(cases)('%s', (_label, id, over) => {
    expect(round(computeShunt(settings(over), patient(id)))).toMatchSnapshot();
  });
});

// ─── APRV recruitment ───────────────────────────────────────────────

describe('computeAPRV — recruitment score for ARDS', () => {
  const ards = patient('ards');
  const aprv = (over: Partial<APRVSettings>): APRVSettings => ({
    mode: 'APRV',
    peep: 0, fio2: 0.8, respiratoryRate: 12, ieRatio: 2, inspiratoryTime: 0,
    pHigh: 28, pLow: 0, tHigh: 4.5, tLow: 0.5,
    ...over,
  });

  const cases: Array<[string, Partial<APRVSettings>]> = [
    ['optimal',                                 {}],
    ['P-High too low — no driving pressure',    { pHigh: 15 }],
    ['P-High excessive — barotrauma risk',      { pHigh: 40 }],
    ['T-High too short — partial recruitment',  { tHigh: 1.0 }],
    ['T-Low too long — de-recruitment',         { tLow: 1.5 }],
    ['T-Low too short — no CO2 clearance',      { tLow: 0.05 }],
    ['P-Low elevated — narrow differential',    { pLow: 8 }],
  ];

  it.each(cases)('%s', (_label, over) => {
    expect(round(computeAPRV(aprv(over), ards))).toMatchSnapshot();
  });
});

// ─── Per-patient snapshot: patient physiology parameters ────────────

describe('patient physiology — canonical parameters', () => {
  // Pins the tuned per-patient numbers (openingPressure, proneVQBonus, etc.)
  // that drive trainer-visible outcomes. Bumping any value must be conscious.
  it('all patients', () => {
    const canon = patients.map(p => round(p as unknown as Record<string, unknown>));
    expect(canon).toMatchSnapshot();
  });
});

// ─── APRV monotonicity: pHigh drives recruitment until it saturates ─

describe('computeAPRV — recruitmentScore monotonicity in pHigh', () => {
  const ards = patient('ards');
  const base: APRVSettings = {
    mode: 'APRV',
    peep: 0, fio2: 0.8, respiratoryRate: 12, ieRatio: 2, inspiratoryTime: 0,
    pHigh: 0, pLow: 0, tHigh: 4.5, tLow: 0.5,
  };

  // Sweep pHigh across the clinically-plausible range. `pHighScore` is a
  // clamp((drivingPressure - openingPressure*0.5) / openingPressure, 0, 1),
  // so recruitmentScore must rise monotonically with pHigh and then saturate
  // at the clamp — locking in "more driving pressure never hurts recruitment
  // in the model, but the barotrauma-region clamp caps it".
  const sweep = Array.from({ length: 13 }, (_, i) => 10 + i * 2); // 10..34

  it('is monotonically non-decreasing across pHigh sweep', () => {
    const rows = sweep.map(pHigh => {
      const m = computeAPRV({ ...base, pHigh }, ards);
      return {
        pHigh,
        pHighScore: Math.round(m.pHighScore * 10000) / 10000,
        recruitmentScore: Math.round(m.recruitmentScore * 10000) / 10000,
      };
    });
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].recruitmentScore).toBeGreaterThanOrEqual(rows[i - 1].recruitmentScore);
    }
    // The sweep must actually reach the barotrauma clamp (pHighScore === 1)
    // by the top of the range — otherwise the test isn't proving saturation.
    expect(rows[rows.length - 1].pHighScore).toBe(1);
    // And once pHighScore saturates, recruitmentScore must stay flat (since
    // tHigh / tLow / pLow are all fixed across the sweep).
    const saturated = rows.filter(r => r.pHighScore === 1).map(r => r.recruitmentScore);
    expect(new Set(saturated).size).toBe(1);
    expect(rows).toMatchSnapshot();
  });
});
