import { AllModeParams, Vitals, MeasuredValues, VentMode } from './types';
import { computeIE } from './scoring';
import { isApnoeic } from './engine';
import { aprvReleaseMetrics } from './waveformGenerators';
import { patients } from './patients';
import { buildVentSettings, APRVSettings } from './types';

/** End-release flow as % of peak expiratory flow for the ARDS case's lung. */
export function ardsEndReleasePct(s: AllModeParams): number {
  const ards = patients.find(p => p.id === 'ards')!;
  return aprvReleaseMetrics({ ...buildVentSettings({ ...s, mode: 'APRV' }) } as APRVSettings, ards).endToPeakFlowPct;
}

export interface TutorialStep {
  title: string;
  instruction: string;
  hint: string;
  /** Returns true when the user has met the objective for this step.
   * Receives the superset of all parameters plus the active mode. Mode and
   * ventilation requirements are enforced separately by `evaluateStep`. */
  check: (settings: AllModeParams, vitals: Vitals, measured: MeasuredValues) => boolean;
  /** Brief explanation shown on completion */
  successMessage: string;
  /** Modes in which this objective is meaningful (settings read from other modes are dormant). */
  modes?: VentMode[];
  /** Objective depends on delivered breaths / gas exchange: needs fresh, complete, non-apnoeic breaths. */
  needsVentilation?: boolean;
  /** Settings patch a correct learner would apply for this step (matches the hint; used by walkthrough tests). */
  solution: Partial<AllModeParams>;
  /**
   * Valid sequential transition: a later step intentionally undoes this one
   * (e.g. "observe the problem", or "PS 0" before "add support"). Its earned
   * completion is kept. Every other step must still hold for the lesson to
   * stay complete.
   */
  transitional?: boolean;
}

export interface TutorialScenario {
  patientId: string;
  title: string;
  introduction: string;
  steps: TutorialStep[];
  summary: string;
  /** Short label for the tutorial picker tab when a patient has several. */
  tabLabel?: string;
}

export interface StepContext {
  /** Measured values come from complete breaths on the current settings revision. */
  fresh: boolean;
}

/** Evaluate a step: mode binding, fresh ventilation, then the objective itself. */
export function evaluateStep(step: TutorialStep, s: AllModeParams, v: Vitals, m: MeasuredValues, ctx: StepContext = { fresh: true }): boolean {
  if (step.modes && !step.modes.includes(s.mode)) return false;
  if (step.needsVentilation) {
    if (!ctx.fresh || m.warmingUp || isApnoeic(m)) return false;
  }
  return step.check(s, v, m);
}

/** Te ÷ Ti actually applied (whichever timing control is active, after limits). */
export const appliedE = (s: AllModeParams) => computeIE(s).eRatio;

const VOLUME_MODES: VentMode[] = ['VCV', 'PRVC', 'SIMV'];
const CONVENTIONAL: VentMode[] = ['VCV', 'PCV', 'PRVC', 'SIMV'];
const SET_RATE: VentMode[] = ['VCV', 'PCV', 'PRVC', 'SIMV'];

