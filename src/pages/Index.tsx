import { useState } from 'react';
import { useLayoutMode } from '@/hooks/use-layout-mode';
import { VentilatorPanel } from '@/components/simulator/VentilatorPanel';
import { MonitorPanel } from '@/components/simulator/MonitorPanel';
import { VentilatorControls } from '@/components/simulator/VentilatorControls';
import { PatientSelector } from '@/components/simulator/PatientSelector';
import {
  simulationStore,
  useWaveforms,
  useVitalsSnapshot,
  useControls,
} from '@/lib/simulation/simulationStore';
import { Settings, Users, Pause, Play, Stethoscope, GraduationCap, ChevronLeft, RotateCcw } from 'lucide-react';
import { AlarmBanner } from '@/components/simulator/AlarmBanner';
import { LungAnimation } from '@/components/simulator/LungAnimation';
import { ClinicalFeedback } from '@/components/simulator/ClinicalFeedback';
import { TutorialPanel } from '@/components/simulator/TutorialPanel';

type MobileOverlay = 'none' | 'controls' | 'patients' | 'feedback' | 'tutorial';

const Index = () => {
  const layoutMode = useLayoutMode();
  const isDesktop = layoutMode === 'desktop';
  const isLandscape = layoutMode === 'mobile-landscape';
  const isPortrait = layoutMode === 'mobile-portrait';

  const { settings, allSettings, patient, prone, frozen } = useControls();
  const { vitals, measured, alarms } = useVitalsSnapshot();
  const buffers = useWaveforms();

  const [mobileOverlay, setMobileOverlay] = useState<MobileOverlay>('none');
  const [tutorialActive, setTutorialActive] = useState(false);
  const [lungCollapsed, setLungCollapsed] = useState(false);

  // Compact vitals bar for mobile header
  const VitalsBar = () => (
    <div className="flex items-center gap-3 text-[10px] monitor-text overflow-x-auto">
      <span style={{ color: 'hsl(120,100%,50%)' }}>HR {Math.round(vitals.hr)}</span>
      <span style={{ color: 'hsl(0,100%,55%)' }}>BP {Math.round(vitals.sbp)}/{Math.round(vitals.dbp)}</span>
      <span style={{ color: vitals.spo2 < 90 ? 'hsl(0,100%,55%)' : 'hsl(180,100%,55%)' }}>
        SpO₂ {Math.round(vitals.spo2)}%
      </span>
      <span style={{ color: 'hsl(45,100%,70%)' }}>EtCO₂ {(vitals.etco2 / 7.501).toFixed(1)} kPa</span>
    </div>
  );

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Alarm banner */}
      <AlarmBanner alarms={alarms} />
      {/* Header — hidden in mobile landscape to save vertical space */}
      {!isLandscape && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-secondary border-b border-border gap-2 shrink-0">
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={simulationStore.toggleFrozen}
              className={`p-1 rounded transition-colors ${frozen ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
              title={frozen ? 'Resume waveforms' : 'Freeze waveforms'}
            >
              {frozen ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => setTutorialActive(t => !t)}
              className={`p-1 rounded transition-colors ${tutorialActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
              title={tutorialActive ? 'Exit tutorial' : 'Start tutorial'}
            >
              <GraduationCap className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={simulationStore.toggleProne}
              className={`p-1 rounded transition-colors flex items-center gap-1 ${prone ? 'bg-blue-600 text-white' : 'hover:bg-muted text-muted-foreground'}`}
              title={prone ? 'Return to supine position' : 'Prone positioning'}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {prone && <span className="text-[9px] font-bold">PRONE</span>}
            </button>
            <div className="w-2 h-2 rounded-full bg-wave-ecg animate-pulse" />
            <h1 className="text-xs sm:text-sm font-bold text-foreground tracking-wide whitespace-nowrap">
              ICU Vent Sim
              {frozen && <span className="ml-1.5 text-[10px] text-primary font-normal">FROZEN</span>}
              {tutorialActive && <span className="ml-1.5 text-[10px] text-primary font-normal">TUTORIAL</span>}
            </h1>
          </div>
          {isDesktop ? (
            <div className="text-[10px] text-muted-foreground monitor-text truncate">
              Patient: {patient.name} | C: {patient.compliance} mL/cmH₂O | R: {patient.resistance} cmH₂O/L/s
            </div>
          ) : (
            <VitalsBar />
          )}
        </div>
      )}

      {/* ===== DESKTOP LAYOUT ===== */}
      {isDesktop && (
        <>
          <div className="flex flex-1 min-h-0">
            <div className="flex-[2] flex flex-col border-r border-border min-w-0">
              <div className="flex-1 min-h-0 p-1">
                <VentilatorPanel buffers={buffers} measured={measured} settings={settings} />
              </div>
              <div className="border-t border-border p-2">
                <VentilatorControls settings={settings} onUpdate={simulationStore.updateSettings} />
              </div>
            </div>
            <div className="flex-[2] flex flex-col min-w-0 border-l border-border">
              <div className="flex-1 min-h-0 p-1">
                <MonitorPanel buffers={buffers} vitals={vitals} />
              </div>
            </div>
            {(!lungCollapsed || tutorialActive) && (
              <div className={`${tutorialActive ? 'w-[320px]' : 'w-[220px]'} shrink-0 border-l border-border p-1 flex flex-col gap-1 transition-all`}>
                {tutorialActive ? (
                  <TutorialPanel allSettings={allSettings}
                    patient={patient}
                    settings={settings}
                    vitals={vitals}
                    measured={measured}
                    onClose={() => setTutorialActive(false)}
                  />
                ) : (
                  <>
                    <LungAnimation patient={patient} settings={settings} buffers={buffers} vitals={vitals} collapsed={lungCollapsed} onCollapsedChange={setLungCollapsed} prone={prone} />
                    <ClinicalFeedback settings={settings} patient={patient} vitals={vitals} measured={measured} prone={prone} />
                  </>
                )}
              </div>
            )}
            {lungCollapsed && !tutorialActive && (
              <div className="shrink-0 border-l border-border">
                <button
                  onClick={() => setLungCollapsed(false)}
                  className="flex items-center justify-center px-1 py-2 h-full hover:bg-muted transition-colors"
                  title="Show Lung View"
                >
                  <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            )}
          </div>
          <div className="border-t border-border p-2 shrink-0">
            <PatientSelector selectedPatient={patient} onSelectPatient={simulationStore.setPatient} />
            <div className="text-center mt-1">
              <span className="text-[8px] text-muted-foreground/50 tracking-wide">
                App created by Dr Rob Coe BA MA OXON MBBS FRCA FFICM
              </span>
            </div>
          </div>
        </>
      )}

      {/* ===== MOBILE LANDSCAPE ===== */}
      {isLandscape && (
        <div className="flex-1 flex flex-col min-h-0 relative">
          <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
            <div className="flex-1 min-h-0 min-w-0 p-0.5 border-r border-border">
              <VentilatorPanel buffers={buffers} measured={measured} settings={settings} compact />
            </div>
            <div className="flex-1 min-h-0 min-w-0 p-0.5">
              <MonitorPanel buffers={buffers} vitals={vitals} compact />
            </div>
          </div>

          <div className="flex border-t border-border bg-secondary shrink-0">
            <button
              onClick={() => setMobileOverlay(mobileOverlay === 'controls' ? 'none' : 'controls')}
              className={`flex-1 flex items-center justify-center gap-1 py-0.5 text-[10px] transition-colors
                ${mobileOverlay === 'controls' ? 'text-primary bg-muted' : 'text-muted-foreground'}`}
            >
              <Settings className="w-3 h-3" />
              Settings
            </button>
            <button
              onClick={() => setMobileOverlay(mobileOverlay === 'patients' ? 'none' : 'patients')}
              className={`flex-1 flex items-center justify-center gap-1 py-0.5 text-[10px] transition-colors
                ${mobileOverlay === 'patients' ? 'text-primary bg-muted' : 'text-muted-foreground'}`}
            >
              <Users className="w-3 h-3" />
              Patient
            </button>
            <button
              onClick={() => setMobileOverlay(mobileOverlay === 'feedback' ? 'none' : 'feedback')}
              className={`flex-1 flex items-center justify-center gap-1 py-0.5 text-[10px] transition-colors
                ${mobileOverlay === 'feedback' ? 'text-primary bg-muted' : 'text-muted-foreground'}`}
            >
              <Stethoscope className="w-3 h-3" />
              Clinical
            </button>
            <button
              onClick={() => setMobileOverlay(mobileOverlay === 'tutorial' ? 'none' : 'tutorial')}
              className={`flex-1 flex items-center justify-center gap-1 py-0.5 text-[10px] transition-colors
                ${mobileOverlay === 'tutorial' ? 'text-primary bg-muted' : 'text-muted-foreground'}`}
            >
              <GraduationCap className="w-3 h-3" />
              Tutorial
            </button>
          </div>

          {mobileOverlay !== 'none' && (
            <div className="absolute bottom-[24px] left-0 right-0 bg-background border-t border-border max-h-[55vh] overflow-y-auto z-50 p-2 shadow-lg">
              {mobileOverlay === 'controls' && (
                <VentilatorControls settings={settings} onUpdate={simulationStore.updateSettings} />
              )}
              {mobileOverlay === 'patients' && (
                <PatientSelector selectedPatient={patient} onSelectPatient={(p) => { simulationStore.setPatient(p); setMobileOverlay('none'); }} />
              )}
              {mobileOverlay === 'feedback' && (
                <ClinicalFeedback settings={settings} patient={patient} vitals={vitals} measured={measured} prone={prone} />
              )}
              {mobileOverlay === 'tutorial' && (
                <TutorialPanel patient={patient} settings={settings} allSettings={allSettings} vitals={vitals} measured={measured} onClose={() => setMobileOverlay('none')} />
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== MOBILE PORTRAIT ===== */}
      {isPortrait && (
        <div className="flex-1 flex flex-col min-h-0 relative">
          <div className="flex-[3] min-h-0 p-1 border-b border-border">
            <MonitorPanel buffers={buffers} vitals={vitals} />
          </div>
          <div className="flex-[2] min-h-0 flex flex-row border-b border-border">
            <div className="flex-1 min-h-0 p-1">
              <VentilatorPanel buffers={buffers} measured={measured} settings={settings} />
            </div>
            <div className="w-[120px] shrink-0 border-l border-border p-0.5">
              <LungAnimation patient={patient} settings={settings} buffers={buffers} vitals={vitals} compact prone={prone} />
            </div>
          </div>

          <div className="text-center py-0.5 bg-secondary border-t border-border shrink-0">
            <span className="text-[8px] text-muted-foreground/50 tracking-wide">
              App created by Dr Rob Coe BA MA OXON MBBS FRCA FFICM
            </span>
          </div>
          <div className="flex border-t border-border bg-secondary shrink-0">
            <button
              onClick={() => setMobileOverlay(mobileOverlay === 'controls' ? 'none' : 'controls')}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] transition-colors
                ${mobileOverlay === 'controls' ? 'text-primary bg-muted' : 'text-muted-foreground'}`}
            >
              <Settings className="w-4 h-4" />
              Settings
            </button>
            <button
              onClick={() => setMobileOverlay(mobileOverlay === 'patients' ? 'none' : 'patients')}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] transition-colors
                ${mobileOverlay === 'patients' ? 'text-primary bg-muted' : 'text-muted-foreground'}`}
            >
              <Users className="w-4 h-4" />
              Patient
            </button>
            <button
              onClick={() => setMobileOverlay(mobileOverlay === 'feedback' ? 'none' : 'feedback')}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] transition-colors
                ${mobileOverlay === 'feedback' ? 'text-primary bg-muted' : 'text-muted-foreground'}`}
            >
              <Stethoscope className="w-4 h-4" />
              Clinical
            </button>
            <button
              onClick={() => setMobileOverlay(mobileOverlay === 'tutorial' ? 'none' : 'tutorial')}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] transition-colors
                ${mobileOverlay === 'tutorial' ? 'text-primary bg-muted' : 'text-muted-foreground'}`}
            >
              <GraduationCap className="w-4 h-4" />
              Tutorial
            </button>
          </div>

          {mobileOverlay !== 'none' && (
            <div className="absolute bottom-[44px] left-0 right-0 bg-background border-t border-border max-h-[60vh] overflow-y-auto z-50 p-2 shadow-lg">
              {mobileOverlay === 'controls' && (
                <VentilatorControls settings={settings} onUpdate={simulationStore.updateSettings} />
              )}
              {mobileOverlay === 'patients' && (
                <PatientSelector selectedPatient={patient} onSelectPatient={(p) => { simulationStore.setPatient(p); setMobileOverlay('none'); }} />
              )}
              {mobileOverlay === 'feedback' && (
                <ClinicalFeedback settings={settings} patient={patient} vitals={vitals} measured={measured} prone={prone} />
              )}
              {mobileOverlay === 'tutorial' && (
                <TutorialPanel patient={patient} settings={settings} allSettings={allSettings} vitals={vitals} measured={measured} onClose={() => setMobileOverlay('none')} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Index;
