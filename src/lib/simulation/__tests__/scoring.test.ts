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
function round(obj: Record<string, unknown>, dp = 4): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const factor = 10 ** dp;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number') out[k] = Math.round(v * factor) / factor;
    else if (v && typeof v === 'object') out[k] = round(v as Record<string, unknown>, dp);
    else out[k] = v;
  }
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
