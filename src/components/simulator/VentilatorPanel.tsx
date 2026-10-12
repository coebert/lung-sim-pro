import { WaveformCanvas } from './WaveformCanvas';
import { LoopCanvas } from './LoopCanvas';
import { useMemo } from 'react';
import { WaveformBuffers, MeasuredValues, VentSettings, PatientPhysiology } from '@/lib/simulation/types';
import { pvLoopPressures } from '@/lib/simulation/pvLoop';
import type { Alarm } from '@/lib/simulation/alarms';
import { WAVE_COLOR } from '@/lib/theme';

interface VentilatorPanelProps {
  buffers: WaveformBuffers;
  measured: MeasuredValues;
  settings: VentSettings;
  compact?: boolean;
  /** Active alarms, shown Dräger-style in the header message fields. */
  alarms?: Alarm[];
  /** Patient mechanics, used to draw a non-linear P–V loop. */
  patient?: PatientPhysiology;
}

const MODE_NAME: Record<VentSettings['mode'], string> = {
  VCV: 'VC-CMV',
  PCV: 'PC-CMV',
  PRVC: 'PC-CMV + AutoFlow',
  SIMV: 'VC-SIMV',
  PSV: 'SPN-CPAP/PS',
  APRV: 'PC-APRV',
};

/**
 * Ventilator screen styled after a Dräger Evita / V500: header with mode and
 * alarm message fields, three stacked curves, measured values down the right.
 */
