import { spo2Target } from '@/lib/simulation/targets';
import { useMemo, useState } from 'react';
import { VentSettings, PatientPhysiology, Vitals, MeasuredValues } from '@/lib/simulation/types';
import { computeAPRV, computeInverseRatio, computeShunt } from '@/lib/simulation/scoring';
import { prvcInspPressure, psvInspTime, simvSupportInspTime } from '@/lib/simulation/waveformGenerators';
import { AlertTriangle, ChevronDown, ChevronUp, CircleAlert, CircleCheck, Zap } from 'lucide-react';

interface ClinicalFeedbackProps {
  settings: VentSettings;
  patient: PatientPhysiology;
  vitals: Vitals;
  measured: MeasuredValues;
  prone?: boolean;
}

interface Insight {
  text: string;
  severity: 'good' | 'warn' | 'danger';
}

export function ClinicalFeedback({ settings, patient, vitals, measured, prone = false }: ClinicalFeedbackProps) {
  const [collapsed, setCollapsed] = useState(false);

  const insights = useMemo(() => {
    const list: Insight[] = [];
    // No advice from half-measured or absent breaths.
    if (measured.apnoea) {
      return [{ text: `Apnoea: no breath detected for over 20 s.${settings.mode === 'PSV' && patient.spontaneousRate <= 0 ? ' PSV needs patient effort and this patient is paralysed — choose a mandatory mode.' : ' Check the mode and settings (e.g. Pmax vs PEEP, P High vs P Low).'} This simulator has no automatic apnoea backup.`, severity: 'danger' }];
    }
    if (measured.warmingUp) {
      return [{ text: 'Measuring the first complete breath on the new settings…', severity: 'warn' }];
    }

    // ── Oxygenation ──
    const fio2Ratio = settings.fio2 / patient.optimalFiO2;
    const peepRatio = settings.peep / patient.optimalPEEP;

    // Targets are per scenario (e.g. 88–92% in COPD, 88–95% in ARDS).
    const [spLo, spHi] = spo2Target(patient.id);
    const sp = Math.round(vitals.spo2);
    if (vitals.spo2 < spLo - 4) {
      list.push({ text: `Critical hypoxaemia (SpO₂ ${sp}%, target ${spLo}–${spHi}%). Consider increasing FiO₂ or ${settings.mode === 'APRV' ? 'P High / reviewing T Low against the release flow' : 'PEEP'}.`, severity: 'danger' });
    } else if (vitals.spo2 < spLo) {
      list.push({ text: `SpO₂ ${sp}% is below this patient's target (${spLo}–${spHi}%).`, severity: 'warn' });
    } else if (vitals.spo2 > spHi + 0.5) {
      list.push({ text: `SpO₂ ${sp}% is above this patient's target (${spLo}–${spHi}%). Reduce FiO₂ to avoid excess oxygen.`, severity: 'warn' });
    } else {
      list.push({ text: `SpO₂ ${sp}% is within this patient's target (${spLo}–${spHi}%).`, severity: 'good' });
    }

    if (settings.fio2 > 0.6 && vitals.spo2 > Math.min(94, spHi)) {
      list.push({ text: `FiO₂ is high (${(settings.fio2 * 100).toFixed(0)}%). Consider weaning to avoid oxygen toxicity.`, severity: 'warn' });
    }
    // Titrate FiO₂ to SpO₂, not to a fixed number: only advise more O₂ if desaturated.
    if (fio2Ratio < 0.7 && vitals.spo2 < spLo) {
      list.push({ text: `FiO₂ may be insufficient for this patient's pathology. Target ~${(patient.optimalFiO2 * 100).toFixed(0)}%.`, severity: 'warn' });
    }

    // ── PEEP ── (not applicable in APRV: end-expiratory pressure comes from P Low + auto-PEEP)
    if (settings.mode === 'APRV') {
      // handled in APRV-specific section
    } else if (peepRatio < 0.6) {
      list.push({ text: `PEEP is low (${settings.peep} cmH₂O) for this patient. Optimal ~${patient.optimalPEEP} cmH₂O. Risk of atelectasis.`, severity: 'warn' });
    } else if (settings.peep > patient.optimalPEEP + 8) {
      list.push({ text: `PEEP is excessive (${settings.peep} cmH₂O). Risk of overdistension, haemodynamic compromise and shunting.`, severity: 'danger' });
    } else if (settings.peep > Math.max(patient.optimalPEEP * 1.5, patient.optimalPEEP + 5)) {
      list.push({ text: `PEEP is higher than needed (${settings.peep} cmH₂O; ~${patient.optimalPEEP} expected). Watch blood pressure and plateau pressure.`, severity: 'warn' });
    } else if (peepRatio >= 0.8 && peepRatio <= 1.3) {
      list.push({ text: `PEEP is appropriate (${settings.peep} cmH₂O) for this patient.`, severity: 'good' });
    }

    // ── Ventilation / CO₂ ──
    const minuteVent = measured.minuteVentilation;
    const optimalMV = (patient.optimalTV * patient.optimalRR) / 1000;
    const ventRatio = minuteVent / optimalMV;

    const permissive = patient.id === 'bronchospasm' || patient.id === 'copd' || patient.id === 'asthma' || patient.id === 'ards' || measured.autoPEEP > 1;
    // CO₂ advice only from a valid capnogram: no plateau under-reads alveolar CO₂,
    // and no signal means no exhaled CO₂ reaches the sensor (not hypocapnia).
    const va = measured.alveolarVentilation ?? 0;
    if (vitals.etco2Status === 'unavailable') {
      list.push({ text: `No capnographic signal: exhaled breaths (VT ${measured.measuredTV} mL) are not clearing the ~${Math.round(2.2 * (patient.predictedBodyWeight ?? patient.weight))} mL dead space${va <= 0.1 ? ' — alveolar ventilation is near zero' : ''}. This is NOT hypocapnia: CO₂ is accumulating. Increase tidal volume / lengthen expiration rather than reducing ventilation.`, severity: 'danger' });
    } else if (vitals.etco2Status === 'measuring') {
      // no CO₂ advice until a complete breath has been sampled
    } else if (vitals.etco2Status === 'no-plateau') {
      list.push({ text: `EtCO₂ ${(vitals.etco2 / 7.501).toFixed(1)} kPa has no alveolar plateau, so it under-reads alveolar CO₂. Do not reduce ventilation on this number — check VT against dead space and expiratory time.`, severity: 'warn' });
    } else if (vitals.etco2 > 45 && permissive) {
      list.push({ text: patient.id === 'bronchospasm' || measured.autoPEEP > 1
        ? `Hypercapnia (EtCO₂ ${(vitals.etco2 / 7.501).toFixed(1)} kPa). Permissive hypercapnia may be acceptable (pH is not modelled here). Do NOT raise RR or shorten expiratory time — this worsens air trapping.`
        : `Hypercapnia (EtCO₂ ${(vitals.etco2 / 7.501).toFixed(1)} kPa). Permissive hypercapnia may be acceptable in lung-protective ventilation (pH is not modelled here). Increase RR cautiously (watch auto-PEEP); do not raise VT above 6–8 mL/kg PBW.`,
        severity: vitals.etco2 > 70 ? 'danger' : 'warn' });
    } else if (vitals.etco2 > 55) {
      list.push({ text: `Significant hypercapnia (EtCO₂ ${(vitals.etco2 / 7.501).toFixed(1)} kPa). Minute ventilation is inadequate.`, severity: 'danger' });
    } else if (vitals.etco2 > 45) {
      list.push({ text: `Mild hypercapnia (EtCO₂ ${(vitals.etco2 / 7.501).toFixed(1)} kPa). Consider increasing RR or tidal volume.`, severity: 'warn' });
    } else if (vitals.etco2 < 25) {
      list.push({ text: `Hypocapnia (EtCO₂ ${(vitals.etco2 / 7.501).toFixed(1)} kPa). Risk of cerebral vasoconstriction. Reduce minute ventilation.`, severity: 'warn' });
    }

    // ── Tidal volume ── (only meaningful for volume-configured modes)
    if (settings.mode === 'PSV' && patient.spontaneousRate <= 0) {
      list.push({ text: 'APNOEA: this patient has no respiratory drive, so pressure support delivers no breaths. Use a mandatory mode (VCV/PCV/PRVC/SIMV).', severity: 'danger' });
    }

    // ── Pressure-mode specifics ──
    if (settings.mode === 'PCV' && settings.peep + settings.pInsp > 30) {
      list.push({ text: `Peak pressure ${settings.peep + settings.pInsp} cmH₂O (PEEP + Pinsp) exceeds 30. In PCV the delivered VT changes with compliance — reduce Pinsp.`, severity: 'warn' });
    }
    if (settings.mode === 'PRVC') {
      const r = prvcInspPressure(settings, patient);
      if (r.limited) {
        list.push({ text: `PRVC pressure limited: needs ${Math.round(r.needed + settings.peep)} cmH₂O but the ceiling is Pmax − 5 (${settings.pMax - 5}). Target VT is not being reached ("Volume not reached" alarm).`, severity: 'danger' });
      }
    }
    if (settings.mode === 'SIMV' && patient.spontaneousRate > 0 && settings.pressureSupport > 0) {
      const ti = simvSupportInspTime(settings, patient);
      if (ti >= 1.5) {
        list.push({ text: `Long SIMV support breaths (Ti ${ti.toFixed(1)} s): slow flow decay from high resistance. Raise ETS so support breaths cycle off earlier and air-trapping falls.`, severity: 'warn' });
      }
      if (settings.riseTime >= 0.3) {
        list.push({ text: 'Slow SIMV support rise time may leave spontaneous breaths flow-starved — increased work of breathing. Shorten rise time.', severity: 'warn' });
      }
    }
    if (settings.mode === 'PSV' && patient.spontaneousRate > 0) {
      const ti = psvInspTime(settings, patient);
      if (ti >= 1.5) {
        list.push({ text: `Long PSV inspiration (Ti ${ti.toFixed(1)} s): slow flow decay from high resistance. Raise ETS (e.g. 40–60 %) so the breath cycles off earlier and air-trapping falls.`, severity: 'warn' });
      }
      if (settings.riseTime >= 0.3) {
        list.push({ text: 'Slow PSV rise time may leave the patient flow-starved — increased work of breathing. Shorten rise time.', severity: 'warn' });
      }
    }
    {
      // mL/kg is dosed on PREDICTED body weight. Volume-set modes grade the set
      // VT; pressure-set modes grade the delivered (measured) VT.
      const pbw = patient.predictedBodyWeight ?? patient.weight;
      const vt = 'tidalVolume' in settings ? settings.tidalVolume : measured.measuredTV;
      const tvPerKg = vt / pbw;
      if (vt <= 0) {
        // apnoea handled above
      } else if (patient.id === 'ards' && tvPerKg > 6.5) {
        list.push({ text: `Tidal volume is ${tvPerKg.toFixed(1)} mL/kg PBW — exceeds the lung-protective target (≤6 mL/kg PBW) for ARDS. Risk of VILI.`, severity: 'danger' });
      } else if (tvPerKg > 10) {
        list.push({ text: `Tidal volume is high (${tvPerKg.toFixed(1)} mL/kg PBW). Risk of volutrauma.`, severity: 'warn' });
      } else if (tvPerKg >= 4 && tvPerKg <= 8) {
        list.push({ text: `Tidal volume (${tvPerKg.toFixed(1)} mL/kg PBW) is within protective range.`, severity: 'good' });
      }
    }

    // ── Patient–ventilator interaction ──
    if ((measured.autoTriggers ?? 0) >= 2) {
      list.push({ text: `Auto-triggering: about ${Math.round(measured.autoTriggers!)} breaths/min are triggered by cardiogenic flow oscillation, not patient effort — the patient makes ${Math.round(measured.effortRate ?? 0)} efforts/min but the ventilator delivers only ${Math.round(measured.machineRate ?? 0)} breaths/min (${Math.round(measured.assistedRate ?? 0)} patient-triggered). The monitor's total rate (${Math.round(measured.measuredRR)}/min) also counts the small unsupported breaths, so compare efforts with ventilator breaths, not with the total. Make the flow trigger less sensitive (above the ~${patient.cardiogenicOscillation ?? 0} L/min oscillation) and check for leaks.`, severity: 'warn' });
    }
    if ((measured.missedTriggers ?? 0) >= 2) {
      list.push({ text: `Missed triggering: ${Math.round(measured.missedTriggers!)} efforts/min fail to trigger — the patient makes ${Math.round(measured.effortRate ?? 0)} efforts/min but the ventilator delivers only ${Math.round(measured.machineRate ?? 0)} breaths/min (${Math.round(measured.assistedRate ?? 0)} patient-triggered). The monitor's total rate (${Math.round(measured.measuredRR)}/min) also counts the small unsupported breaths, so compare efforts with ventilator breaths, not with the total. Intrinsic PEEP (${measured.autoPEEP.toFixed(1)} cmH₂O) must be overcome before flow reaches the trigger. Shorten supported breaths (raise ETS, lower PS) so the lung empties.`, severity: 'warn' });
    }
    if ((measured.pressureLimited ?? 0) > 0) {
      list.push({ text: `Pressure-limited: volume breaths reach the high-pressure limit and are terminated, so set VT is not delivered (measured ${measured.measuredTV} mL). Peak pressure here is mostly resistive — slow the inspiratory flow (longer Ti) or reduce VT/RR rather than simply raising the limit.`, severity: 'danger' });
    }

    // ── Pressures ──
    if (measured.peakPressure > 40) {
      list.push({ text: `Peak airway pressure is dangerously high (${measured.peakPressure.toFixed(0)} cmH₂O). Risk of barotrauma.`, severity: 'danger' });
    } else if (measured.peakPressure > 30) {
      list.push({ text: `Elevated peak pressure (${measured.peakPressure.toFixed(0)} cmH₂O). Monitor for barotrauma.`, severity: 'warn' });
    }

    if (measured.plateauPressure > 30) {
      list.push({ text: `Model-derived plateau pressure >30 cmH₂O (${measured.plateauPressure.toFixed(0)}). High risk of alveolar overdistension.`, severity: 'danger' });
    }

    // ── Shunting ──
    const shunt = computeShunt(settings, patient);
    const { shuntFraction, ie } = shunt;
    const { ieActual, iTime, eTime } = ie;

    if (shuntFraction > 0.15) {
      list.push({ text: `Significant intrapulmonary shunting (${(shuntFraction * 100).toFixed(0)}%). Excessive PEEP causing refractory hypoxaemia.`, severity: 'danger' });
    } else if (shuntFraction > 0.05) {
      list.push({ text: `Mild shunting developing. High mean airway pressure may be compressing pulmonary capillaries.`, severity: 'warn' });
    }

    // ── I:E ratio / inverse-ratio ventilation ──
    const irv = computeInverseRatio(settings, patient);
    if (irv.isInverse) {
      const ratioText = `${ieActual.toFixed(1)}:1`;
      if (irv.recruitmentBonus > 0.3) {
        list.push({ text: `Inverse-ratio ventilation (${ratioText}). Mean airway pressure ~${irv.meanAirwayPressure.toFixed(0)} cmH₂O — recruiting collapsed alveoli and improving oxygenation in this recruitable lung.`, severity: 'good' });
      } else if (patient.optimalPEEP < 8) {
        list.push({ text: `Inverse I:E ratio (${ratioText}). This lung is not significantly recruitable — the raised mean airway pressure adds haemodynamic burden without an oxygenation benefit.`, severity: 'warn' });
      } else {
        list.push({ text: `Inverse I:E ratio (${ratioText}). Mean airway pressure ~${irv.meanAirwayPressure.toFixed(0)} cmH₂O. Some recruitment benefit; watch for auto-PEEP and rising CO₂.`, severity: 'warn' });
      }
      if (irv.haemodynamicBurden > 0.3) {
        list.push({ text: `High mean airway pressure from inverse ratio is impeding venous return — watch blood pressure.`, severity: 'warn' });
      }
      if (eTime < 0.8) {
        list.push({ text: `Expiratory time very short (${eTime.toFixed(1)}s) with inverse ratio. Air trapping and auto-PEEP likely — check the flow waveform returns towards zero.`, severity: 'warn' });
      }
    }
    if (eTime < 1 && patient.resistance > 15) {
      list.push({ text: `Expiratory time very short (${eTime.toFixed(1)}s) with high airway resistance. Air trapping likely.`, severity: 'danger' });
    }

    // ── Haemodynamics ──
    if (vitals.hr > 130) {
      list.push({ text: `Tachycardia (HR ${Math.round(vitals.hr)}). Likely compensatory response to physiological stress.`, severity: 'warn' });
    }
    if (vitals.sbp < 80) {
      list.push({ text: `Hypotension (SBP ${Math.round(vitals.sbp)} mmHg). High intrathoracic pressure may be reducing venous return.`, severity: 'danger' });
    } else if (vitals.sbp < 90) {
      list.push({ text: `Borderline BP (${Math.round(vitals.sbp)}/${Math.round(vitals.dbp)} mmHg). Monitor haemodynamic status.`, severity: 'warn' });
    }

    // ── Compliance ──
    // Dynamic compliance (VT ÷ (Ppeak − PEEP)) includes resistive pressure, so a low value
    // alone does not mean stiff lungs. Static compliance uses plateau − total PEEP.
    const pbwC = (patient.predictedBodyWeight ?? patient.weight) / 70;
    const totalPeep = settings.mode === 'APRV' ? 0 : settings.peep + measured.autoPEEP;
    const stat = measured.plateauPressure - totalPeep > 0.5 ? measured.measuredTV / (measured.plateauPressure - totalPeep) : 0;
    const resistive = measured.peakPressure - measured.plateauPressure;
    if (settings.mode !== 'APRV' && measured.dynamicCompliance > 0 && measured.dynamicCompliance < 20 * pbwC) {
      if (stat > 0 && stat < 25 * pbwC) {
        list.push({ text: `Low static compliance (${stat.toFixed(0)} mL/cmH₂O from plateau − total PEEP). Stiff lungs — consider lung-protective strategy.`, severity: 'warn' });
      } else if (resistive >= 5) {
        list.push({ text: `Low dynamic compliance (${measured.dynamicCompliance.toFixed(0)} mL/cmH₂O) is mostly airway resistance: Ppeak − Pplat is ${resistive.toFixed(0)} cmH₂O while static compliance is ${stat > 0 ? stat.toFixed(0) : '—'} mL/cmH₂O. This is not stiff lungs.`, severity: 'warn' });
      }
    }

    // ── Patient-specific guidance ──
    if (patient.id === 'ards' && settings.peep >= patient.optimalPEEP * 0.8
        && measured.measuredTV / (patient.predictedBodyWeight ?? patient.weight) >= 4
        && measured.measuredTV / (patient.predictedBodyWeight ?? patient.weight) <= 6.5
        && measured.plateauPressure < 30 && vitals.spo2 >= 88) {
      list.push({ text: `Lung-protective strategy in place: low VT + adequate PEEP for ARDS.`, severity: 'good' });
    }
    if (patient.id === 'bronchospasm' && settings.respiratoryRate <= 12 && eTime > 3) {
      list.push({ text: `Appropriate strategy for bronchospasm: low RR with long expiratory time allows emptying.`, severity: 'good' });
    }
    if (patient.id === 'obese' && settings.peep >= patient.optimalPEEP * 0.8) {
      list.push({ text: `Adequate PEEP for obesity — helps counteract diaphragmatic splinting and basal atelectasis.`, severity: 'good' });
    }

    // ── APRV-specific feedback ──
    if (settings.mode === 'APRV') {
      const { pHigh, pLow, tHigh, tLow } = settings;
      const aprv = computeAPRV(settings, patient);
      const { drivingPressure, openingPressure, recruitmentScore, meanAirwayPressure: meanAP } = aprv;
      if (aprv.gasTrapping > 0.15) {
        list.push({ text: `Severe gas trapping: with τ ≈ ${aprv.tau.toFixed(1)} s, a ${settings.tLow.toFixed(1)} s release empties only ${Math.round(aprv.releaseFraction * 100)}% of the lung. Expect hyperinflation, rising CO₂ (respiratory acidosis) and hypotension. APRV is generally avoided in obstructive disease — use VCV/PCV with a slow rate and long expiratory time.`, severity: 'danger' });
      }

      // P High assessment
      if (drivingPressure < openingPressure * 0.5) {
        list.push({ text: `P High too low (${pHigh} cmH₂O). Driving pressure (${drivingPressure} cmH₂O) is insufficient to open collapsed alveoli. Need ≥${Math.round(openingPressure + pLow)} cmH₂O for this patient.`, severity: 'danger' });
      } else if (drivingPressure < openingPressure) {
        list.push({ text: `P High is marginal (${pHigh} cmH₂O). Driving pressure (${drivingPressure} cmH₂O) may only partially recruit. Consider increasing to ≥${Math.round(openingPressure + pLow)} cmH₂O.`, severity: 'warn' });
      } else if (pHigh > 35) {
        list.push({ text: `P High is very high (${pHigh} cmH₂O). Risk of overdistension and barotrauma. Consider reducing if SpO₂ adequate.`, severity: 'danger' });
      } else if (pHigh > 30) {
        list.push({ text: `P High is elevated (${pHigh} cmH₂O). Monitor for signs of overdistension.`, severity: 'warn' });
      } else {
        list.push({ text: `P High (${pHigh} cmH₂O) provides adequate driving pressure (${drivingPressure} cmH₂O) for alveolar recruitment.`, severity: 'good' });
      }

      // T High assessment
      if (tHigh < 2) {
        list.push({ text: `T High too short (${tHigh.toFixed(1)}s). Insufficient time for alveolar recruitment — lung units need ≥3s at high pressure to open. Aim for 4–6s.`, severity: 'danger' });
      } else if (tHigh < 3) {
        list.push({ text: `T High is short (${tHigh.toFixed(1)}s). Only partial recruitment may occur. A commonly used range is 4–6 s; watch CO₂ as you lengthen it.`, severity: 'warn' });
      } else if (tHigh > 6) {
        list.push({ text: `T High is prolonged (${tHigh.toFixed(1)}s). Recruitment is optimised but CO₂ clearance may be impaired due to infrequent releases.`, severity: 'warn' });
      } else {
        list.push({ text: `T High (${tHigh.toFixed(1)}s) allows adequate time for sustained alveolar recruitment.`, severity: 'good' });
      }

      // T Low assessment — tidal volume is a function of T Low: a long T Low
      // permits full exhalation (large VT, derecruitment); a suitable T Low
      // cycles back to P High before expiration has completed.
      // T Low from this lung's own release flow (case-specific), not a fixed interval.
      const measuredVT = Math.round(measured.measuredTV);
      const pct = aprv.endToPeakFlowPct;
      // For a breathing patient the release metrics are a passive-lung reference:
      // their own efforts make each actual release larger or smaller.
      const ref = patient.spontaneousRate > 0 ? ' (passive-lung reference; this patient’s own breaths change each actual release — check the flow trace)' : '';
      if (aprv.noRelease) {
        list.push({ text: `No release: P High (${pHigh}) is not above P Low (${pLow}). This is CPAP — there is no mandatory ventilation, only the patient's own breaths.`, severity: patient.spontaneousRate > 0 ? 'warn' : 'danger' });
      } else if (aprv.obstructive) {
        list.push({ text: `Obstructive lung (τ ≈ ${aprv.tau.toFixed(2)} s): release flow is still ${pct}% of peak${ref} when T Low (${tLow.toFixed(1)} s) ends. Restrictive-lung targets do not apply — a short release traps gas. APRV is generally avoided here; if used, release much more completely (end flow well below 50% of peak).`, severity: pct > 50 ? 'danger' : 'warn' });
      } else if (pct > 75) {
        list.push({ text: `T Low ${tLow.toFixed(1)} s ends the release while flow is still ${pct}% of peak${ref} — very little gas leaves (VT ${measuredVT} mL), limiting CO₂ clearance. For this lung, lengthen T Low until end-release flow is about 50–75% of peak.`, severity: 'warn' });
      } else if (pct >= 50) {
        list.push({ text: `T Low ${tLow.toFixed(1)} s ends the release at ${pct}% of peak expiratory flow${ref} — within the 50–75% teaching target for this restrictive lung (VT ${measuredVT} mL, intrinsic PEEP ${measured.autoPEEP.toFixed(1)}).`, severity: 'good' });
      } else {
        list.push({ text: `T Low ${tLow.toFixed(1)} s lets expiratory flow fall to ${pct}% of peak${ref} — the lung empties further (VT ${measuredVT} mL) and may derecruit. For this lung, shorten T Low so the release ends at about 50–75% of peak flow.`, severity: pct < 25 ? 'danger' : 'warn' });
      }

      // P Low assessment
      if (pLow > 5) {
        list.push({ text: `P Low is high (${pLow} cmH₂O). This reduces the pressure differential during release, diminishing CO₂ clearance and the recruitment-release cycle. P Low 0 cmH₂O is a common starting point.`, severity: 'warn' });
      } else if (pLow > 0 && pLow <= 5) {
        list.push({ text: `P Low is ${pLow} cmH₂O. Slightly reduces driving pressure. Setting P Low to 0 maximises the release differential (auto-PEEP from short T Low prevents derecruitment, not P Low).`, severity: 'warn' });
      } else {
        list.push({ text: `P Low is 0 cmH₂O — correct for APRV. Auto-PEEP from short T Low maintains end-expiratory pressure.`, severity: 'good' });
      }

      // Overall recruitment assessment
      if (recruitmentScore > 0.8) {
        list.push({ text: `APRV settings are well-optimised (recruitment score ${Math.round(recruitmentScore * 100)}%). Expect progressive alveolar recruitment.`, severity: 'good' });
      } else if (recruitmentScore > 0.4) {
        list.push({ text: `APRV recruitment is partial (score ${Math.round(recruitmentScore * 100)}%). Adjust settings above to improve.`, severity: 'warn' });
      } else {
        list.push({ text: `APRV recruitment is poor (score ${Math.round(recruitmentScore * 100)}%). Current settings are unlikely to recruit collapsed lung. Review all parameters.`, severity: 'danger' });
      }

      // Mean airway pressure
      list.push({ text: `Mean airway pressure: ${meanAP.toFixed(1)} cmH₂O. ${meanAP > 25 ? 'High — monitor haemodynamics.' : meanAP > 15 ? 'Moderate — adequate for recruitment.' : 'Low — may be insufficient for oxygenation.'}`, severity: meanAP > 30 ? 'warn' : meanAP > 12 ? 'good' : 'warn' });
    }

    // ── Prone positioning feedback ──
    if (prone) {
      if (patient.id === 'ards') {
        list.push({ text: `Prone positioning active. V/Q matching improved — dorsal lung zones are now non-dependent, reducing atelectasis and improving oxygenation.`, severity: 'good' });
        if (vitals.spo2 < 88) {
          list.push({ text: `Despite prone positioning, SpO₂ remains low. Ensure FiO₂ and recruitment settings are optimised.`, severity: 'warn' });
        }
      } else {
        list.push({ text: `Prone positioning active. Modest V/Q benefit in this patient — prone is most effective in moderate-to-severe ARDS.`, severity: 'good' });
      }
    } else if (patient.id === 'ards' && vitals.spo2 < 88 && settings.fio2 >= 0.6) {
      list.push({ text: `Refractory hypoxaemia on high FiO₂. Consider prone positioning to improve V/Q matching and oxygenation.`, severity: 'warn' });
    }

    // If nothing concerning
    if (list.length === 0) {
      list.push({ text: 'Ventilation parameters appear appropriate. Vitals stable.', severity: 'good' });
    }

    return list;
  }, [settings, patient, vitals, measured, prone]);

  const dangerCount = insights.filter(i => i.severity === 'danger').length;
  const warnCount = insights.filter(i => i.severity === 'warn').length;

  const headerColor = dangerCount > 0 ? 'text-destructive' : warnCount > 0 ? 'text-yellow-500' : 'text-green-500';

  return (
    <div className="flex flex-col bg-secondary rounded border border-border overflow-hidden">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="flex items-center justify-between px-2 py-1 bg-secondary hover:bg-muted transition-colors shrink-0"
      >
        <span className={`text-[10px] font-bold tracking-wider uppercase ${headerColor} flex items-center gap-1.5`}>
          Clinical Feedback
          {dangerCount > 0 && (
            <span className="flex items-center gap-0.5">
              <AlertTriangle className="w-3 h-3" aria-label="Danger insights" />
              {dangerCount}
            </span>
          )}
          {warnCount > 0 && (
            <span className="flex items-center gap-0.5">
              <Zap className="w-3 h-3" aria-label="Warning insights" />
              {warnCount}
            </span>
          )}
        </span>
        {collapsed ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronUp className="w-3 h-3 text-muted-foreground" />}
      </button>

      {!collapsed && (
        <div className="max-h-[200px] overflow-y-auto p-1.5 space-y-1">
          {insights.map((insight, i) => {
            const Icon = insight.severity === 'danger' ? CircleAlert : insight.severity === 'warn' ? Zap : CircleCheck;
            const label = insight.severity === 'danger' ? 'Danger' : insight.severity === 'warn' ? 'Warning' : 'OK';
            return (
              <div
                key={i}
                className={`text-[10px] leading-tight px-2 py-1 rounded flex items-start gap-1.5 ${
                  insight.severity === 'danger'
                    ? 'bg-destructive/15 text-destructive border border-destructive/30'
                    : insight.severity === 'warn'
                    ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                    : 'bg-green-500/10 text-green-400 border border-green-500/20'
                }`}
              >
                <Icon className="w-3 h-3 shrink-0 mt-0.5" aria-label={label} />
                <span>{insight.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
