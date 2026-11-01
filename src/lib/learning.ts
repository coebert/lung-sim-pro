export interface LearnItem {
  title: string;
  body: string[];
}
export interface LearnSection {
  id: string;
  heading: string;
  items: LearnItem[];
}

export const learnSections: LearnSection[] = [
  {
    id: 'modes',
    heading: 'Ventilation modes',
    items: [
      { title: 'VCV — Volume control', body: [
        'The ventilator delivers a set tidal volume with a constant flow. Pressure rises in response to the lung and airway mechanics.',
        'Peak pressure minus plateau pressure reflects airway resistance. Plateau minus PEEP is the driving pressure, which reflects compliance.',
        'Key settings: TV, RR, I:E (or Ti), PEEP, FiO₂, flow.' ] },
      { title: 'PCV — Pressure control', body: [
        'The ventilator holds a set inspiratory pressure (Pinsp above PEEP) for a set time. Tidal volume varies with compliance, resistance and auto-PEEP.',
        'Flow is decelerating. Rise time sets how quickly pressure reaches its target.',
        'Watch the exhaled volume: stiffer lungs or air trapping quietly reduce VT.' ] },
      { title: 'PRVC — Pressure-regulated volume control', body: [
        'A pressure-controlled breath whose Pinsp is adjusted breath by breath to reach a target volume, capped by Pmax.',
        'If the "volume not reached" warning appears, the lung needs more pressure than the cap allows.' ] },
      { title: 'SIMV — Synchronised intermittent mandatory ventilation', body: [
        'Delivers a set number of mandatory breaths. Between them, the patient breathes spontaneously with pressure support.',
        'Support breaths are cycled off by ETS (expiratory trigger sensitivity), like PSV. On the P-V loop, mandatory and support breaths form separate shapes.' ] },
      { title: 'PSV — Pressure support', body: [
        'Every breath is triggered by the patient. The ventilator adds a set pressure until flow falls to the ETS percentage of peak flow.',
        'Higher ETS gives a shorter breath, which helps obstructed patients. There is no backup rate here, so a paralysed patient becomes apnoeic.' ] },
      { title: 'APRV — Airway pressure release ventilation', body: [
        'A long time at P High keeps the lung open, with brief releases to P Low that clear CO₂.',
        'T Low is kept short, so expiratory flow is cut off at roughly 50–75% of peak, which keeps some intrinsic PEEP. The P-V loop looks like a box.' ] },
    ],
  },
  {
    id: 'waveforms',
    heading: 'Waveforms and loops',
    items: [
      { title: 'Pressure–time', body: [
        'In VCV the trace rises steadily to a peak, and an inspiratory pause shows the plateau. In pressure modes it is square.',
        'A wide peak-to-plateau gap means high resistance (bronchospasm, kinked tube). A high plateau means stiff lungs or overdistension.' ] },
      { title: 'Flow–time', body: [
        'Inspiratory flow is above the line and expiratory flow below it. If expiratory flow has not returned to zero before the next breath, air is trapped (auto-PEEP).' ] },
      { title: 'Volume–time', body: [
        'Shows each breath delivered and exhaled. If the trace does not return to baseline, suspect a leak or gas trapping.' ] },
      { title: 'Capnogram', body: [
        'Phase I is dead space (no CO₂). Phase II is a steep rise as alveolar gas mixes in. Phase III is the alveolar plateau, and its end is the EtCO₂. Phase 0 is the drop at inspiration.',
        'A sloped "shark-fin" plateau suggests bronchospasm or COPD. A flat line suggests apnoea, disconnection or oesophageal intubation.' ] },
      { title: 'Pressure–volume loop', body: [
        'The slope reflects compliance. A lower bend suggests a recruitment (opening) pressure. A "beak" at the top in VCV suggests overdistension.',
        'A wider loop means more resistance. Pressure modes give a box-like loop.' ] },
      { title: 'Flow–volume loop', body: [
        'A scooped expiratory limb suggests airflow obstruction. If the loop does not close at zero flow, air is trapped.' ] },
    ],
  },
  {
    id: 'alarms',
    heading: 'Alarms',
    items: [
      { title: 'High PIP', body: [
        'Think DOPES: Displacement, Obstruction (secretions, bronchospasm, biting), Pneumothorax, Equipment, Stacked breaths.',
        'Compare peak with plateau. If only the peak is high, the airway is the problem. If both are high, the lung or chest wall is.' ] },
      { title: 'Low VTe', body: [
        'Suspect a leak or disconnection. In pressure modes, also suspect falling compliance or rising auto-PEEP.' ] },
      { title: 'Apnoea / no tidal volume', body: [
        'No effective breaths are being delivered: a spontaneous mode in a paralysed patient, or a disconnection. Switch to a controlled mode or reconnect.' ] },
      { title: 'Low SpO₂', body: [
        'Check the probe and the patient. Then raise FiO₂ and consider more PEEP or recruitment, a longer inspiratory time, or prone positioning for ARDS.' ] },
    ],
  },
];
