import { PatientPhysiology } from '@/lib/simulation/types';

export type Severity = 'stable' | 'moderate' | 'severe' | 'critical';

/** Classify a patient by their base SpO₂, compliance and resistance. */
export function classifyPatient(p: PatientPhysiology): Severity {
  if (p.baseSpO2 < 88 || p.compliance <= 20) return 'critical';
  if (p.baseSpO2 < 94 || p.compliance <= 30 || p.resistance >= 15) return 'severe';
  if (p.baseSpO2 < 97 || p.compliance <= 40 || p.resistance >= 10) return 'moderate';
  return 'stable';
}

export const SEVERITY_META: Record<Severity, { label: string; token: string; dot: string }> = {
  stable:   { label: 'Stable',   token: 'text-success',  dot: 'bg-success' },
  moderate: { label: 'Moderate', token: 'text-info',     dot: 'bg-info' },
  severe:   { label: 'Severe',   token: 'text-warning',  dot: 'bg-warning' },
  critical: { label: 'Critical', token: 'text-danger',   dot: 'bg-danger' },
};
