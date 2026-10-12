import { WaveformCanvas } from './WaveformCanvas';
import { VentilatorControls } from './VentilatorControls';
import { WaveformBuffers, MeasuredValues, VentSettings, PatientPhysiology } from '@/lib/simulation/types';
import { WAVE_COLOR } from '@/lib/theme';

interface BedsideViewProps {
  buffers: WaveformBuffers;
  measured: MeasuredValues;
  settings: VentSettings;
  etco2KPa: number;
  patient?: PatientPhysiology;
  onUpdate: (patch: Partial<VentSettings>) => void;
  fullVentilator?: boolean;
}

type TraceKey = 'pressure' | 'flow' | 'volume';

const TRACE: Record<TraceKey, { label: string; unit: string; color: string }> = {
  pressure: { label: 'Paw', unit: 'cmH₂O', color: WAVE_COLOR.pressure },
  flow: { label: 'Flow', unit: 'L/min', color: WAVE_COLOR.flow },
  volume: { label: 'Volume', unit: 'mL', color: WAVE_COLOR.volume },
};

/**
 * Bedside view: live pressure, flow and volume waveforms and a capnogram with the ventilator settings
 * beneath it and a small measured-values strip (Ppeak, Pplat, VTe, EtCO₂) —
 * like glancing at a single screen at the foot of the bed.
 */
export function BedsideView({ buffers, measured, settings, etco2KPa, patient, onUpdate, fullVentilator = false }: BedsideViewProps) {
  const isAPRV = settings.mode === 'APRV';

  const fmt = (v: number) => (v < 10 ? v.toFixed(1) : String(Math.round(v)));

  const readings: { label: string; value: string; unit: string; color: string }[] = [
    { label: 'Ppeak', value: fmt(measured.peakPressure), unit: 'cmH₂O', color: WAVE_COLOR.pressure },
    { label: 'Pplat', value: isAPRV ? '—' : fmt(measured.plateauPressure), unit: 'cmH₂O', color: WAVE_COLOR.pressure },
    { label: 'VTe', value: String(Math.round(measured.measuredTV)), unit: 'mL', color: WAVE_COLOR.volume },
    { label: 'EtCO₂', value: etco2KPa.toFixed(1), unit: 'kPa', color: WAVE_COLOR.capno },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 gap-1 p-1 overflow-y-auto">
      {/* All three traces share the simulator's live waveform buffers. */}
      <div className={`flex-1 flex flex-col gap-1 rounded-md border border-vent-tile-border bg-vent-screen p-1 ${fullVentilator ? 'min-h-[240px]' : 'min-h-[234px]'}`}>
        {(Object.keys(TRACE) as TraceKey[]).map((key) => {
          const data = buffers[key];
          const lower = key === 'pressure' ? -5 : key === 'flow' ? -80 : 0;
          const upper = key === 'pressure' ? Math.max(40, measured.peakPressure + 10) : key === 'flow' ? 80 : Math.max(600, measured.measuredTV + 200);
          const minValue = Math.min(lower, ...data);
          const maxValue = Math.max(upper, ...data.map((value) => value * 1.1));
          return <section key={key} aria-label={`${TRACE[key].label} waveform`} className="flex flex-col flex-1 min-h-0">
            <WaveformCanvas data={data} color={TRACE[key].color} label={TRACE[key].label} unit={TRACE[key].unit}
              minValue={minValue} maxValue={maxValue} autoHeight
              markers={key === 'flow' && isAPRV ? buffers.aprvCycleMarkers : undefined}
              markerLabel={key === 'flow' && isAPRV ? 'cycle back to P High' : undefined} />
          </section>;
        })}
      </div>

      {!fullVentilator && (
        <section aria-label="CO₂ capnogram" className="flex flex-col flex-[0.4] min-h-[76px] max-h-[140px] rounded-md border border-vent-tile-border bg-vent-screen p-1">
          <WaveformCanvas
            data={buffers.capno.map((value) => value / 7.501)}
            color={WAVE_COLOR.capno}
            label="CO₂"
            unit="kPa"
            minValue={-0.5}
            maxValue={Math.max(8, etco2KPa * 1.2, ...buffers.capno.map((value) => value / 7.501 * 1.1))}
            autoHeight
          />
        </section>
      )}

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
      <div className={`shrink-0 border-t border-border pt-1 bg-vent-screen rounded-md overflow-y-auto ${fullVentilator ? 'max-h-[38vh]' : 'max-h-[32vh]'}`}>
        <VentilatorControls settings={settings} patient={patient} onUpdate={onUpdate} />
      </div>
    </div>
  );
}