export const tutorials: TutorialScenario[] = [
  {
    patientId: 'healthy',
    title: 'Basics: Ventilating a Healthy Patient',
    introduction:
      'This patient has normal lung mechanics. Your goal is to achieve adequate oxygenation and ventilation with lung-protective settings. Start by understanding how each parameter affects the waveforms and vitals.',
    steps: [
      {
        title: 'Set an appropriate tidal volume',
        instruction:
          'Aim for 6–8 mL/kg predicted body weight (PBW). For PBW 70 kg, target 420–560 mL. Adjust the tidal volume control in a volume mode (VCV).',
        hint: 'Try setting TV to around 490 mL (7 mL/kg).',
        modes: VOLUME_MODES,
        check: (s) => s.tidalVolume >= 420 && s.tidalVolume <= 560,
        solution: { tidalVolume: 490 },
        successMessage: 'Good — the set tidal volume is within the lung-protective range for this patient.',
      },
      {
        title: 'Set respiratory rate',
        instruction:
          'Set the respiratory rate to achieve a minute ventilation of approximately 6–8 L/min. Watch the EtCO₂ value.',
        hint: 'A rate of 12–16 breaths/min should work well.',
        modes: SET_RATE,
        needsVentilation: true,
        check: (s, v, m) => s.respiratoryRate >= 12 && s.respiratoryRate <= 16 && m.minuteVentilation >= 5 && v.etco2 >= 30 && v.etco2 <= 48,
        solution: { respiratoryRate: 14 },
        successMessage: 'Respiratory rate and measured ventilation are appropriate — EtCO₂ is in a normal range.',
      },
      {
        title: 'Optimise PEEP and FiO₂',
        instruction:
          'Set a baseline PEEP (typically 5 cmH₂O for healthy lungs) and adjust FiO₂ to maintain SpO₂ ≥ 94%.',
        hint: 'PEEP 5, FiO₂ 0.3–0.4 should be sufficient.',
        modes: CONVENTIONAL,
        needsVentilation: true,
        check: (s, v) => s.peep >= 4 && s.peep <= 8 && v.spo2 >= 94,
        solution: { peep: 5, fio2: 0.35 },
        successMessage: 'Excellent — oxygenation is adequate with minimal FiO₂. Well done!',
      },
    ],
    summary:
      'You have successfully ventilated a healthy patient with lung-protective settings. Key takeaways: 6–8 mL/kg PBW, adequate RR for normocapnia, minimal PEEP and FiO₂.',
  },
  {
    patientId: 'healthy-spont',
    title: 'Spontaneous Breathing: Patient Effort and Pressure Support',
    tabLabel: 'Spontaneous',
    introduction:
      'This patient breathes on their own at 14/min. In PSV every breath is triggered and cycled by the patient; the ventilator only adds pressure. You will see how much of each breath is the patient’s own effort. Teaching model: trigger failures and auto-triggering are not simulated.',
    steps: [
      {
        title: 'Switch to PSV',
        instruction: 'Select PSV. There is no set rate: the patient decides when each breath starts.',
        hint: 'Tap the PSV mode tile.',
        modes: ['PSV'],
        check: () => true,
        solution: { mode: 'PSV' },
        successMessage: 'PSV is active. Breath rate now follows the patient.',
      },
      {
        title: 'Remove support: the patient still breathes',
        instruction: 'Set pressure support to 0 cmH₂O (CPAP at the set PEEP). Confirm that the patient still moves a tidal volume of at least 300 mL with their own muscles.',
        hint: 'Set PS 0 and read VT and RR.',
        modes: ['PSV'],
        needsVentilation: true,
        check: (s, _v, m) => s.pressureSupport === 0 && m.measuredTV >= 300 && m.measuredRR >= 10,
        solution: { pressureSupport: 0 },
        transitional: true, // the next step deliberately adds support again
        successMessage: 'Without support the patient’s own effort still produces a normal breath. Pressure support adds to effort; it does not create it.',
      },
      {
        title: 'Add modest support',
        instruction: 'Add 5–10 cmH₂O of pressure support and keep SpO₂ ≥ 94%. Notice that VT rises above the patient’s own volume.',
        hint: 'Try PS 5.',
        modes: ['PSV'],
        needsVentilation: true,
        check: (s, v, m) => s.pressureSupport >= 5 && s.pressureSupport <= 10 && m.measuredTV >= 450 && v.spo2 >= 94,
        solution: { pressureSupport: 5 },
        successMessage: 'Support increases each breath. Too much support can over-assist and lower CO₂.',
      },
    ],
    summary: 'Spontaneous modes add pressure to the patient’s own effort. A paralysed patient on PSV gets no breaths at all; a breathing patient still ventilates at PS 0.',
  },
  {
    patientId: 'ards',
    title: 'ARDS: Lung-Protective Ventilation',
    introduction:
      'This patient has mild ARDS with reduced compliance. The lungs are stiff and collapsed. Your goals are: protect the lung from further injury, recruit collapsed alveoli, and maintain acceptable oxygenation. Permissive hypercapnia may be necessary.',
    steps: [
      {
        title: 'Reduce tidal volume to ≤6 mL/kg',
        instruction:
          'ARDS requires strict lung-protective ventilation. In a volume mode (VCV), set TV to ≤ 420 mL for PBW 70 kg (ideally ~350 mL at 5 mL/kg). Watch the model-derived plateau pressure — it must stay below 30 cmH₂O.',
        hint: 'Set TV to 350 mL. Accept that the minute ventilation will drop.',
        modes: VOLUME_MODES,
        needsVentilation: true,
        check: (s, _v, m) => s.tidalVolume <= 420 && m.measuredTV <= 440 && m.plateauPressure < 30,
        solution: { tidalVolume: 350 },
        successMessage: 'Delivered tidal volume is protective and plateau pressure is below 30.',
      },
      {
        title: 'Increase PEEP to recruit collapsed lung',
        instruction:
          'ARDS requires higher PEEP to keep collapsed alveoli open (recruitment). Watch the lung animation — atelectasis patches should begin to clear. Target PEEP 12–16 cmH₂O. Plateau pressure rises with PEEP in these stiff lungs: if it exceeds 30 cmH₂O, reduce TV towards 4–5 mL/kg and accept a higher CO₂.',
        hint: 'Increase PEEP to 14 cmH₂O and watch the SpO₂ improve.',
        modes: CONVENTIONAL,
        check: (s) => s.peep >= 12 && s.peep <= 18,
        solution: { peep: 14 },
        successMessage: 'PEEP is in the therapeutic range. You should see recruitment occurring in the lung animation.',
      },
      {
        title: 'Adjust FiO₂ for SpO₂ 88–95%',
        instruction:
          'Adjust FiO₂ to achieve SpO₂ 88–95%. In ARDS we avoid both hypoxaemia and unnecessary hyperoxia.',
        hint: 'FiO₂ 0.6–0.8 may be needed. Aim for SpO₂ 88–95%.',
        modes: CONVENTIONAL,
        needsVentilation: true,
        check: (s, v) => s.fio2 >= 0.5 && v.spo2 >= 88 && v.spo2 <= 95,
        solution: { fio2: 0.7 },
        successMessage: 'Oxygenation is in the 88–95% target band.',
      },
      {
        title: 'Compensate with respiratory rate',
        instruction:
          'With low tidal volumes, you need a higher respiratory rate to maintain CO₂ clearance. Increase RR, but watch the flow trace for auto-PEEP.',
        hint: 'Try RR 20–26. In this teaching model an EtCO₂ up to 60 mmHg (8 kPa) is accepted; the simulator does not model pH.',
        modes: SET_RATE,
        needsVentilation: true,
        check: (s, v, m) => s.respiratoryRate >= 18 && s.respiratoryRate <= 28 && m.autoPEEP < 3 && v.etco2 > 0 && v.etco2 <= 60,
        solution: { respiratoryRate: 22 },
        successMessage: 'The higher rate is compensating for the low tidal volume without significant gas trapping.',
      },
    ],
    summary:
      'You applied an ARDSNet-style strategy: low TV (≤6 mL/kg PBW), higher PEEP for recruitment, SpO₂ 88–95% and compensatory RR. Key principle: accept higher CO₂ to protect the lungs.',
  },
  {
    patientId: 'obese',
    title: 'Morbid Obesity: Managing Basal Atelectasis',
    introduction:
      'This 140 kg patient has reduced chest wall compliance due to abdominal mass. The diaphragm is splinted upward, causing basal atelectasis. Higher PEEP and careful volume management are needed.',
    steps: [
      {
        title: 'Calculate predicted body weight tidal volume',
        instruction:
          'Use predicted body weight (PBW), not actual weight, to calculate TV. For this patient PBW is approximately 70 kg, so target 6–8 mL/kg PBW = 420–560 mL. Do NOT use the actual weight of 140 kg.',
        hint: 'Set TV to 420–500 mL based on predicted body weight.',
        modes: VOLUME_MODES,
        check: (s) => s.tidalVolume >= 380 && s.tidalVolume <= 560,
        solution: { tidalVolume: 450 },
        successMessage: 'Good — you are using predicted body weight, not actual weight. This prevents overdistension.',
      },
      {
        title: 'Apply adequate PEEP to overcome abdominal pressure',
        instruction:
          'The raised diaphragm needs higher PEEP to prevent basal collapse. Watch the lung animation — basal atelectasis should clear as PEEP increases. Target PEEP 10–14 cmH₂O.',
        hint: 'Increase PEEP to 10–12 cmH₂O. Watch the bases of the lungs.',
        modes: CONVENTIONAL,
        check: (s) => s.peep >= 8 && s.peep <= 16,
        solution: { peep: 11 },
        successMessage: 'PEEP is counteracting the abdominal pressure. Basal atelectasis should be resolving.',
      },
      {
        title: 'Optimise oxygenation',
        instruction:
          'Adjust FiO₂ to achieve SpO₂ ≥ 92%. The combination of adequate PEEP and FiO₂ should improve gas exchange.',
        hint: 'FiO₂ 0.4–0.6 with adequate PEEP should achieve the target.',
        modes: CONVENTIONAL,
        needsVentilation: true,
        check: (_s, v) => v.spo2 >= 92,
        solution: { fio2: 0.5 },
        successMessage: 'Oxygenation is adequate. The recruited basal segments are now participating in gas exchange.',
      },
    ],
    summary:
      'You managed an obese patient by using PBW-based tidal volumes and higher PEEP to overcome diaphragmatic splinting. Key takeaway: always use predicted body weight and expect higher airway pressures.',
  },
  {
    patientId: 'bronchospasm',
    title: 'Bronchospasm: Avoiding Air Trapping',
    introduction:
      'This patient has severe bronchospasm with very high airway resistance. The danger is air trapping (auto-PEEP) leading to hyperinflation, haemodynamic compromise, and cardiac compression. The key strategy is to allow adequate expiratory time.',
    steps: [
      {
        title: 'Reduce respiratory rate',
        instruction:
          'The most important intervention in bronchospasm is to allow time for expiration. Reduce the respiratory rate to 8–12 breaths/min to lengthen expiratory time.',
        hint: 'Set RR to 10. This substantially increases expiratory time.',
        modes: SET_RATE,
        check: (s) => s.respiratoryRate >= 8 && s.respiratoryRate <= 12,
        solution: { respiratoryRate: 10 },
        successMessage: 'Low respiratory rate gives more time for trapped air to escape. This is the single most important setting.',
      },
      {
        title: 'Lengthen expiration (1:3 or longer)',
        instruction:
          'Make the applied expiratory time at least three times the inspiratory time (I:E 1:3 or longer) — with the I:E control, or by shortening Ti if Ti is the active timing control. Watch the flow waveform — expiratory flow should return to zero before the next breath.',
        hint: 'Set I:E to 1:3 or 1:4 (or a shorter Ti). Check the applied I:E readout.',
        modes: SET_RATE,
        check: (s) => appliedE(s) >= 3 - 1e-6,
        solution: { ieRatio: 3, inspiratoryTime: 0 },
        successMessage: 'The extended expiratory time helps prevent gas trapping. Watch the heart — compression should reduce.',
      },
      {
        title: 'Keep PEEP low',
        instruction:
          'In this passive (paralysed) patient, extra set PEEP adds to hyperinflation. Keep PEEP at 3–5 cmH₂O.',
        hint: 'Set PEEP to 5 cmH₂O.',
        modes: CONVENTIONAL,
        check: (s) => s.peep >= 3 && s.peep <= 7,
        solution: { peep: 5 },
        successMessage: 'Low PEEP avoids adding to the already elevated intrinsic PEEP from air trapping.',
      },
      {
        title: 'Confirm air trapping is controlled',
        instruction:
          'With correct settings, intrinsic PEEP should fall below 3 cmH₂O, SpO₂ should be ≥ 88% and systolic BP ≥ 85 mmHg.',
        hint: 'If auto-PEEP persists, reduce RR further or lengthen expiration. FiO₂ 0.5 supports oxygenation meanwhile.',
        modes: CONVENTIONAL,
        needsVentilation: true,
        check: (_s, v, m) => m.autoPEEP < 3 && v.spo2 >= 88 && v.sbp >= 85,
        solution: { fio2: 0.5 },
        successMessage: 'Air trapping is controlled and haemodynamics are stable. Excellent management!',
      },
    ],
    summary:
      'You managed severe bronchospasm by prioritising expiratory time: low RR, long expiration and low PEEP, then confirmed it with measured intrinsic PEEP. Key principle: “low and slow” — allow the air to get out.',
  },
  {
    patientId: 'restrictive',
    title: 'Restrictive Disease: Small Volumes, Higher Rates',
    introduction:
      'This patient has restrictive lung disease with low compliance but normal resistance. The lungs are stiff and fibrotic. Small tidal volumes with a slightly higher rate are needed.',
    steps: [
      {
        title: 'Set small tidal volumes',
        instruction:
          'Restrictive lungs have low compliance and small total capacity. Use 5–6 mL/kg PBW. For a 65 kg patient, aim for 325–390 mL.',
        hint: 'Set TV to 350 mL.',
        modes: VOLUME_MODES,
        needsVentilation: true,
        check: (s, _v, m) => s.tidalVolume >= 300 && s.tidalVolume <= 420 && m.plateauPressure < 30,
        solution: { tidalVolume: 350 },
        successMessage: 'Tidal volume is appropriate for the stiff lungs. Plateau pressure is controlled.',
      },
      {
        title: 'Increase respiratory rate to compensate',
        instruction:
          'With smaller tidal volumes, increase RR to maintain minute ventilation. Target RR 18–22.',
        hint: 'Set RR to 20.',
        modes: SET_RATE,
        check: (s) => s.respiratoryRate >= 16 && s.respiratoryRate <= 24,
        solution: { respiratoryRate: 20 },
        successMessage: 'The higher rate compensates for the reduced tidal volume.',
      },
      {
        title: 'Optimise oxygenation',
        instruction:
          'Apply moderate PEEP (5–8 cmH₂O) and adjust FiO₂ to achieve SpO₂ ≥ 92%.',
        hint: 'PEEP 6, FiO₂ 0.4–0.5.',
        modes: CONVENTIONAL,
        needsVentilation: true,
        check: (_s, v) => v.spo2 >= 92,
        solution: { peep: 6, fio2: 0.5 },
        successMessage: 'Oxygenation is adequate. Well managed!',
      },
    ],
    summary:
      'You ventilated a restrictive patient with small volumes and higher rates. Key takeaway: the stiff lungs need low volumes to avoid barotrauma, compensated by higher rates.',
  },
  {
    patientId: 'spontaneous',
    title: 'Weaning: Supporting Spontaneous Breathing',
    introduction:
      'This patient is breathing spontaneously but inadequately — low rate and low tidal volumes. Your goal is to provide appropriate pressure support to augment their efforts without over-assisting.',
    steps: [
      {
        title: 'Switch to PSV mode',
        instruction:
          'Pressure Support Ventilation (PSV) is commonly used for spontaneously breathing patients. Switch the ventilator mode to PSV.',
        hint: 'Change the mode selector to PSV.',
        modes: ['PSV'],
        check: () => true,
        solution: { mode: 'PSV' },
        successMessage: 'PSV mode lets the patient trigger and control each breath while you provide pressure support.',
      },
      {
        title: 'Set appropriate pressure support',
        instruction:
          'Adjust pressure support so the delivered tidal volume is 5–8 mL/kg PBW (350–560 mL). Start at 8–10 cmH₂O and titrate to the measured VT.',
        hint: 'Set PS 8–10 cmH₂O and watch the delivered tidal volume.',
        modes: ['PSV'],
        needsVentilation: true,
        check: (s, _v, m) => s.pressureSupport >= 4 && s.pressureSupport <= 16 && m.measuredTV >= 350 && m.measuredTV <= 560,
        solution: { pressureSupport: 10 },
        successMessage: 'Pressure support is augmenting the patient’s breaths to a normal tidal volume.',
      },
      {
        title: 'Ensure adequate oxygenation and ventilation',
        instruction:
          'Adjust PEEP and FiO₂ to maintain SpO₂ ≥ 92% and EtCO₂ ≤ 55 mmHg. With a slow patient rate, CO₂ may still be raised.',
        hint: 'PEEP 5, FiO₂ 0.4–0.5. If CO₂ stays high, a little more support raises VT.',
        modes: ['PSV'],
        needsVentilation: true,
        check: (_s, v) => v.spo2 >= 92 && v.etco2 > 0 && v.etco2 <= 55,
        solution: { peep: 5, fio2: 0.45, pressureSupport: 12 },
        successMessage: 'The patient is breathing comfortably with good gas exchange. This is a good starting point for weaning assessment.',
      },
    ],
    summary:
      'You supported a spontaneously breathing patient with PSV, titrating support to the measured tidal volume. Key principle: support, don’t suppress the patient’s own respiratory drive.',
  },
  {
    patientId: 'ards',
    title: 'APRV: Airway Pressure Release Ventilation for ARDS',
    introduction:
      'This ARDS patient has diffuse atelectasis and hypoxaemia. APRV holds a sustained high pressure (P High) with brief releases (T Low) for CO₂ clearance. Trade-offs: higher mean airway pressure can help recruitable lungs but adds intrinsic PEEP, may reduce venous return, and offers no benefit in obstructive disease. Teaching model: spontaneous breathing during P High is not simulated.',
    steps: [
      {
        title: 'Switch to APRV mode',
        instruction:
          'APRV is a pressure-based mode that maintains a high continuous pressure with intermittent brief releases. Switch the ventilator mode to APRV.',
        hint: 'Select APRV from the mode selector.',
        modes: ['APRV'],
        check: () => true,
        solution: { mode: 'APRV' },
        successMessage: 'APRV mode is active. You now control P High, P Low, T High, and T Low.',
      },
      {
        title: 'Set P High for recruitment',
        instruction:
          'P High is the sustained inflation pressure. For this case, choose 25–30 cmH₂O — enough to exceed its modelled opening pressure while staying well below 35 cmH₂O.',
        hint: 'Try P High 28 cmH₂O.',
        modes: ['APRV'],
        check: (s) => s.pHigh >= 25 && s.pHigh <= 35,
        solution: { pHigh: 28 },
        successMessage: 'P High is in the target range for this case.',
      },
      {
        title: 'Set P Low',
        instruction:
          'P Low is commonly set to 0 cmH₂O; the short release keeps end-release lung volume (intrinsic PEEP) above zero, so P Low is not the true end-expiratory pressure.',
        hint: 'Set P Low to 0 cmH₂O.',
        modes: ['APRV'],
        check: (s) => s.pLow <= 2 && s.pHigh > s.pLow,
        solution: { pLow: 0 },
        successMessage: 'P Low 0 with a short release maximises the release gradient while intrinsic PEEP limits derecruitment.',
      },
      {
        title: 'Set T High for sustained recruitment',
        instruction:
          'T High is the time at P High. Longer times (4–6 s) raise mean airway pressure but cut the release rate, so CO₂ clearance falls. Watch EtCO₂ as you change it.',
        hint: 'Set T High to 4–5 seconds.',
        modes: ['APRV'],
        check: (s) => s.tHigh >= 4 && s.tHigh <= 6,
        solution: { tHigh: 4.5 },
        successMessage: 'T High balances recruitment time against release frequency.',
      },
      {
        title: 'Set T Low from the expiratory flow trace',
        instruction:
          'Rather than a fixed number, set T Low from this patient’s release flow: end the release when expiratory flow has fallen to about 50–75% of its peak (the “end-release flow” readout). Too short limits CO₂ clearance; too long lets the lung derecruit.',
        hint: 'For this lung, T Low about 0.2 s ends the release near 60% of peak flow.',
        modes: ['APRV'],
        check: (s) => { const pct = ardsEndReleasePct(s); return pct >= 50 && pct <= 75; },
        solution: { tLow: 0.2 },
        successMessage: 'T Low is matched to this lung’s time constant, as shown on the flow waveform.',
      },
      {
        title: 'Adjust FiO₂ and confirm gas exchange',
        instruction:
          'Adjust FiO₂ to achieve SpO₂ 88–95% and confirm that the releases still clear CO₂ (EtCO₂ reading present and ≤ 60 mmHg). Compare with your conventional settings: the response depends on the case.',
        hint: 'Try FiO₂ 0.7–0.8. Watch the recruitment progress bar, SpO₂ and EtCO₂.',
        modes: ['APRV'],
        needsVentilation: true,
        check: (_s, v) => v.spo2 >= 88 && v.spo2 <= 95 && v.etco2 > 0 && v.etco2 <= 60,
        solution: { fio2: 0.8 },
        successMessage: 'Oxygenation and CO₂ clearance are acceptable on APRV for this case.',
      },
    ],
    summary:
      'You applied APRV to an ARDS patient: P High 25–30 cmH₂O, P Low 0, T High 4–6 s, and T Low set from the release flow (about 50–75% of peak for this lung). APRV raises mean airway pressure; its benefits and risks are case-specific and it should be avoided in severe airflow obstruction.',
  },
  {
    patientId: 'ards',
    tabLabel: 'ARDSNet',
    title: 'ARDSNet Protocol: Keeping Plateau Pressure Under 30',
    introduction:
      'This patient has mild ARDS (compliance 40 mL/cmH₂O, predicted body weight 70 kg). You will apply a teaching subset of the ARDSNet low tidal volume protocol. Key relationship: plateau pressure ≈ total PEEP + tidal volume ÷ compliance. Both PEEP and tidal volume push plateau up. The plateau shown here is model-derived (as an inspiratory hold would read).',
    steps: [
      {
        title: 'Use volume control (VCV)',
        instruction:
          'ARDSNet was carried out using volume-assist control. Select VCV so you set the tidal volume directly and can read plateau pressure from the lung model.',
        hint: 'Choose VCV from the mode selector.',
        modes: ['VCV'],
        check: () => true,
        solution: { mode: 'VCV' },
        successMessage: 'VCV is active. Tidal volume is now fixed, so plateau pressure tells you how stiff the lung is.',
      },
      {
        title: 'Set tidal volume to 6 mL/kg PBW',
        instruction:
          'ARDSNet starts at 8 mL/kg predicted body weight and reduces to 6 mL/kg. Always use predicted (not actual) body weight. For PBW 70 kg, 6 mL/kg is 420 mL.',
        hint: 'Set tidal volume to 420 mL (accepted range 400–440 mL).',
        modes: ['VCV'],
        check: (s) => s.tidalVolume >= 400 && s.tidalVolume <= 440,
        solution: { tidalVolume: 420 },
        successMessage: 'Tidal volume is 6 mL/kg PBW. At this compliance each breath adds about 10–11 cmH₂O above PEEP.',
      },
      {
        title: 'Raise respiratory rate to keep minute ventilation',
        instruction:
          'The smaller breaths lower minute ventilation. Increase the rate (ARDSNet maximum 35/min). Watch the flow trace: expiratory flow should return to zero before the next breath, or gas becomes trapped.',
        hint: 'Set RR 20–30/min.',
        modes: ['VCV'],
        needsVentilation: true,
        check: (s, _v, m) => s.respiratoryRate >= 20 && s.respiratoryRate <= 35 && m.measuredRR >= 19,
        solution: { respiratoryRate: 24 },
        successMessage: 'Rate is compensating for the smaller breaths.',
      },
      {
        title: 'Pair PEEP with FiO₂ (lower PEEP table, subset)',
        instruction:
          'ARDSNet links PEEP to FiO₂ (teaching subset of the lower PEEP/FiO₂ table): 0.4 → 5–8, 0.5 → 8–10, 0.6 → 10, 0.7 → 10–14, 0.8 → 14, 0.9 → 14–18, 1.0 → 18–24. Choose a matching pair that gives SpO₂ 88–95%. As you raise PEEP, watch plateau pressure climb by the same amount.',
        hint: 'Try FiO₂ 0.8 with PEEP 14.',
        modes: ['VCV'],
        needsVentilation: true,
        check: (s, v) => {
          const f = Math.round(s.fio2 * 10) / 10;
          const table: Record<string, [number, number]> = {
            '0.4': [5, 8], '0.5': [8, 10], '0.6': [10, 10], '0.7': [10, 14],
            '0.8': [14, 14], '0.9': [14, 18], '1': [18, 24],
          };
          const r = table[String(f)];
          return !!r && s.peep >= r[0] && s.peep <= r[1] && v.spo2 >= 88 && v.spo2 <= 95;
        },
        solution: { fio2: 0.8, peep: 14 },
        successMessage: 'PEEP and FiO₂ match the table and oxygenation is in the 88–95% target band.',
      },
      {
        title: 'Check plateau pressure ≤ 30 cmH₂O',
        instruction:
          'Read the plateau pressure. With PEEP 14 and 420 mL it should be about 24–25 cmH₂O (14 + 420 ÷ 40). If plateau is above 30, ARDSNet reduces tidal volume in 1 mL/kg steps, down to 4 mL/kg (280 mL). Additional teaching goal (not an ARDSNet rule): driving pressure = plateau − total PEEP (set PEEP + intrinsic PEEP) ≤ 15.',
        hint: 'If plateau is over 30, lower TV towards 350 mL (5 mL/kg) or 280 mL (4 mL/kg).',
        modes: ['VCV'],
        needsVentilation: true,
        check: (s, _v, m) =>
          s.tidalVolume >= 280 && s.tidalVolume <= 440 &&
          m.plateauPressure <= 30 && m.plateauPressure - (s.peep + m.autoPEEP) <= 15,
        solution: {},
        successMessage: 'Plateau ≤ 30 and driving pressure ≤ 15. The lung is protected from overdistension.',
      },
      {
        title: 'Accept permissive hypercapnia',
        instruction:
          'Low tidal volume often raises CO₂. ARDSNet targets arterial pH 7.30–7.45 and raises the rate (up to 35) for acidaemia. This simulator does not model pH or measure PaCO₂, so an EtCO₂ threshold cannot verify either; here we use EtCO₂ ≤ 60 mmHg as a teaching proxy. Never raise tidal volume if that pushes plateau above 30.',
        hint: 'Keep EtCO₂ ≤ 60 mmHg (8 kPa) with plateau still ≤ 30.',
        modes: ['VCV'],
        needsVentilation: true,
        check: (s, v, m) => v.etco2 > 0 && v.etco2 <= 60 && m.plateauPressure <= 30 && s.tidalVolume <= 440,
        solution: {},
        successMessage: 'CO₂ is acceptable on this proxy and plateau is still protective. You have completed the teaching subset of the protocol.',
      },
    ],
    summary:
      'ARDSNet in brief (teaching subset): VCV, tidal volume 6 mL/kg PBW (4–8), rate up to 35, PEEP paired with FiO₂ from the table, SpO₂ 88–95%, plateau ≤ 30 cmH₂O, pH 7.30–7.45 (not modelled here). Plateau ≈ total PEEP + VT ÷ compliance, so when PEEP rises, tidal volume must sometimes fall.',
  },
  {
    patientId: 'copd',
    title: 'COPD: Beating Air Trapping',
    introduction:
      'Emphysema makes the lungs floppy and the airways narrow, so breathing out takes a long time. If the next breath arrives too soon, air is trapped (auto-PEEP), which lowers blood pressure and raises the risk of barotrauma.',
    steps: [
      {
        title: 'Use a moderate tidal volume',
        instruction: 'Use 6–8 mL/kg PBW in a volume mode. For a predicted weight of 70 kg, that is 420–560 mL.',
        hint: 'Set TV to about 420–480 mL.',
        modes: VOLUME_MODES,
        check: (s) => s.tidalVolume >= 400 && s.tidalVolume <= 560,
        solution: { tidalVolume: 450 },
        successMessage: 'A moderate volume limits hyperinflation.',
      },
      {
        title: 'Lengthen expiration',
        instruction: 'Lower the rate to 10–14 and make the applied expiration at least three times inspiration (I:E 1:3 or longer, or a shorter Ti). Watch the expiratory flow trace reach zero before the next breath.',
        hint: 'Try RR 12 with I:E 1:4.',
        modes: SET_RATE,
        check: (s) => s.respiratoryRate <= 14 && appliedE(s) >= 3 - 1e-6,
        solution: { respiratoryRate: 12, ieRatio: 4, inspiratoryTime: 0 },
        successMessage: 'More time to exhale lets the lungs empty.',
      },
      {
        title: 'Clear the auto-PEEP, SpO₂ 88–92%',
        instruction: 'Bring the measured auto-PEEP below 2 cmH₂O while keeping SpO₂ 88–92% (avoid excess oxygen in a CO₂ retainer). A raised CO₂ is acceptable.',
        hint: 'If auto-PEEP persists, lower the rate further. Use a modest FiO₂ (about 0.3).',
        modes: CONVENTIONAL,
        needsVentilation: true,
        check: (_s, v, m) => m.autoPEEP < 2 && v.spo2 >= 88 && v.spo2 <= 92,
        solution: { fio2: 0.3 },
        successMessage: 'The trapped air is gone and oxygenation is in the 88–92% target band.',
      },
    ],
    summary: 'COPD: moderate volume, slow rate, long expiration, target SpO₂ 88–92% and accept a higher CO₂. Always check that expiratory flow returns to zero.',
  },
  {
    patientId: 'asthma',
    title: 'Acute Asthma: Avoiding Breath Stacking',
    introduction:
      'In severe asthma, the narrowed airways cause a big gap between peak and plateau pressure, and the breath out is slow. The main danger is breath stacking, which causes hyperinflation and a fall in blood pressure.',
    steps: [
      {
        title: 'Set a slow rate',
        instruction: 'Reduce the rate to 8–12 breaths/min.',
        hint: 'Set RR 10.',
        modes: SET_RATE,
        check: (s) => s.respiratoryRate >= 8 && s.respiratoryRate <= 12,
        solution: { respiratoryRate: 10 },
        successMessage: 'Fewer breaths leave more time to breathe out.',
      },
      {
        title: 'Extend expiratory time',
        instruction: 'Make the applied expiration at least four times inspiration: set I:E to 1:4 or longer, or shorten Ti with the Ti control (a shorter Ti in VCV means a faster inspiratory flow).',
        hint: 'Set I:E 1:4, or Ti about 1.0 s at RR 10.',
        modes: SET_RATE,
        check: (s) => appliedE(s) >= 4 - 1e-6,
        solution: { ieRatio: 4, inspiratoryTime: 0 },
        successMessage: 'A long expiration lets the lungs empty more fully.',
      },
      {
        title: 'Keep plateau safe',
        instruction: 'Keep the model-derived plateau below 30 cmH₂O and the measured auto-PEEP below 3 cmH₂O. Accept a raised CO₂ (permissive hypercapnia).',
        hint: 'Lower TV towards 6 mL/kg (360 mL) if plateau is high.',
        modes: CONVENTIONAL,
        needsVentilation: true,
        check: (_s, _v, m) => m.plateauPressure < 30 && m.autoPEEP < 3,
        solution: { tidalVolume: 400 },
        successMessage: 'Hyperinflation is controlled.',
      },
    ],
    summary: 'Asthma: slow rate, long expiration, modest volume and accept a raised CO₂. A high peak pressure with a normal plateau reflects airway resistance, not stiff lungs.',
  },
  {
    patientId: 'sepsis',
    title: 'Septic Shock: Ventilating Without Crashing the BP',
    introduction:
      'This patient has pneumonia and septic shock. Positive pressure reduces venous return, so high PEEP or air trapping will drop an already low blood pressure. Sepsis also produces a lot of CO₂, so a higher minute ventilation is needed.',
    steps: [
      {
        title: 'Protective tidal volume',
        instruction: 'Set 6 mL/kg PBW in a volume mode. For a predicted weight of 73 kg, that is about 440 mL (range 400–480).',
        hint: 'Set TV 440 mL.',
        modes: VOLUME_MODES,
        check: (s) => s.tidalVolume >= 400 && s.tidalVolume <= 480,
        solution: { tidalVolume: 440 },
        successMessage: 'Lung-protective volume is set.',
      },
      {
        title: 'Raise minute ventilation',
        instruction: 'Increase the rate to 20–26 so that measured minute ventilation is at least 9 L/min.',
        hint: 'Try RR 22.',
        modes: SET_RATE,
        needsVentilation: true,
        check: (s, _v, m) => s.respiratoryRate >= 20 && s.respiratoryRate <= 26 && m.minuteVentilation >= 9,
        solution: { respiratoryRate: 22 },
        successMessage: 'The extra CO₂ load is cleared.',
      },
      {
        title: 'Moderate PEEP, adequate oxygen',
        instruction: 'Use PEEP 6–10 with enough FiO₂ to keep SpO₂ ≥ 92%, while keeping systolic BP above 80. Avoid high PEEP in shock.',
        hint: 'PEEP 8 with FiO₂ 0.6.',
        modes: CONVENTIONAL,
        needsVentilation: true,
        check: (s, v) => s.peep >= 6 && s.peep <= 10 && v.spo2 >= 92 && v.sbp >= 80,
        solution: { peep: 8, fio2: 0.6 },
        successMessage: 'Oxygenation is adequate without worsening the shock.',
      },
    ],
    summary: 'In shock, the ventilator affects the circulation: use moderate PEEP, avoid auto-PEEP and match minute ventilation to the high CO₂ production.',
  },
  {
    patientId: 'paediatric',
    title: 'Paediatrics: Small Lungs, Small Breaths',
    introduction:
      'A 20 kg child with bronchiolitis has small, stiff lungs and narrow airways. The case starts on weight-based VCV, but the PCV inspiratory pressure has deliberately been left at an adult 15 cmH₂O. Pressure control is common in children. Teaching model — have a paediatric clinician review local targets.',
    steps: [
      {
        title: 'Switch to pressure control',
        instruction: 'Select PCV mode.',
        hint: 'Tap the PCV mode tile.',
        modes: ['PCV'],
        check: () => true,
        solution: { mode: 'PCV' },
        successMessage: 'PCV limits peak pressure in small airways.',
      },
      {
        title: 'Age-appropriate rate and PEEP',
        instruction: 'Set the rate to 20–30 and PEEP to 5–8 before titrating pressure — both change the delivered volume.',
        hint: 'RR 24, PEEP 6.',
        modes: ['PCV'],
        check: (s) => s.respiratoryRate >= 20 && s.respiratoryRate <= 30 && s.peep >= 5 && s.peep <= 8,
        solution: { respiratoryRate: 24, peep: 6 },
        successMessage: 'Rate and PEEP suit the child.',
      },
      {
        title: 'Titrate Pinsp to 6–8 mL/kg',
        instruction: 'Adjust Pinsp so that the measured tidal volume is 120–160 mL, keeping SpO₂ ≥ 92%. Coach from the measured VT, not the set pressure.',
        hint: 'Lower Pinsp to about 10–12 cmH₂O at RR 24, PEEP 6.',
        modes: ['PCV'],
        needsVentilation: true,
        check: (_s, v, m) => m.measuredTV >= 120 && m.measuredTV <= 160 && v.spo2 >= 92,
        solution: { pInsp: 11, fio2: 0.4 },
        successMessage: 'The tidal volume is appropriate for the child’s size.',
      },
    ],
    summary: 'Children: scale everything by weight. Use 6–8 mL/kg, a faster rate and pressure control, and watch the actual delivered volume rather than the set pressure.',
  },

  {
    patientId: 'autotrigger',
    title: 'Auto-triggering: Breaths the Patient Did Not Ask For',
    introduction:
      'After cardiac surgery this patient breathes about 10/min, but strong cardiogenic oscillations (±3 L/min) reach the airway. The flow trigger is set very sensitive (1 L/min), so heartbeats can trigger the ventilator. Look at the flow trace: small ripples at the heart rate, and breaths starting without the patient’s effort dip.',
    steps: [
      {
        title: 'Recognise auto-triggering',
        instruction: 'Compare the measured ventilator rate with the patient’s own effort rate (Clinical panel). Auto-triggering shows as a ventilator rate well above the patient’s rate, with breaths starting on cardiac ripples and a falling EtCO₂.',
        hint: 'Leave the settings and watch: the rate is around 30/min while the patient makes only ~10 efforts/min.',
        modes: ['PSV'],
        needsVentilation: true,
        check: (_s, _v, m) => (m.autoTriggers ?? 0) >= 5 && m.measuredRR >= (m.effortRate ?? 0) + 5,
        solution: {},
        transitional: true, // the next step fixes the problem
        successMessage: 'Correct: most breaths are triggered by cardiac oscillation, not by the patient.',
      },
      {
        title: 'Make the trigger less sensitive',
        instruction: 'Raise the flow trigger above the ~3 L/min cardiogenic oscillation, but not so high that genuine efforts are missed. The ventilator rate should fall to the patient’s own rate.',
        hint: 'Set Trigger to 4 L/min.',
        modes: ['PSV'],
        needsVentilation: true,
        check: (s, _v, m) => s.triggerSens > 3 && s.triggerSens <= 6 && (m.autoTriggers ?? 0) < 1 && (m.missedTriggers ?? 0) < 1 && Math.abs(m.measuredRR - (m.effortRate ?? 0)) <= 2,
        solution: { triggerSens: 4 },
        successMessage: 'Every breath is now patient-triggered.',
      },
      {
        title: 'Match support to the patient',
        instruction: 'With auto-triggering gone, the patient’s own breaths plus 8 cmH₂O support may over-ventilate. Adjust PS so EtCO₂ (with a plateau) is 32–48 mmHg and SpO₂ ≥ 94%.',
        hint: 'Lower PS to about 5 cmH₂O.',
        modes: ['PSV'],
        needsVentilation: true,
        check: (s, v) => s.pressureSupport >= 3 && s.pressureSupport <= 8 && v.etco2Status === 'plateau' && v.etco2 >= 32 && v.etco2 <= 48 && v.spo2 >= 94,
        solution: { pressureSupport: 5 },
        successMessage: 'Ventilation now follows the patient’s drive.',
      },
    ],
    summary: 'Auto-triggering: ventilator rate > patient effort rate, breaths without an effort dip, falling CO₂. Causes include cardiogenic oscillation and circuit leaks. Fix: make the trigger less sensitive (and fix leaks), then re-titrate support. Teaching model: leaks are not simulated.',
  },
  {
    patientId: 'copd-spont',
    title: 'Missed Triggering: Efforts Lost to Intrinsic PEEP',
    introduction:
      'This COPD patient makes weak efforts 22 times a minute. Long, generously supported breaths (PS 10, ETS 5%) leave too little time to exhale, so intrinsic PEEP builds up. Each effort must first overcome it before flow can reach the trigger — many fail. On the flow trace, a failed effort is a small notch in expiratory flow with no breath following.',
    steps: [
      {
        title: 'Recognise missed triggers',
        instruction: 'Compare the patient’s effort rate with the ventilator rate and look for notches in expiratory flow. Check intrinsic PEEP.',
        hint: 'Leave the settings: the patient makes ~22 efforts/min but only about half trigger.',
        modes: ['PSV'],
        needsVentilation: true,
        check: (_s, _v, m) => (m.missedTriggers ?? 0) >= 5 && m.autoPEEP >= 1.5,
        solution: {},
        transitional: true, // the next step removes the missed triggers
        successMessage: 'Correct: efforts are being missed because of intrinsic PEEP.',
      },
      {
        title: 'Shorten the supported breath',
        instruction: 'Raise ETS so each supported breath cycles off earlier, leaving more time to exhale. Every effort should then trigger.',
        hint: 'Set ETS to 40%.',
        modes: ['PSV'],
        needsVentilation: true,
        check: (s, _v, m) => s.ets >= 30 && (m.missedTriggers ?? 0) < 1 && m.measuredRR >= (m.effortRate ?? 0) - 2,
        solution: { ets: 40 },
        successMessage: 'The patient’s efforts now all trigger a breath.',
      },
      {
        title: 'Check volume and trapping',
        instruction: 'Keep PS 6–12 cmH₂O with measured VT 300–560 mL and intrinsic PEEP below 5 cmH₂O. (Clinically, external PEEP can also counterbalance flow-limited intrinsic PEEP; that waterfall effect is not simulated here.)',
        hint: 'PS 10 with ETS 40% should already satisfy this.',
        modes: ['PSV'],
        needsVentilation: true,
        check: (s, _v, m) => s.pressureSupport >= 6 && s.pressureSupport <= 12 && m.measuredTV >= 300 && m.measuredTV <= 560 && m.autoPEEP < 5,
        solution: {},
        successMessage: 'Synchrony restored without excessive volume.',
      },
    ],
    summary: 'Missed triggering: patient effort rate > ventilator rate, expiratory flow notches, intrinsic PEEP. Over-assistance (high PS, low ETS) lengthens breaths and traps gas. Fix: shorten/smaller supported breaths (raise ETS, lower PS); consider external PEEP for flow-limited COPD.',
  },
  {
    patientId: 'pressure-limited',
    title: 'Pressure-limited Ventilation: The Breath That Never Arrives',
    introduction:
      'This paralysed asthmatic is on VCV 450 mL with Ti 0.5 s. That needs a high inspiratory flow, and through narrow airways most of the peak pressure is resistive. Peak pressure hits the 40 cmH₂O high-pressure limit, the ventilator terminates the breath, and the set volume is never delivered.',
    steps: [
      {
        title: 'Recognise pressure limiting',
        instruction: 'Look at the pressure trace (flat-topped at the limit), the high-pressure alarm, and compare measured VTe with the set VT.',
        hint: 'Leave the settings: VTe is about 330 mL against 450 mL set.',
        modes: ['VCV'],
        needsVentilation: true,
        check: (s, _v, m) => (m.pressureLimited ?? 0) > 0 && m.measuredTV < 0.85 * s.tidalVolume,
        solution: {},
        transitional: true, // fixed by the following steps
        successMessage: 'Correct: every breath is cut off at the pressure limit.',
      },
      {
        title: 'Slow the rate',
        instruction: 'Reduce the rate to 8–12/min. This gives time for a longer inspiration and a long expiration.',
        hint: 'Set RR 10.',
        modes: ['VCV'],
        check: (s) => s.respiratoryRate >= 8 && s.respiratoryRate <= 12,
        solution: { respiratoryRate: 10 },
        successMessage: 'There is now time for a slower inspiration.',
      },
      {
        title: 'Lower inspiratory flow, not the safety limit',
        instruction: 'Lengthen Ti (lower flow ⇒ lower resistive pressure) until breaths are no longer terminated and VTe is ≥ 90% of set — keep the high-pressure limit at 40 cmH₂O or below.',
        hint: 'Set Ti to about 1.2 s (I:E about 1:4 at RR 10).',
        modes: ['VCV'],
        needsVentilation: true,
        check: (s, _v, m) => s.pLimit <= 40 && (m.pressureLimited ?? 0) === 0 && m.measuredTV >= 0.9 * s.tidalVolume,
        solution: { inspiratoryTime: 1.2 },
        successMessage: 'The full volume is delivered below the limit.',
      },
      {
        title: 'Confirm safety',
        instruction: 'Check the model-derived plateau is below 30 cmH₂O and intrinsic PEEP below 3 cmH₂O.',
        hint: 'These should already be satisfied at RR 10, Ti 1.2 s.',
        modes: ['VCV'],
        needsVentilation: true,
        check: (_s, _v, m) => m.plateauPressure < 30 && m.autoPEEP < 3,
        solution: {},
        successMessage: 'High peak, normal plateau: resistance, not stiff lungs.',
      },
    ],
    summary: 'Pressure-limited ventilation: when a volume breath reaches the high-pressure limit it is terminated and VT falls. In obstruction the peak is mostly resistive — slow the inspiratory flow and the rate rather than raising the limit.',
  },
];

export function getTutorialForPatient(patientId: string): TutorialScenario | undefined {
  return tutorials.find(t => t.patientId === patientId);
}

/** All tutorials for a patient (e.g. ARDS has both a conventional and an APRV tutorial). */
export function getTutorialsForPatient(patientId: string): TutorialScenario[] {
  return tutorials.filter(t => t.patientId === patientId);
}
