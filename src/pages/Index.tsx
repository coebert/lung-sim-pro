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
import { Pause, Play, GraduationCap, ChevronLeft, RotateCcw } from 'lucide-react';
import { AlarmBanner } from '@/components/simulator/AlarmBanner';
import { LungAnimation } from '@/components/simulator/LungAnimation';
import { ClinicalFeedback } from '@/components/simulator/ClinicalFeedback';
import { TutorialPanel } from '@/components/simulator/TutorialPanel';
import { MobileBottomNav, MobileOverlayPanel, type MobileOverlay } from '@/components/simulator/MobileShell';
import { VITAL_COLOR, spo2Color } from '@/lib/theme';

const AUTHOR_CREDIT = 'App created by Dr Rob Coe BA MA OXON MBBS FRCA FFICM';

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
      <span style={{ color: VITAL_COLOR.hr }}>HR {Math.round(vitals.hr)}</span>
      <span style={{ color: VITAL_COLOR.abp }}>BP {Math.round(vitals.sbp)}/{Math.round(vitals.dbp)}</span>
      <span style={{ color: spo2Color(vitals.spo2) }}>
        SpO₂ {Math.round(vitals.spo2)}%
      </span>
      <span style={{ color: VITAL_COLOR.etco2 }}>EtCO₂ {(vitals.etco2 / 7.501).toFixed(1)} kPa</span>
    </div>
  );

  const overlayProps = {
    overlay: mobileOverlay,
    onClose: () => setMobileOverlay('none'),
    settings, allSettings, patient, vitals, measured, prone,
  };

  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden">
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
              className={`p-1 rounded transition-colors flex items-center gap-1 ${prone ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
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
              <span className="text-[8px] text-muted-foreground/50 tracking-wide">{AUTHOR_CREDIT}</span>
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
          <MobileBottomNav variant="landscape" overlay={mobileOverlay} onOverlayChange={setMobileOverlay} />
          <MobileOverlayPanel {...overlayProps} bottomOffset={24} maxHeight="55vh" />
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
            <span className="text-[8px] text-muted-foreground/50 tracking-wide">{AUTHOR_CREDIT}</span>
          </div>
          <MobileBottomNav variant="portrait" overlay={mobileOverlay} onOverlayChange={setMobileOverlay} />
          <MobileOverlayPanel {...overlayProps} bottomOffset={44} maxHeight="60vh" />
        </div>
      )}
    </div>
  );
};

export default Index;
