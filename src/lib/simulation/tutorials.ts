import { AllModeParams, Vitals, MeasuredValues } from './types';

export interface TutorialStep {
  title: string;
  instruction: string;
  hint: string;
  /** Returns true when the user has met the objective for this step.
   * Receives the superset of all parameters plus the active mode so checks can
   * read across modes without narrowing gymnastics. */
  check: (settings: AllModeParams, vitals: Vitals, measured: MeasuredValues) => boolean;
  /** Brief explanation shown on completion */
  successMessage: string;
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
          'Aim for 6–8 mL/kg ideal body weight. For a 70 kg patient, target 420–560 mL. Adjust the tidal volume control.',
        hint: 'Try setting TV to around 490 mL (7 mL/kg).',
        check: (s) => s.tidalVolume >= 420 && s.tidalVolume <= 560,
        successMessage: 'Good — tidal volume is within the lung-protective range for this patient.',
      },
      {
        title: 'Set respiratory rate',
        instruction:
          'Set the respiratory rate to achieve a minute ventilation of approximately 6–8 L/min. Watch the EtCO₂ value.',
        hint: 'A rate of 12–16 breaths/min should work well.',
        check: (s, v) => s.respiratoryRate >= 12 && s.respiratoryRate <= 16 && v.etco2 >= 30 && v.etco2 <= 48,
        successMessage: 'Respiratory rate and ventilation are appropriate — EtCO₂ is in a normal range.',
      },
      {
        title: 'Optimise PEEP and FiO₂',
        instruction:
          'Set a baseline PEEP (typically 5 cmH₂O for healthy lungs) and adjust FiO₂ to maintain SpO₂ ≥ 94%.',
        hint: 'PEEP 5, FiO₂ 0.3–0.4 should be sufficient.',
        check: (s, v) => s.peep >= 4 && s.peep <= 8 && v.spo2 >= 94,
        successMessage: 'Excellent — oxygenation is adequate with minimal FiO₂. Well done!',
      },
    ],
    summary:
      'You have successfully ventilated a healthy patient with lung-protective settings. Key takeaways: 6–8 mL/kg TV, adequate RR for normocapnia, minimal PEEP and FiO₂.',
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
          'ARDS requires strict lung-protective ventilation. For a 70 kg patient, set TV to ≤ 420 mL (ideally ~350 mL at 5 mL/kg). Watch the plateau pressure — it must stay below 30 cmH₂O.',
        hint: 'Set TV to 350 mL. Accept that the minute ventilation will drop.',
        check: (s, _v, m) => s.tidalVolume <= 420 && m.plateauPressure < 30,
        successMessage: 'Tidal volume is protective and plateau pressure is below 30. The lungs are being protected from volutrauma.',
      },
      {
        title: 'Increase PEEP to recruit collapsed lung',
        instruction:
          'ARDS requires higher PEEP to keep collapsed alveoli open (recruitment). Watch the lung animation — atelectasis patches should begin to clear. Target PEEP 12–16 cmH₂O. Note that plateau pressure rises with PEEP in these stiff lungs: if it exceeds 30 cmH₂O, reduce TV towards 4–5 mL/kg and accept a higher CO₂.',
        hint: 'Increase PEEP to 14 cmH₂O and watch the SpO₂ improve.',
        check: (s) => s.peep >= 12 && s.peep <= 18,
        successMessage: 'PEEP is in the therapeutic range. You should see recruitment occurring in the lung animation.',
      },
      {
        title: 'Increase FiO₂ for adequate oxygenation',
        instruction:
          'With recruited lungs, adjust FiO₂ to achieve SpO₂ ≥ 88%. In severe ARDS, we accept lower SpO₂ targets to avoid oxygen toxicity.',
        hint: 'FiO₂ 0.6–0.8 may be needed. Aim for SpO₂ 88–95%.',
        check: (s, v) => s.fio2 >= 0.5 && v.spo2 >= 88,
        successMessage: 'Oxygenation is acceptable. Remember: in ARDS we accept SpO₂ 88–95% to minimise ventilator-induced lung injury.',
      },
      {
        title: 'Compensate with respiratory rate',
        instruction:
          'With low tidal volumes, you need a higher respiratory rate to maintain adequate CO₂ clearance. Increase RR, but watch for auto-PEEP.',
        hint: 'Try RR 20–26. Permissive hypercapnia (EtCO₂ up to 60 mmHg) is acceptable.',
        check: (s) => s.respiratoryRate >= 18 && s.respiratoryRate <= 28,
        successMessage: 'Respiratory rate is compensating for the low tidal volume. Permissive hypercapnia is an accepted strategy in ARDS.',
      },
    ],
    summary:
      'You have applied an ARDSNet-style ventilation strategy: low TV (≤6 mL/kg), high PEEP for recruitment, adequate FiO₂, and compensatory RR. Key principle: accept higher CO₂ to protect the lungs.',
  },
  {
    patientId: 'obese',
    title: 'Morbid Obesity: Managing Basal Atelectasis',
    introduction:
      'This 140 kg patient has reduced chest wall compliance due to abdominal mass. The diaphragm is splinted upward, causing basal atelectasis. Higher PEEP and careful volume management are needed.',
    steps: [
      {
        title: 'Calculate ideal body weight tidal volume',
        instruction:
          'Use ideal body weight (not actual weight) to calculate TV. For this patient, IBW is approximately 70 kg, so target 6–8 mL/kg IBW = 420–560 mL. Do NOT use actual weight of 140 kg.',
        hint: 'Set TV to 420–500 mL based on ideal body weight.',
        check: (s) => s.tidalVolume >= 380 && s.tidalVolume <= 560,
        successMessage: 'Good — you are using ideal body weight, not actual weight. This prevents overdistension.',
      },
      {
        title: 'Apply adequate PEEP to overcome abdominal pressure',
        instruction:
          'The raised diaphragm needs higher PEEP to prevent basal collapse. Watch the lung animation — basal atelectasis should clear as PEEP increases. Target PEEP 10–14 cmH₂O.',
        hint: 'Increase PEEP to 10–12 cmH₂O. Watch the bases of the lungs.',
        check: (s) => s.peep >= 8 && s.peep <= 16,
        successMessage: 'PEEP is counteracting the abdominal pressure. Basal atelectasis should be resolving.',
      },
      {
        title: 'Optimise oxygenation',
        instruction:
          'Adjust FiO₂ to achieve SpO₂ ≥ 92%. The combination of adequate PEEP and FiO₂ should improve gas exchange.',
        hint: 'FiO₂ 0.4–0.6 with adequate PEEP should achieve the target.',
        check: (_s, v) => v.spo2 >= 92,
        successMessage: 'Oxygenation is adequate. The recruited basal segments are now participating in gas exchange.',
      },
    ],
    summary:
      'You have managed an obese patient by using IBW-based tidal volumes and higher PEEP to overcome diaphragmatic splinting. Key takeaway: always use ideal body weight and expect higher airway pressures.',
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
        hint: 'Set RR to 10. This dramatically increases expiratory time.',
        check: (s) => s.respiratoryRate >= 8 && s.respiratoryRate <= 12,
        successMessage: 'Low respiratory rate gives more time for trapped air to escape. This is the single most important setting.',
      },
      {
        title: 'Increase the I:E ratio (longer expiration)',
        instruction:
          'Set a longer I:E ratio (1:3 or 1:4) to maximise expiratory time. Watch the flow waveform — expiratory flow should return to zero before the next breath.',
        hint: 'Set I:E to 1:3 or 1:4.',
        check: (s) => s.ieRatio >= 3,
        successMessage: 'The extended expiratory time helps prevent gas trapping. Watch the heart — compression should reduce.',
      },
      {
        title: 'Keep PEEP low',
        instruction:
          'In bronchospasm, high PEEP worsens hyperinflation. Keep PEEP at 3–5 cmH₂O (just enough to keep airways open).',
        hint: 'Set PEEP to 5 cmH₂O.',
        check: (s) => s.peep >= 3 && s.peep <= 7,
        successMessage: 'Low PEEP avoids adding to the already elevated intrinsic PEEP from air trapping.',
      },
      {
        title: 'Monitor for resolution of air trapping',
        instruction:
          'With correct settings, hyperinflation should reduce. Watch the lung animation and heart — the lungs should deflate more and the heart should decompress. SpO₂ should stabilise.',
        hint: 'If the heart still looks compressed, try reducing RR further or increasing I:E ratio.',
        check: (_s, v) => v.spo2 >= 88 && v.sbp >= 85,
        successMessage: 'Air trapping is resolving. Haemodynamics are stabilising. Excellent management!',
      },
    ],
    summary:
      'You managed severe bronchospasm by prioritising expiratory time: low RR, high I:E ratio, and low PEEP. Key principle: "low and slow" — allow the air to get out.',
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
          'Restrictive lungs have low compliance and small total capacity. Use 5–6 mL/kg IBW. For a 65 kg patient, aim for 325–390 mL.',
        hint: 'Set TV to 350 mL.',
        check: (s, _v, m) => s.tidalVolume >= 300 && s.tidalVolume <= 420 && m.plateauPressure < 30,
        successMessage: 'Tidal volume is appropriate for the stiff lungs. Plateau pressure is controlled.',
      },
      {
        title: 'Increase respiratory rate to compensate',
        instruction:
          'With smaller tidal volumes, increase RR to maintain minute ventilation. Target RR 18–22.',
        hint: 'Set RR to 20.',
        check: (s) => s.respiratoryRate >= 16 && s.respiratoryRate <= 24,
        successMessage: 'The higher rate compensates for the reduced tidal volume.',
      },
      {
        title: 'Optimise oxygenation',
        instruction:
          'Apply moderate PEEP (5–8 cmH₂O) and adjust FiO₂ to achieve SpO₂ ≥ 92%.',
        hint: 'PEEP 6, FiO₂ 0.4–0.5.',
        check: (_s, v) => v.spo2 >= 92,
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
          'Pressure Support Ventilation (PSV) is the preferred mode for spontaneous breathing patients. Switch the ventilator mode to PSV.',
        hint: 'Change the mode selector to PSV.',
        check: (s) => s.mode === 'PSV',
        successMessage: 'PSV mode lets the patient trigger and control each breath while you provide pressure support.',
      },
      {
        title: 'Set appropriate pressure support',
        instruction:
          'Adjust pressure support to achieve adequate tidal volumes (5–7 mL/kg). Start at 10–14 cmH₂O and titrate to effect.',
        hint: 'Set PS to 12 cmH₂O and watch the delivered tidal volume.',
        check: (s) => s.pressureSupport >= 8 && s.pressureSupport <= 16,
        successMessage: 'Pressure support is augmenting the patient\'s spontaneous breaths adequately.',
      },
      {
        title: 'Ensure adequate oxygenation and ventilation',
        instruction:
          'Adjust PEEP and FiO₂ to maintain SpO₂ ≥ 92% and acceptable EtCO₂.',
        hint: 'PEEP 5, FiO₂ 0.3–0.4 should suffice.',
        check: (_s, v) => v.spo2 >= 92 && v.etco2 <= 55,
        successMessage: 'The patient is breathing comfortably with good gas exchange. This is a good starting point for weaning assessment.',
      },
    ],
    summary:
      'You supported a spontaneously breathing patient with PSV, appropriate pressure support, and minimal PEEP/FiO₂. Key principle: support, don\'t suppress the patient\'s own respiratory drive.',
  },
  {
    patientId: 'ards',
    title: 'APRV: Airway Pressure Release Ventilation for ARDS',
    introduction:
      'This ARDS patient has diffuse atelectasis and refractory hypoxaemia. APRV uses sustained high pressure (P High) to recruit collapsed alveoli, with brief releases (T Low) for CO₂ clearance. Your goal is to optimise all four APRV parameters to maximise recruitment while maintaining ventilation.',
    steps: [
      {
        title: 'Switch to APRV mode',
        instruction:
          'APRV is a pressure-based mode that maintains a high continuous pressure with intermittent brief releases. Switch the ventilator mode to APRV.',
        hint: 'Select APRV from the mode selector.',
        check: (s) => s.mode === 'APRV',
        successMessage: 'APRV mode is active. You now control P High, P Low, T High, and T Low.',
      },
      {
        title: 'Set P High for recruitment',
        instruction:
          'P High is the sustained inflation pressure that recruits collapsed alveoli. Set it high enough to exceed the alveolar opening pressure (typically 25–30 cmH₂O in ARDS) but below 35 cmH₂O to avoid barotrauma.',
        hint: 'Try P High 28 cmH₂O — enough to recruit without causing injury.',
        check: (s) => (s.pHigh ?? 0) >= 25 && (s.pHigh ?? 0) <= 35,
        successMessage: 'P High is in the therapeutic range. The sustained pressure is opening collapsed alveoli.',
      },
      {
        title: 'Set P Low to maximise pressure differential',
        instruction:
          'P Low should be set to 0 cmH₂O to maximise the driving pressure during the release phase, which aids CO₂ elimination. The brief T Low will prevent complete de-recruitment.',
        hint: 'Set P Low to 0 cmH₂O.',
        check: (s) => (s.pLow ?? 5) <= 2,
        successMessage: 'P Low at 0 maximises the pressure differential for CO₂ clearance during the release.',
      },
      {
        title: 'Set T High for sustained recruitment',
        instruction:
          'T High is the duration spent at P High. Longer times (4–6 seconds) allow more complete alveolar recruitment. Too short and alveoli will not fully open.',
        hint: 'Set T High to 4–5 seconds.',
        check: (s) => (s.tHigh ?? 0) >= 4 && (s.tHigh ?? 0) <= 6,
        successMessage: 'T High provides adequate time for alveolar recruitment. Watch the lung animation — atelectasis should be clearing.',
      },
      {
        title: 'Set T Low to prevent de-recruitment',
        instruction:
          'T Low is the critical parameter — the brief release for CO₂ clearance. It must be short enough (0.3–0.8 s) to maintain auto-PEEP and prevent alveolar collapse, but long enough for some gas exchange.',
        hint: 'Set T Low to 0.5 seconds. Watch the recruitment indicator.',
        check: (s) => (s.tLow ?? 0) >= 0.3 && (s.tLow ?? 0) <= 0.8,
        successMessage: 'T Low is optimal — short enough to maintain auto-PEEP and prevent de-recruitment during the release phase.',
      },
      {
        title: 'Increase FiO₂ and confirm oxygenation',
        instruction:
          'With APRV settings optimised, adjust FiO₂ to achieve SpO₂ ≥ 88%. The high mean airway pressure from APRV should dramatically improve oxygenation compared to conventional ventilation.',
        hint: 'Try FiO₂ 0.6–0.8. Watch the recruitment progress bar and SpO₂.',
        check: (_s, v) => v.spo2 >= 88,
        successMessage: 'Oxygenation is improving with recruited lungs and adequate FiO₂. Excellent APRV management!',
      },
    ],
    summary:
      'You successfully applied APRV to an ARDS patient. Key principles: P High 25–30 cmH₂O for recruitment, P Low 0 for maximal driving pressure, T High 4–6 s for sustained opening, and T Low 0.3–0.8 s to prevent de-recruitment. APRV maintains a high mean airway pressure that keeps alveoli open while brief releases allow CO₂ clearance.',
  },
  {
    patientId: 'ards',
    tabLabel: 'ARDSNet',
    title: 'ARDSNet Protocol: Keeping Plateau Pressure Under 30',
    introduction:
      'This patient has mild ARDS (compliance 40 mL/cmH₂O, predicted body weight 70 kg). You will apply the ARDSNet low tidal volume protocol step by step. The key relationship: plateau pressure ≈ PEEP + tidal volume ÷ compliance. Both PEEP and tidal volume push plateau up, so every PEEP increase must be balanced against tidal volume to keep plateau ≤ 30 cmH₂O.',
    steps: [
      {
        title: 'Use volume control (VCV)',
        instruction:
          'ARDSNet was carried out using volume-assist control. Select VCV so you set the tidal volume directly and can read plateau pressure from the lung model.',
        hint: 'Choose VCV from the mode selector.',
        check: (s) => s.mode === 'VCV',
        successMessage: 'VCV is active. Tidal volume is now fixed, so plateau pressure tells you how stiff the lung is.',
      },
      {
        title: 'Set tidal volume to 6 mL/kg PBW',
        instruction:
          'ARDSNet starts at 8 mL/kg predicted body weight and reduces to 6 mL/kg. Always use predicted (not actual) body weight. For PBW 70 kg, 6 mL/kg is 420 mL.',
        hint: 'Set tidal volume to 420 mL (accepted range 400–440 mL).',
        check: (s) => s.mode === 'VCV' && s.tidalVolume >= 400 && s.tidalVolume <= 440,
        successMessage: 'Tidal volume is 6 mL/kg PBW. At this compliance each breath adds about 10–11 cmH₂O above PEEP.',
      },
      {
        title: 'Raise respiratory rate to keep minute ventilation',
        instruction:
          'The smaller breaths lower minute ventilation. Increase the rate (ARDSNet maximum 35/min) to clear CO₂. Watch the flow trace: expiratory flow should return to zero before the next breath, or gas becomes trapped.',
        hint: 'Set RR 20–30/min.',
        check: (s) => s.respiratoryRate >= 20 && s.respiratoryRate <= 35,
        successMessage: 'Rate is compensating for the smaller breaths. Minute ventilation is close to its previous level.',
      },
      {
        title: 'Pair PEEP with FiO₂ (ARDSNet lower PEEP table)',
        instruction:
          'ARDSNet links PEEP to FiO₂: 0.4 → 5–8, 0.5 → 8–10, 0.6 → 10, 0.7 → 10–14, 0.8 → 14, 0.9 → 14–18, 1.0 → 18–24. Choose a matching pair that gives SpO₂ 88–95%. As you raise PEEP, watch plateau pressure climb by the same amount.',
        hint: 'Try FiO₂ 0.8 with PEEP 14.',
        check: (s, v) => {
          const f = Math.round(s.fio2 * 10) / 10;
          const table: Record<string, [number, number]> = {
            '0.4': [5, 8], '0.5': [8, 10], '0.6': [10, 10], '0.7': [10, 14],
            '0.8': [14, 14], '0.9': [14, 18], '1': [18, 24],
          };
          const r = table[String(f)];
          return !!r && s.peep >= r[0] && s.peep <= r[1] && v.spo2 >= 88;
        },
        successMessage: 'PEEP and FiO₂ match the ARDSNet table and oxygenation is on target (SpO₂ 88–95%).',
      },
      {
        title: 'Check plateau pressure ≤ 30 cmH₂O',
        instruction:
          'Read the plateau pressure. With PEEP 14 and 420 mL it should be about 24–25 cmH₂O (14 + 420 ÷ 40). If plateau is above 30, ARDSNet tells you to reduce tidal volume by 1 mL/kg steps, down to 4 mL/kg (280 mL), rather than lowering PEEP. Driving pressure (plateau − PEEP) should ideally be ≤ 15.',
        hint: 'If plateau is over 30, lower TV towards 350 mL (5 mL/kg) or 280 mL (4 mL/kg).',
        check: (s, _v, m) =>
          s.mode === 'VCV' && s.tidalVolume >= 280 && s.tidalVolume <= 440 &&
          m.plateauPressure <= 30 && m.plateauPressure - s.peep <= 15,
        successMessage: 'Plateau ≤ 30 and driving pressure ≤ 15. The lung is protected from overdistension.',
      },
      {
        title: 'Accept permissive hypercapnia',
        instruction:
          'Low tidal volume often raises CO₂. ARDSNet accepts this as long as pH stays ≥ 7.30, raising the rate (up to 35) if needed. Never increase tidal volume above 6 mL/kg to correct CO₂ if that pushes plateau above 30.',
        hint: 'Keep EtCO₂ ≤ 60 mmHg, with plateau still ≤ 30.',
        check: (s, v, m) => v.etco2 <= 60 && m.plateauPressure <= 30 && s.tidalVolume <= 440,
        successMessage: 'CO₂ is acceptable and plateau is still protective. You have completed the ARDSNet protocol.',
      },
    ],
    summary:
      'ARDSNet in brief: VCV, tidal volume 6 mL/kg PBW (4–8), rate up to 35, PEEP paired with FiO₂ from the table, SpO₂ 88–95%, plateau ≤ 30 cmH₂O. Plateau ≈ PEEP + VT ÷ compliance, so when PEEP rises, tidal volume must sometimes fall. Protect the lung first; accept a higher CO₂.',
  },
];

export function getTutorialForPatient(patientId: string): TutorialScenario | undefined {
  return tutorials.find(t => t.patientId === patientId);
}

/** All tutorials for a patient (e.g. ARDS has both a conventional and an APRV tutorial). */
export function getTutorialsForPatient(patientId: string): TutorialScenario[] {
  return tutorials.filter(t => t.patientId === patientId);
}
