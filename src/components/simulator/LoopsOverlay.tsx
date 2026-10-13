import { useMemo } from 'react';
import { LoopCanvas } from './LoopCanvas';
import { WaveformBuffers, MeasuredValues, VentSettings, PatientPhysiology } from '@/lib/simulation/types';
import { pvLoopPressures } from '@/lib/simulation/pvLoop';
import { WAVE_COLOR } from '@/lib/theme';

interface LoopsOverlayProps {
  buffers: WaveformBuffers;
  measured: MeasuredValues;
  settings: VentSettings;
  patient?: PatientPhysiology;
}

/**
 * Full-size P–V and F–V loops for the mobile "Loops" sheet. Shares the
 * simulator's live buffers and the desktop panel's axis-fitting logic, so the
 * shapes match what desktop shows instead of a separate rendering.
 */
export function LoopsOverlay({ buffers, measured, settings, patient }: LoopsOverlayProps) {
  const pvX = useMemo(
    () => (patient ? pvLoopPressures(buffers.pressure, buffers.flow, settings, patient) : buffers.pressure),
    [buffers.pressure, buffers.flow, settings, patient],
  );

  // Axis fitting mirrors VentilatorPanel so loops never clip on either screen.
  let flowAbsMax = 0;
  for (const f of buffers.flow) if (Math.abs(f) > flowAbsMax) flowAbsMax = Math.abs(f);
  const maxFlow = Math.max(80, Math.ceil((flowAbsMax * 1.1) / 20) * 20);
  let traceVolMax = 0;
  for (const v of buffers.volume) if (v > traceVolMax) traceVolMax = v;
  let loopPMax = 0;
  for (const p of pvX) if (p > loopPMax) loopPMax = p;
  const loopPRange = Math.max(20, Math.ceil((loopPMax * 1.15) / 5) * 5);
  const loopVRange = Math.max(300, Math.ceil((traceVolMax * 1.15) / 50) * 50);

  return (
    <div className="flex flex-col gap-2 h-[min(60vh,480px)]" aria-label="Respiratory mechanics loops">
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
  );
}
