import { WaveformCanvas } from './WaveformCanvas';
import { WaveformBuffers, MeasuredValues, VentSettings } from '@/lib/simulation/types';

interface VentilatorPanelProps {
  buffers: WaveformBuffers;
  measured: MeasuredValues;
  settings: VentSettings;
  compact?: boolean;
}

export function VentilatorPanel({ buffers, measured, settings, compact = false }: VentilatorPanelProps) {
  const maxPressure = Math.max(40, measured.peakPressure + 10);
  const maxFlow = 80;
  const maxVolume = Math.max(600, measured.measuredTV + 200);

  return (
    <div className="flex flex-col gap-0.5 h-full">
      {!compact && (
        <div className="flex items-center justify-between px-2 py-1 bg-secondary rounded-t shrink-0">
          <span className="text-xs text-muted-foreground font-bold tracking-wider uppercase">
            Ventilator — {settings.mode}
          </span>
        </div>
      )}
      
      <div className="flex-1 flex min-h-0 bg-monitor-bg rounded-b p-1 gap-1 overflow-hidden">
        {/* Waveforms */}
        <div className="flex-1 flex flex-col gap-0.5 min-w-0 min-h-0">
          <WaveformCanvas
            data={buffers.pressure}
            color="hsl(55, 100%, 50%)"
            label="Paw"
            unit="cmH₂O"
            minValue={-5}
            maxValue={maxPressure}
            autoHeight
          />
          <WaveformCanvas
            data={buffers.flow}
            color="hsl(180, 100%, 50%)"
            label="Flow"
            unit="L/min"
            minValue={-maxFlow}
            maxValue={maxFlow}
            autoHeight
          />
          <WaveformCanvas
            data={buffers.volume}
            color="hsl(120, 100%, 45%)"
            label="Volume"
            unit="mL"
            minValue={0}
            maxValue={maxVolume}
            autoHeight
          />
        </div>
        {/* Numerical values - right side */}
        <div className={`flex flex-col gap-0.5 ${compact ? 'w-[60px]' : 'w-[90px]'} shrink-0 overflow-y-auto`}>
          <MeasuredBox label="PIP" value={measured.peakPressure} unit="cmH₂O" color="hsl(55, 100%, 50%)" compact={compact} />
          <MeasuredBox label="PEEP" value={settings.peep} unit="cmH₂O" color="hsl(55, 100%, 50%)" compact={compact} />
          <MeasuredBox label="Pmean" value={measured.meanPressure} unit="cmH₂O" color="hsl(55, 100%, 50%)" compact={compact} />
          <MeasuredBox label="VTe" value={measured.measuredTV} unit="mL" color="hsl(120, 100%, 45%)" compact={compact} />
          <MeasuredBox label="MV" value={measured.minuteVentilation} unit="L/min" color="hsl(120, 100%, 45%)" compact={compact} />
          <MeasuredBox label="Cdyn" value={measured.dynamicCompliance} unit="mL/cmH₂O" color="hsl(180, 100%, 50%)" compact={compact} />
        </div>
      </div>
    </div>
  );
}

function MeasuredBox({ label, value, unit, color, compact = false }: { label: string; value: number; unit: string; color: string; compact?: boolean }) {
  return (
    <div className={`bg-secondary rounded ${compact ? 'px-1 py-0.5' : 'px-2 py-1'} text-center`}>
      <div className={`${compact ? 'text-[8px]' : 'text-[10px]'} text-muted-foreground uppercase`}>{label}</div>
      <div className={`monitor-text ${compact ? 'text-xs' : 'text-sm'} font-bold`} style={{ color }}>
        {typeof value === 'number' ? (value < 10 ? value.toFixed(1) : Math.round(value)) : value}
      </div>
      {!compact && <div className="text-[9px] text-muted-foreground">{unit}</div>}
    </div>
  );
}