export function VentilatorPanel({ buffers, measured, settings, compact = false, alarms = [], patient }: VentilatorPanelProps) {
  const pvX = useMemo(
    () => (patient ? pvLoopPressures(buffers.pressure, buffers.flow, settings, patient) : buffers.pressure),
    [buffers.pressure, buffers.flow, settings, patient],
  );
  const maxPressure = Math.max(40, measured.peakPressure + 10);
  // Fit fast APRV releases / high peak flows instead of clipping them.
  let flowAbsMax = 0;
  for (const f of buffers.flow) if (Math.abs(f) > flowAbsMax) flowAbsMax = Math.abs(f);
  const maxFlow = Math.max(80, Math.ceil((flowAbsMax * 1.1) / 20) * 20);
  // Scale the volume axis from the actual trace, not just the tidal swing:
  // APRV and stacked breaths carry trapped volume on top of VTe, so a
  // VTe-based scale clips the top of the loop off the chart.
  let traceVolMax = 0;
  for (const v of buffers.volume) if (v > traceVolMax) traceVolMax = v;
  const maxVolume = Math.max(600, measured.measuredTV + 200, Math.ceil((traceVolMax * 1.1) / 50) * 50);
  // P–V loop axes fit the loop's own data (incl. any beak shaping beyond
  // measured Ppeak) with headroom, so loops never clip and bends aren't squashed.
  let loopPMax = 0;
  for (const p of pvX) if (p > loopPMax) loopPMax = p;
  const loopPRange = Math.max(20, Math.ceil((loopPMax * 1.15) / 5) * 5);
  const loopVRange = Math.max(300, Math.ceil((traceVolMax * 1.15) / 50) * 50);
  const active = alarms.filter((a) => a.active)
    .sort((a, b) => (a.severity === 'high' ? -1 : 0) - (b.severity === 'high' ? -1 : 0));
  const isAPRV = settings.mode === 'APRV';
  const fmt = (v: number) => (v < 10 ? v.toFixed(1) : String(Math.round(v)));

  return (
    <div className="flex flex-col h-full rounded-md overflow-hidden border border-vent-tile-border bg-vent-screen">
      {!compact && (
        <div className="flex items-stretch gap-1 px-1 py-1 bg-vent-header shrink-0 min-h-[30px]">
          <div className="rounded px-2 flex items-center bg-vent-select text-vent-select-foreground text-xs font-bold monitor-text whitespace-nowrap">
            {MODE_NAME[settings.mode]}
          </div>
          <div className="rounded px-2 flex items-center bg-vent-tile text-[10px] text-vent-label whitespace-nowrap">Adult · Tube</div>
          <div className="flex-1 grid grid-cols-2 gap-1 min-w-0" aria-live="polite">
            {[0, 1].map((i) => {
              const a = active[i];
              const cls = !a
                ? 'bg-vent-tile text-vent-label'
                : a.severity === 'high'
                  ? 'bg-destructive text-destructive-foreground font-bold'
                  : 'bg-warning text-warning-foreground font-bold';
              return (
                <div key={i} className={`rounded px-2 flex items-center text-[10px] truncate ${cls}`}>
                  {a ? `${a.severity === 'high' ? '!!! ' : '!! '}${a.label}` : i === 0 ? 'No alarms' : ''}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex-1 flex min-h-0 p-1 gap-1 overflow-hidden">
        <div className="flex-1 flex flex-col gap-0.5 min-w-0 min-h-0">
          <WaveformCanvas data={buffers.pressure} color={WAVE_COLOR.pressure} label="Paw" unit="cmH₂O"
            minValue={-5} maxValue={maxPressure} autoHeight />
          <WaveformCanvas data={buffers.flow} color={WAVE_COLOR.flow} label="Flow" unit="L/min"
            minValue={-maxFlow} maxValue={maxFlow} autoHeight
            markers={isAPRV ? buffers.aprvCycleMarkers : undefined}
            markerLabel={isAPRV ? 'cycle back to P High' : undefined} />
          <WaveformCanvas data={buffers.volume} color={WAVE_COLOR.volume} label="Volume" unit="mL"
            minValue={0} maxValue={maxVolume} autoHeight />
        </div>

        {!compact && (
          <div className="hidden min-[480px]:flex flex-col gap-1 w-[200px] shrink-0 min-h-0">
            <div className="flex-1 min-h-0 border border-vent-tile-border rounded">
              <LoopCanvas x={pvX} y={buffers.volume} label="P–V loop"
                xRange={[0, loopPRange]} yRange={[0, loopVRange]}
                color={WAVE_COLOR.pressure} xUnit="cmH₂O" yUnit="mL" />
            </div>
            <div className="flex-1 min-h-0 border border-vent-tile-border rounded">
              <LoopCanvas x={buffers.volume} y={buffers.flow} label="F–V loop"
                xRange={[0, loopVRange]} yRange={[-maxFlow, maxFlow]}
                color={WAVE_COLOR.flow} xUnit="mL" yUnit="L/min" />
            </div>
          </div>
        )}

        <div className={`flex flex-col gap-1 ${compact ? 'w-[64px]' : 'w-[104px]'} shrink-0 overflow-y-auto`}>
          <Group compact={compact} color={WAVE_COLOR.pressure} rows={[
            ['Ppeak', fmt(measured.peakPressure), 'cmH₂O'],
            ...(isAPRV ? [] : [['Pplat', fmt(measured.plateauPressure), 'cmH₂O'] as Row]),
            ['Pmean', fmt(measured.meanPressure), 'cmH₂O'],
            [isAPRV ? 'P Low' : 'PEEP', fmt(isAPRV ? settings.pLow : settings.peep), 'cmH₂O'],
            ['PEEPi', fmt(measured.autoPEEP), 'cmH₂O'],
          ]} />
          <Group compact={compact} color={WAVE_COLOR.volume} rows={[
            ['VTe', String(Math.round(measured.measuredTV)), 'mL'],
            ['MVe', measured.minuteVentilation.toFixed(1), 'L/min'],
            ['ftot', String(Math.round(measured.measuredRR)), '/min'],
          ]} />
          <Group compact={compact} color={WAVE_COLOR.flow} rows={[
            ['FiO₂', String(Math.round(settings.fio2 * 100)), '%'],
            ['Cdyn', fmt(measured.dynamicCompliance), 'mL/cmH₂O'],
          ]} />
        </div>
      </div>
    </div>
  );
}

type Row = [string, string, string];

function Group({ rows, color, compact }: { rows: Row[]; color: string; compact: boolean }) {
  return (
    <div className="rounded bg-vent-tile border border-vent-tile-border divide-y divide-vent-tile-border">
      {rows.map(([label, value, unit]) => (
        <div key={label} className={compact ? 'px-1 py-0.5' : 'px-1.5 py-0.5'}>
          <div className="flex items-baseline justify-between gap-1">
            <span className={`${compact ? 'text-[8px]' : 'text-[10px]'} text-vent-label`}>{label}</span>
            {!compact && <span className="text-[8px] text-vent-label">{unit}</span>}
          </div>
          <div className={`monitor-text font-bold text-right leading-tight ${compact ? 'text-xs' : 'text-base'}`} style={{ color }}>
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}
