import { useState } from 'react';
import { WaveformCanvas } from './WaveformCanvas';
import { VentilatorControls } from './VentilatorControls';
import { WaveformBuffers, MeasuredValues, VentSettings } from '@/lib/simulation/types';
import { WAVE_COLOR } from '@/lib/theme';

interface BedsideViewProps {
  buffers: WaveformBuffers;
  measured: MeasuredValues;
  settings: VentSettings;
  etco2KPa: number;
  onUpdate: (patch: Partial<VentSettings>) => void;
}

type TraceKey = 'pressure' | 'flow' | 'volume';

const TRACE: Record<TraceKey, { label: string; unit: string; color: string }> = {
  pressure: { label: 'Paw', unit: 'cmH₂O', color: WAVE_COLOR.pressure },
  flow: { label: 'Flow', unit: 'L/min', color: WAVE_COLOR.flow },
  volume: { label: 'Volume', unit: 'mL', color: WAVE_COLOR.volume },
};

/**
 * Bedside view: one large, easy-to-read waveform with the ventilator settings
 * beneath it and a small measured-values strip (Ppeak, Pplat, VTe, EtCO₂) —
 * like glancing at a single screen at the foot of the bed.
 */
export function BedsideView({ buffers, measured, settings, etco2KPa, onUpdate }: BedsideViewProps) {
  const [trace, setTrace] = useState<TraceKey>('pressure');
  const isAPRV = settings.mode === 'APRV';
  const t = TRACE[trace];

  const range: [number, number] =
    trace === 'pressure'
      ? [-5, Math.max(40, measured.peakPressure + 10)]
      : trace === 'flow'
        ? [-80, 80]
        : [0, Math.max(600, measured.measuredTV + 200)];

  const fmt = (v: number) => (v < 10 ? v.toFixed(1) : String(Math.round(v)));

  const readings: { label: string; value: string; unit: string; color: string }[] = [
    { label: 'Ppeak', value: fmt(measured.peakPressure), unit: 'cmH₂O', color: WAVE_COLOR.pressure },
    { label: 'Pplat', value: isAPRV ? '—' : fmt(measured.plateauPressure), unit: 'cmH₂O', color: WAVE_COLOR.pressure },
    { label: 'VTe', value: String(Math.round(measured.measuredTV)), unit: 'mL', color: WAVE_COLOR.volume },
    { label: 'EtCO₂', value: etco2KPa.toFixed(1), unit: 'kPa', color: WAVE_COLOR.flow },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 gap-1 p-1">
      {/* Trace selector */}
      <div className="flex items-center gap-1 shrink-0" role="tablist" aria-label="Waveform selection">
        {(Object.keys(TRACE) as TraceKey[]).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={trace === key}
            onClick={() => setTrace(key)}
            className={`px-3 py-1 rounded text-xs font-bold monitor-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              trace === key
                ? 'bg-vent-select text-vent-select-foreground'
                : 'bg-vent-tile text-vent-label hover:bg-muted'
            }`}
          >
            {TRACE[key].label}
          </button>
        ))}
      </div>

      {/* Single large waveform */}
      <div className="flex-1 min-h-0 rounded-md border border-vent-tile-border bg-vent-screen p-1">
        <WaveformCanvas
          data={buffers[trace]}
          color={t.color}
          label={t.label}
          unit={t.unit}
          minValue={range[0]}
          maxValue={range[1]}
          autoHeight
          markers={trace === 'flow' && isAPRV ? buffers.aprvCycleMarkers : undefined}
          markerLabel={trace === 'flow' && isAPRV ? 'cycle back to P High' : undefined}
        />
      </div>

      {/* Small measured-values strip */}
      <div className="grid grid-cols-4 gap-1 shrink-0">
        {readings.map(({ label, value, unit, color }) => (
          <div key={label} className="rounded bg-vent-tile border border-vent-tile-border px-2 py-1">
            <div className="flex items-baseline justify-between gap-1">
              <span className="text-[10px] text-vent-label">{label}</span>
              <span className="text-[9px] text-vent-label">{unit}</span>
            </div>
            <div className="monitor-text font-bold text-right text-lg leading-tight" style={{ color }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Settings */}
      <div className="shrink-0 border-t border-border pt-1 bg-vent-screen rounded-md">
        <VentilatorControls settings={settings} onUpdate={onUpdate} />
      </div>
    </div>
  );
}
