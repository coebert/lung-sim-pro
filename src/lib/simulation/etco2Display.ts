import type { Vitals } from './types';

/**
 * One rule for showing EtCO₂ everywhere (monitor, headers, bedside, trends):
 * a dash when there is no valid sample (no exhaled CO₂, or still measuring
 * the first breath on new settings), and a "no plateau" qualifier when the
 * value under-reads alveolar CO₂.
 */
export function etco2Display(v: Pick<Vitals, 'etco2' | 'etco2Status'>) {
  const status = v.etco2Status ?? 'plateau';
  const valid = status === 'plateau' || status === 'no-plateau';
  const kPa = v.etco2 / 7.501;
  return {
    valid,
    kPa: valid ? kPa : NaN,
    text: valid ? kPa.toFixed(1) : '—',
    note: status === 'no-plateau' ? 'no plateau' : status === 'unavailable' ? 'no signal' : status === 'measuring' ? 'measuring' : undefined,
  };
}
