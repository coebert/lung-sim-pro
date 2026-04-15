import { useMemo } from 'react';
import { VentSettings, PatientPhysiology, Vitals, MeasuredValues } from '@/lib/simulation/types';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

interface ClinicalFeedbackProps {
  settings: VentSettings;
  patient: PatientPhysiology;
  vitals: Vitals;
  measured: MeasuredValues;
}

interface Insight {
  text: string;
  severity: 'good' | 'warn' | 'danger';
}

export function ClinicalFeedback({ settings, patient, vitals, measured }: ClinicalFeedbackProps) {
  const [collapsed, setCollapsed] = useState(false);

  const insights = useMemo(() => {
    const list: Insight[] = [];

    // ── Oxygenation ──
    const fio2Ratio = settings.fio2 / patient.optimalFiO2;
    const peepRatio = settings.peep / patient.optimalPEEP;

    if (vitals.spo2 < 88) {
      list.push({ text: `Critical hypoxaemia (SpO₂ ${Math.round(vitals.spo2)}%). Consider increasing FiO₂ or PEEP.`, severity: 'danger' });
    } else if (vitals.spo2 < 92) {
      list.push({ text: `SpO₂ is low (${Math.round(vitals.spo2)}%). Oxygenation may be inadequate.`, severity: 'warn' });
    } else if (vitals.spo2 >= 96) {
      list.push({ text: `SpO₂ adequate (${Math.round(vitals.spo2)}%).`, severity: 'good' });
    }

    if (settings.fio2 > 0.6 && vitals.spo2 > 94) {
      list.push({ text: `FiO₂ is high (${(settings.fio2 * 100).toFixed(0)}%). Consider weaning to avoid oxygen toxicity.`, severity: 'warn' });
    }
    if (fio2Ratio < 0.7) {
      list.push({ text: `FiO₂ may be insufficient for this patient's pathology. Target ~${(patient.optimalFiO2 * 100).toFixed(0)}%.`, severity: 'warn' });
    }

    // ── PEEP ──
    if (peepRatio < 0.6) {
      list.push({ text: `PEEP is low (${settings.peep} cmH₂O) for this patient. Optimal ~${patient.optimalPEEP} cmH₂O. Risk of atelectasis.`, severity: 'warn' });
    } else if (settings.peep > patient.optimalPEEP * 1.5) {
      list.push({ text: `PEEP is excessive (${settings.peep} cmH₂O). Risk of overdistension, haemodynamic compromise and shunting.`, severity: 'danger' });
    } else if (peepRatio >= 0.8 && peepRatio <= 1.3) {
      list.push({ text: `PEEP is appropriate (${settings.peep} cmH₂O) for this patient.`, severity: 'good' });
    }

    // ── Ventilation / CO₂ ──
    const minuteVent = (measured.measuredTV * measured.measuredRR) / 1000;
    const optimalMV = (patient.optimalTV * patient.optimalRR) / 1000;
    const ventRatio = minuteVent / optimalMV;

    if (vitals.etco2 > 55) {
      list.push({ text: `Significant hypercapnia (EtCO₂ ${(vitals.etco2 / 7.501).toFixed(1)} kPa). Minute ventilation is inadequate.`, severity: 'danger' });
    } else if (vitals.etco2 > 45) {
      list.push({ text: `Mild hypercapnia (EtCO₂ ${(vitals.etco2 / 7.501).toFixed(1)} kPa). Consider increasing RR or tidal volume.`, severity: 'warn' });
    } else if (vitals.etco2 < 25) {
      list.push({ text: `Hypocapnia (EtCO₂ ${(vitals.etco2 / 7.501).toFixed(1)} kPa). Risk of cerebral vasoconstriction. Reduce minute ventilation.`, severity: 'warn' });
    }

    // ── Tidal volume ──
    const tvPerKg = settings.tidalVolume / patient.weight;
    if (patient.id === 'ards' && tvPerKg > 7) {
      list.push({ text: `Tidal volume is ${tvPerKg.toFixed(1)} mL/kg — exceeds lung-protective threshold (6 mL/kg) for ARDS. Risk of VILI.`, severity: 'danger' });
    } else if (tvPerKg > 10) {
      list.push({ text: `Tidal volume is high (${tvPerKg.toFixed(1)} mL/kg). Risk of volutrauma.`, severity: 'warn' });
    } else if (tvPerKg >= 5 && tvPerKg <= 8) {
      list.push({ text: `Tidal volume (${tvPerKg.toFixed(1)} mL/kg) is within protective range.`, severity: 'good' });
    }

    // ── Pressures ──
    if (measured.peakPressure > 40) {
      list.push({ text: `Peak airway pressure is dangerously high (${measured.peakPressure.toFixed(0)} cmH₂O). Risk of barotrauma.`, severity: 'danger' });
    } else if (measured.peakPressure > 30) {
      list.push({ text: `Elevated peak pressure (${measured.peakPressure.toFixed(0)} cmH₂O). Monitor for barotrauma.`, severity: 'warn' });
    }

    if (measured.plateauPressure > 30) {
      list.push({ text: `Plateau pressure >30 cmH₂O (${measured.plateauPressure.toFixed(0)}). High risk of alveolar overdistension.`, severity: 'danger' });
    }

    // ── Shunting ──
    const peepExcess = Math.max(0, settings.peep - patient.optimalPEEP * 1.3);
    const cycleTime = 60 / settings.respiratoryRate;
    const iTime = settings.inspiratoryTime > 0 ? settings.inspiratoryTime : cycleTime / (1 + settings.ieRatio);
    const ieActual = iTime / Math.max(cycleTime - iTime, 0.1);
    const ieExcess = Math.max(0, ieActual - 0.8);
    const shuntFraction = Math.min(0.5, (peepExcess * 0.02) + (ieExcess * 0.08) + (peepExcess * ieExcess * 0.03));

    if (shuntFraction > 0.15) {
      list.push({ text: `Significant intrapulmonary shunting (${(shuntFraction * 100).toFixed(0)}%). Excessive PEEP and/or prolonged I-time causing refractory hypoxaemia.`, severity: 'danger' });
    } else if (shuntFraction > 0.05) {
      list.push({ text: `Mild shunting developing. High mean airway pressure may be compressing pulmonary capillaries.`, severity: 'warn' });
    }

    // ── I:E ratio ──
    if (ieActual > 1) {
      list.push({ text: `Inverse I:E ratio (1:${(1 / ieActual).toFixed(1)}). Risk of air trapping, auto-PEEP and haemodynamic compromise.`, severity: 'warn' });
    }
    const eTime = cycleTime - iTime;
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
    if (measured.dynamicCompliance > 0 && measured.dynamicCompliance < 20) {
      list.push({ text: `Very low dynamic compliance (${measured.dynamicCompliance} mL/cmH₂O). Stiff lungs — consider lung-protective strategy.`, severity: 'warn' });
    }

    // ── Patient-specific guidance ──
    if (patient.id === 'ards' && settings.peep >= patient.optimalPEEP * 0.8 && tvPerKg <= 7) {
      list.push({ text: `Lung-protective strategy in place: low VT + adequate PEEP for ARDS.`, severity: 'good' });
    }
    if (patient.id === 'bronchospasm' && settings.respiratoryRate <= 12 && eTime > 3) {
      list.push({ text: `Appropriate strategy for bronchospasm: low RR with long expiratory time allows emptying.`, severity: 'good' });
    }
    if (patient.id === 'obese' && settings.peep >= patient.optimalPEEP * 0.8) {
      list.push({ text: `Adequate PEEP for obesity — helps counteract diaphragmatic splinting and basal atelectasis.`, severity: 'good' });
    }

    // If nothing concerning
    if (list.length === 0) {
      list.push({ text: 'Ventilation parameters appear appropriate. Vitals stable.', severity: 'good' });
    }

    return list;
  }, [settings, patient, vitals, measured]);

  const dangerCount = insights.filter(i => i.severity === 'danger').length;
  const warnCount = insights.filter(i => i.severity === 'warn').length;

  const headerColor = dangerCount > 0 ? 'text-destructive' : warnCount > 0 ? 'text-yellow-500' : 'text-green-500';

  return (
    <div className="flex flex-col bg-secondary rounded border border-border overflow-hidden">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="flex items-center justify-between px-2 py-1 bg-secondary hover:bg-muted transition-colors shrink-0"
      >
        <span className={`text-[10px] font-bold tracking-wider uppercase ${headerColor}`}>
          Clinical Feedback
          {dangerCount > 0 && <span className="ml-1">⚠ {dangerCount}</span>}
          {warnCount > 0 && <span className="ml-1">⚡ {warnCount}</span>}
        </span>
        {collapsed ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronUp className="w-3 h-3 text-muted-foreground" />}
      </button>

      {!collapsed && (
        <div className="max-h-[200px] overflow-y-auto p-1.5 space-y-1">
          {insights.map((insight, i) => (
            <div
              key={i}
              className={`text-[10px] leading-tight px-2 py-1 rounded ${
                insight.severity === 'danger'
                  ? 'bg-destructive/15 text-destructive border border-destructive/30'
                  : insight.severity === 'warn'
                  ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                  : 'bg-green-500/10 text-green-400 border border-green-500/20'
              }`}
            >
              {insight.severity === 'danger' ? '🔴 ' : insight.severity === 'warn' ? '🟡 ' : '🟢 '}
              {insight.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
