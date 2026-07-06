import { Settings, Users, Stethoscope, GraduationCap, LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';
import { VentilatorControls } from './VentilatorControls';
import { PatientSelector } from './PatientSelector';
import { ClinicalFeedback } from './ClinicalFeedback';
import { TutorialPanel } from './TutorialPanel';
import {
  AllModeParams,
  MeasuredValues,
  PatientPhysiology,
  VentSettings,
  Vitals,
} from '@/lib/simulation/types';
import { simulationStore } from '@/lib/simulation/simulationStore';

export type MobileOverlay = 'none' | 'controls' | 'patients' | 'feedback' | 'tutorial';

interface MobileBottomNavProps {
  overlay: MobileOverlay;
  onOverlayChange: (o: MobileOverlay) => void;
  /** portrait uses stacked icon+label, landscape uses inline. */
  variant: 'portrait' | 'landscape';
}

const NAV_ITEMS: { id: Exclude<MobileOverlay, 'none'>; label: string; icon: LucideIcon }[] = [
  { id: 'controls', label: 'Settings', icon: Settings },
  { id: 'patients', label: 'Patient',  icon: Users },
  { id: 'feedback', label: 'Clinical', icon: Stethoscope },
  { id: 'tutorial', label: 'Tutorial', icon: GraduationCap },
];

export function MobileBottomNav({ overlay, onOverlayChange, variant }: MobileBottomNavProps) {
  const isPortrait = variant === 'portrait';
  const iconSize = isPortrait ? 'w-4 h-4' : 'w-4 h-4';
  // Enforce a minimum 44px tap target in both orientations (WCAG 2.5.5).
  const layoutClass = isPortrait
    ? 'flex-col items-center gap-0.5 py-2 min-h-[44px]'
    : 'items-center justify-center gap-1.5 py-1.5 min-h-[44px]';

  return (
    <div className="flex border-t border-border bg-secondary shrink-0">
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
        const active = overlay === id;
        return (
          <button
            key={id}
            onClick={() => onOverlayChange(active ? 'none' : id)}
            aria-label={label}
            aria-pressed={active}
            className={`flex-1 flex ${layoutClass} text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              active ? 'text-primary bg-muted' : 'text-muted-foreground'
            }`}
          >
            <Icon className={iconSize} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

interface MobileOverlayPanelProps {
  overlay: MobileOverlay;
  onClose: () => void;
  bottomOffset: number;
  maxHeight: string;
  settings: VentSettings;
  allSettings: AllModeParams;
  patient: PatientPhysiology;
  vitals: Vitals;
  measured: MeasuredValues;
  prone: boolean;
}

export function MobileOverlayPanel({
  overlay, onClose, bottomOffset, maxHeight,
  settings, allSettings, patient, vitals, measured, prone,
}: MobileOverlayPanelProps) {
  if (overlay === 'none') return null;

  let content: ReactNode = null;
  if (overlay === 'controls') {
    content = <VentilatorControls settings={settings} onUpdate={simulationStore.updateSettings} />;
  } else if (overlay === 'patients') {
    content = (
      <PatientSelector
        selectedPatient={patient}
        onSelectPatient={(p) => { simulationStore.setPatient(p); onClose(); }}
      />
    );
  } else if (overlay === 'feedback') {
    content = <ClinicalFeedback settings={settings} patient={patient} vitals={vitals} measured={measured} prone={prone} />;
  } else if (overlay === 'tutorial') {
    content = (
      <TutorialPanel
        patient={patient}
        settings={settings}
        allSettings={allSettings}
        vitals={vitals}
        measured={measured}
        onClose={onClose}
      />
    );
  }

  return (
    <div
      className="absolute left-0 right-0 bg-background border-t border-border overflow-y-auto z-50 p-2 shadow-lg"
      style={{ bottom: bottomOffset, maxHeight }}
    >
      {content}
    </div>
  );
}
