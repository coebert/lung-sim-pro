/**
 * Scenario oxygen targets (SpO₂ %), shared by live feedback and tutorials so
 * the panel never warns about a value a lesson explicitly targets.
 */
export function spo2Target(patientId: string): [number, number] {
  switch (patientId) {
    case 'copd':
    case 'copd-spont':
      return [88, 92]; // CO₂ retainer: avoid excess oxygen
    case 'ards':
      return [88, 95];
    case 'bronchospasm':
      return [88, 100];
    case 'healthy':
    case 'healthy-spont':
      return [94, 100];
    default:
      return [92, 100];
  }
}
