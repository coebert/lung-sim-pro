import { useState, useEffect, useRef, useCallback } from 'react';
import { VentilatorPanel } from '@/components/simulator/VentilatorPanel';
import { MonitorPanel } from '@/components/simulator/MonitorPanel';
import { VentilatorControls } from '@/components/simulator/VentilatorControls';
import { PatientSelector } from '@/components/simulator/PatientSelector';
import { VentSettings, PatientPhysiology, Vitals, MeasuredValues, WaveformBuffers } from '@/lib/simulation/types';
import { patients, getDefaultSettings } from '@/lib/simulation/patients';
import { createInitialBuffers, createInitialVitals, simulationTick } from '@/lib/simulation/engine';

const Index = () => {
  const [patient, setPatient] = useState<PatientPhysiology>(patients[0]);
  const [settings, setSettings] = useState<VentSettings>(getDefaultSettings(patients[0]));
  const [vitals, setVitals] = useState<Vitals>(createInitialVitals(patients[0]));
  const [measured, setMeasured] = useState<MeasuredValues>({
    peakPressure: 0, plateauPressure: 0, meanPressure: 0,
    measuredTV: 0, minuteVentilation: 0, measuredRR: 14, dynamicCompliance: 0,
  });
  const [buffers, setBuffers] = useState<WaveformBuffers>(createInitialBuffers());

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
      timeRef.current += 0.02; // 50Hz
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
    }, 20);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-secondary border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-wave-ecg animate-pulse" />
          <h1 className="text-sm font-bold text-foreground tracking-wide">
            ICU Ventilator Simulator
          </h1>
        </div>
        <div className="text-[10px] text-muted-foreground monitor-text">
          Patient: {patient.name} | C: {patient.compliance} mL/cmH₂O | R: {patient.resistance} cmH₂O/L/s
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Ventilator waveforms + controls */}
        <div className="flex-1 flex flex-col border-r border-border min-w-0">
          <div className="flex-1 min-h-0 p-1">
            <VentilatorPanel buffers={buffers} measured={measured} settings={settings} />
          </div>
          <div className="border-t border-border p-2">
            <VentilatorControls settings={settings} onSettingsChange={setSettings} />
          </div>
        </div>

        {/* Right: Patient monitor */}
        <div className="w-[380px] flex flex-col min-h-0">
          <div className="flex-1 min-h-0 p-1">
            <MonitorPanel buffers={buffers} vitals={vitals} />
          </div>
        </div>
      </div>

      {/* Bottom: Patient selector */}
      <div className="border-t border-border p-2">
        <PatientSelector selectedPatient={patient} onSelectPatient={handlePatientChange} />
      </div>
    </div>
  );
};

export default Index;
