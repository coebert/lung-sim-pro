import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { BedsideView } from '@/components/simulator/BedsideView';
import { AlarmBanner } from '@/components/simulator/AlarmBanner';
import { PatientDropdown } from '@/components/simulator/PatientDropdown';
import {
  simulationStore,
  useWaveforms,
  useVitalsSnapshot,
  useControls,
} from '@/lib/simulation/simulationStore';
import { Pause, Play, RotateCcw, ArrowLeft, Activity, BedSingle } from 'lucide-react';
import { VITAL_COLOR, spo2Color } from '@/lib/theme';

/**
 * Standalone bedside page (/bedside): one large waveform, the key measured
 * values and the full settings tiles — nothing else. Meant for walking
 * through scenarios at the bedside or on a projector.
 */
const Bedside = ({ fullVentilator = false }: { fullVentilator?: boolean }) => {
  const { settings, patient, prone, frozen } = useControls();
  const { vitals, measured, alarms } = useVitalsSnapshot();
  const buffers = useWaveforms();

  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden">
      <AlarmBanner alarms={alarms} />
      <div className="flex flex-wrap items-center justify-between bg-secondary border-b border-border gap-2 shrink-0 px-3 py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            to="/"
            aria-label="Back to full simulator"
            className="p-1 rounded transition-colors hover:bg-muted text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Back to full simulator"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </Link>
          <Button variant="ghost" size="icon"
            onClick={simulationStore.toggleFrozen}
            aria-label={frozen ? 'Resume waveforms' : 'Freeze waveforms'}
            aria-pressed={frozen}
            className={`h-7 w-7 p-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${frozen ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
            title={frozen ? 'Resume waveforms' : 'Freeze waveforms'}
          >
            {frozen ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
          </Button>
          <Button variant="ghost"
            onClick={simulationStore.toggleProne}
            aria-label={prone ? 'Return to supine position' : 'Prone positioning'}
            aria-pressed={prone}
            className={`h-7 px-1 rounded transition-colors flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${prone ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
            title={prone ? 'Return to supine position' : 'Prone positioning'}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {prone && <span className="text-[9px] font-bold">PRONE</span>}
          </Button>
          <Button asChild variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
            <Link to={fullVentilator ? '/bedside' : '/ventilator'} aria-label={fullVentilator ? 'Open bedside view' : 'Open ventilator view'} title={fullVentilator ? 'Bedside view' : 'Ventilator view'}>
              {fullVentilator ? <BedSingle /> : <Activity />}
            </Link>
          </Button>
          <h1 className="text-xs sm:text-sm font-bold text-foreground whitespace-nowrap">
            {fullVentilator ? 'Ventilator View' : 'Bedside View'}
            {frozen && <span className="ml-1.5 text-[10px] text-primary font-normal">FROZEN</span>}
          </h1>
        </div>
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center gap-3 text-[10px] monitor-text">
            <span style={{ color: VITAL_COLOR.hr }}>HR {Math.round(vitals.hr)}</span>
            <span style={{ color: VITAL_COLOR.abp }}>BP {Math.round(vitals.sbp)}/{Math.round(vitals.dbp)}</span>
            <span style={{ color: spo2Color(vitals.spo2) }}>SpO₂ {Math.round(vitals.spo2)}%</span>
          </div>
          <PatientDropdown
            selectedPatient={patient}
            onSelectPatient={simulationStore.setPatient}
            compact
          />
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <BedsideView
          buffers={buffers}
          measured={measured}
          settings={settings}
          etco2KPa={vitals.etco2 / 7.501}
          patient={patient}
          onUpdate={simulationStore.updateSettings}
          fullVentilator={fullVentilator}
        />
      </div>
    </div>
  );
};

export default Bedside;
