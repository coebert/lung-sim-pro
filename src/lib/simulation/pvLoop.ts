import type { PatientPhysiology, VentSettings } from './types';

/**
 * Display-only lung mechanics for the pressure–volume loop.
 *
 * The core waveform model is a linear single-compartment RC lung, which on
 * its own draws a straight-sided loop. Real lungs are non-linear:
 *  - Lower inflection: when PEEP is below the alveolar opening pressure,
 *    the first part of the breath goes into recruiting collapsed units, so
 *    pressure rises steeply for little volume (flat lower limb).
 *  - Upper inflection: above ~25 cmH₂O alveolar pressure, compliance falls
 *    (overdistension), giving the classic "beak" at end-inspiration.
 *  - Resistance: under constant flow the inspiratory limb is shifted right
 *    by R·flow, so higher airway resistance widens the loop; on exhalation
 *    the airway pressure sits slightly above PEEP by the circuit/valve
 *    resistance times expiratory flow.
 *
 * Pressure-targeted modes keep the ventilator's set airway pressure (the
 * lung shape then shows up in the volume reached, which the model already
 * captures through the time constant).
 */
const UPPER_KNEE = 25;      // cmH₂O alveolar pressure where overdistension starts
const UPPER_GAIN = 0.04;    // cmH₂O per cmH₂O² above the knee
const LOWER_GAIN = 0.45;    // fraction of (opening − PEEP) spent recruiting
const EXP_CIRCUIT_R = 3;    // cmH₂O/L/s — expiratory limb + valve

export function pvLoopPressures(
  pressure: number[],
  flow: number[],
  settings: VentSettings,
  patient: PatientPhysiology,
): number[] {
  const n = Math.min(pressure.length, flow.length);
  const out = new Array<number>(n);
  const C = patient.compliance; // mL/cmH₂O
  const R = patient.resistance;
  const base = settings.mode === 'APRV' ? settings.pLow : settings.peep;
  const opening = patient.openingPressure ?? patient.optimalPEEP * 1.5;
  const recruitAmp = Math.max(0, opening - base) * LOWER_GAIN;
  const v0 = 3 * C; // mL over which recruitment completes

  for (let i = 0; i < n; i++) {
    const p = pressure[i];
    const fLs = flow[i] / 60;
    if (fLs < 0) {
      out[i] = p + EXP_CIRCUIT_R * -fLs;
      continue;
    }
    // Pressure-targeted modes (APRV/PCV/PSV/PRVC) hold Paw at the set level,
    // so shape the displayed pressure around it: strip the resistive drop to
    // get alveolar pressure, apply the compliance knees, then add it back.
    // With flow ≈ 0 on the APRV T High plateau this still curves the loop
    // with compliance (recruitment limb) and resistance (hysteresis width).
    const resistive = R * fLs;
    const vel = Math.max(0, (p - base - resistive) * C); // mL above PEEP (incl. trapped)
    const palvLin = base + vel / C;
    const lower = recruitAmp * (1 - Math.exp(-vel / v0));
    const over = Math.max(0, palvLin - UPPER_KNEE);
    out[i] = palvLin + lower + UPPER_GAIN * over * over + resistive;
  }
  return out;
}
