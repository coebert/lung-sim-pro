import { WaveformCanvas } from './WaveformCanvas';
import { WaveformBuffers, MeasuredValues, VentSettings } from '@/lib/simulation/types';

interface VentilatorPanelProps {
  buffers: WaveformBuffers;
  measured: MeasuredValues;
  settings: VentSettings;
}

export function VentilatorPanel({ buffers, measured, settings }: VentilatorPanelProps) {
  // Dynamic ranges based on mode
  const maxPressure = Math.max(40, measured.peakPressure + 10);
  const maxFlow = 80;
  const maxVolume = Math.max(600, measured.measuredTV + 200);

  return (
    <div className="flex flex-col gap-1 h-full">
      <div className="flex items-center justify-between px-2 py-1 bg-secondary rounded-t">
        <span className="text-xs text-muted-foreground font-bold tracking-wider uppercase">
          Ventilator — {settings.mode}
        </span>
      </div>
      
      <div className="flex-1 flex flex-col gap-0.5 bg-monitor-bg rounded-b p-1">
        <WaveformCanvas
          data={buffers.pressure}
          color="hsl(55, 100%, 50%)"
          label="Paw"
          unit="cmH₂O"
          minValue={-5}
          maxValue={maxPressure}
          height={90}
        />
        <WaveformCanvas
          data={buffers.flow}
          color="hsl(180, 100%, 50%)"
          label="Flow"
          unit="L/min"
          minValue={-maxFlow}
          maxValue={maxFlow}
          height={90}
        />
        <WaveformCanvas
          data={buffers.volume}
          color="hsl(120, 100%, 45%)"
          label="Volume"
          unit="mL"
          minValue={0}
          maxValue={maxVolume}
          height={90}
        />
      </div>

      {/* Measured values bar */}
      <div className="grid grid-cols-4 gap-1 px-1">
        <MeasuredBox label="Ppeak" value={measured.peakPressure} unit="cmH₂O" color="hsl(55, 100%, 50%)" />
        <MeasuredBox label="Pmean" value={measured.meanPressure} unit="cmH₂O" color="hsl(55, 100%, 50%)" />
        <MeasuredBox label="VTe" value={measured.measuredTV} unit="mL" color="hsl(120, 100%, 45%)" />
        <MeasuredBox label="MV" value={measured.minuteVentilation} unit="L/min" color="hsl(120, 100%, 45%)" />
      </div>
    </div>
  );
}

function MeasuredBox({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <div className="bg-secondary rounded px-2 py-1 text-center">
      <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
      <div className="monitor-text text-sm font-bold" style={{ color }}>
        {typeof value === 'number' ? (value < 10 ? value.toFixed(1) : Math.round(value)) : value}
      </div>
      <div className="text-[9px] text-muted-foreground">{unit}</div>
    </div>
  );
}
