import { useState, useEffect, useRef, useCallback } from 'react';
import { useLayoutMode } from '@/hooks/use-layout-mode';
import { VentilatorPanel } from '@/components/simulator/VentilatorPanel';
import { MonitorPanel } from '@/components/simulator/MonitorPanel';
import { VentilatorControls } from '@/components/simulator/VentilatorControls';
import { PatientSelector } from '@/components/simulator/PatientSelector';
import { VentSettings, PatientPhysiology, Vitals, MeasuredValues, WaveformBuffers } from '@/lib/simulation/types';
import { patients, getDefaultSettings } from '@/lib/simulation/patients';
import { createInitialBuffers, createInitialVitals, simulationTick } from '@/lib/simulation/engine';
import { Settings, Users } from 'lucide-react';
import { AlarmBanner } from '@/components/simulator/AlarmBanner';
import { evaluateAlarms, DEFAULT_ALARM_LIMITS, Alarm } from '@/lib/simulation/alarms';

type MobileOverlay = 'none' | 'controls' | 'patients';

const Index = () => {
  const layoutMode = useLayoutMode();
  const isDesktop = layoutMode === 'desktop';
  const isLandscape = layoutMode === 'mobile-landscape';
  const isPortrait = layoutMode === 'mobile-portrait';

  const [patient, setPatient] = useState<PatientPhysiology>(patients[0]);
  const [settings, setSettings] = useState<VentSettings>(getDefaultSettings(patients[0]));
  const [vitals, setVitals] = useState<Vitals>(createInitialVitals(patients[0]));
  const [measured, setMeasured] = useState<MeasuredValues>({
    peakPressure: 0, plateauPressure: 0, meanPressure: 0,
    measuredTV: 0, minuteVentilation: 0, measuredRR: 14, dynamicCompliance: 0,
  });
  const [buffers, setBuffers] = useState<WaveformBuffers>(createInitialBuffers());
  const [mobileOverlay, setMobileOverlay] = useState<MobileOverlay>('none');
  const [alarms, setAlarms] = useState<Alarm[]>([]);

  const timeRef = useRef(0);
  const settingsRef = useRef(settings);
  const patientRef = useRef(patient);
  const vitalsRef = useRef(vitals);
  const buffersRef = useRef(buffers);

  settingsRef.current = settings;
  patientRef.current = patient;

  const handlePatientChange = useCallback((newPatient: PatientPhysiology) => {
    setPatient(newPatient);
    const newVitals = createInitialVitals(newPatient);
    setVitals(newVitals);
    vitalsRef.current = newVitals;
    const newBuffers = createInitialBuffers();
    setBuffers(newBuffers);
    buffersRef.current = newBuffers;
    timeRef.current = 0;
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      timeRef.current += 0.02;
      const result = simulationTick(
        timeRef.current,
        settingsRef.current,
        patientRef.current,
        vitalsRef.current,
        buffersRef.current
      );
      vitalsRef.current = result.vitals;
      buffersRef.current = result.buffers;
      setVitals(result.vitals);
      setMeasured(result.measured);
      setBuffers(result.buffers);
      setAlarms(evaluateAlarms(result.measured, result.vitals, DEFAULT_ALARM_LIMITS));
    }, 20);
    return () => clearInterval(interval);
  }, []);

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
            <div className="w-2 h-2 rounded-full bg-wave-ecg animate-pulse" />
            <h1 className="text-xs sm:text-sm font-bold text-foreground tracking-wide whitespace-nowrap">
              ICU Vent Sim
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
            <div className="flex-1 flex flex-col border-r border-border min-w-0">
              <div className="flex-1 min-h-0 p-1">
                <VentilatorPanel buffers={buffers} measured={measured} settings={settings} />
              </div>
              <div className="border-t border-border p-2">
                <VentilatorControls settings={settings} onSettingsChange={setSettings} />
              </div>
            </div>
            <div className="flex-1 flex flex-col min-w-0 border-l border-border">
              <div className="flex-1 min-h-0 p-1">
                <MonitorPanel buffers={buffers} vitals={vitals} />
              </div>
            </div>
          </div>
          <div className="border-t border-border p-2 shrink-0">
            <PatientSelector selectedPatient={patient} onSelectPatient={handlePatientChange} />
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
            {/* Left: Ventilator */}
            <div className="flex-1 min-h-0 min-w-0 p-0.5 border-r border-border">
              <VentilatorPanel buffers={buffers} measured={measured} settings={settings} compact />
            </div>
            {/* Right: Monitor */}
            <div className="flex-1 min-h-0 min-w-0 p-0.5">
              <MonitorPanel buffers={buffers} vitals={vitals} compact />
            </div>
          </div>

          {/* Slim bottom bar */}
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
          </div>

          {/* Slide-up overlay */}
          {mobileOverlay !== 'none' && (
            <div className="absolute bottom-[24px] left-0 right-0 bg-background border-t border-border max-h-[55vh] overflow-y-auto z-50 p-2 shadow-lg">
              {mobileOverlay === 'controls' && (
                <VentilatorControls settings={settings} onSettingsChange={setSettings} />
              )}
              {mobileOverlay === 'patients' && (
                <PatientSelector selectedPatient={patient} onSelectPatient={(p) => { handlePatientChange(p); setMobileOverlay('none'); }} />
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== MOBILE PORTRAIT ===== */}
      {isPortrait && (
        <div className="flex-1 flex flex-col min-h-0 relative">
          <div className="flex-1 min-h-0 p-1 border-b border-border">
            <MonitorPanel buffers={buffers} vitals={vitals} />
          </div>
          <div className="flex-1 min-h-0 p-1">
            <VentilatorPanel buffers={buffers} measured={measured} settings={settings} />
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
          </div>

          {/* Slide-up overlay */}
          {mobileOverlay !== 'none' && (
            <div className="absolute bottom-[44px] left-0 right-0 bg-background border-t border-border max-h-[60vh] overflow-y-auto z-50 p-2 shadow-lg">
              {mobileOverlay === 'controls' && (
                <VentilatorControls settings={settings} onSettingsChange={setSettings} />
              )}
              {mobileOverlay === 'patients' && (
                <PatientSelector selectedPatient={patient} onSelectPatient={(p) => { handlePatientChange(p); setMobileOverlay('none'); }} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Index;
