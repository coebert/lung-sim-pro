import { WaveformCanvas } from './WaveformCanvas';
import { WaveformBuffers, Vitals } from '@/lib/simulation/types';
import { VITAL_COLOR, WAVE_COLOR, spo2Color, hrColor } from '@/lib/theme';

interface MonitorPanelProps {
  buffers: WaveformBuffers;
  vitals: Vitals;
  compact?: boolean;
}

export function MonitorPanel({ buffers, vitals, compact = false }: MonitorPanelProps) {
  const spo2C = spo2Color(vitals.spo2);
  const hrC = hrColor(vitals.hr);

  const numSize = compact ? 'text-lg' : 'text-2xl';
  const labelSize = compact ? 'text-[8px]' : 'text-[10px]';
  const subSize = compact ? 'text-[9px]' : 'text-xs';

  return (
    <div className="flex flex-col gap-0.5 h-full">
      {!compact && (
        <div className="flex items-center justify-between px-2 py-1 bg-secondary rounded-t shrink-0">
          <span className="text-xs text-muted-foreground font-bold tracking-wider uppercase">
            Patient Monitor
          </span>
        </div>
      )}
      
      <div className="flex-1 flex flex-col gap-0.5 bg-monitor-bg rounded-b p-1 min-h-0 overflow-hidden">
        {/* ECG */}
        <div className="relative flex-1 min-h-0 flex flex-col">
          <WaveformCanvas
            data={buffers.ecg}
            color={WAVE_COLOR.ecg}
            label="II"
            unit="ECG"
            minValue={-0.5}
            maxValue={1.5}
            autoHeight
          />
          <div className="absolute top-0 right-1 text-right">
            <div className={labelSize} style={{ color: VITAL_COLOR.hr }}>HR</div>
            <div className={`monitor-text ${numSize} font-bold`} style={{ color: hrC }}>
              {Math.round(vitals.hr)}
            </div>
          </div>
        </div>

        {/* ABP */}
        <div className="relative flex-1 min-h-0 flex flex-col">
          <WaveformCanvas
            data={buffers.abp}
            color={WAVE_COLOR.abp}
            label="ABP"
            unit="mmHg"
            minValue={20}
            maxValue={180}
            autoHeight
          />
          <div className="absolute top-0 right-1 text-right" style={{ color: VITAL_COLOR.abp }}>
            <div className={labelSize}>ABP</div>
            <div className={`monitor-text ${compact ? 'text-sm' : 'text-lg'} font-bold`}>
              {Math.round(vitals.sbp)}/{Math.round(vitals.dbp)}
            </div>
            {!compact && (
              <div className={`monitor-text ${subSize}`}>
                ({Math.round(vitals.dbp + (vitals.sbp - vitals.dbp) / 3)})
              </div>
            )}
          </div>
        </div>

        {/* SpO2 */}
        <div className="relative flex-1 min-h-0 flex flex-col">
          <WaveformCanvas
            data={buffers.spo2Pleth}
            color={spo2C}
            label="Pleth"
            unit="SpO₂"
            minValue={-0.2}
            maxValue={1.3}
            autoHeight
          />
          <div className="absolute top-0 right-1 text-right" style={{ color: spo2C }}>
            <div className={labelSize}>SpO₂</div>
            <div className={`monitor-text ${numSize} font-bold`}>
              {Math.round(vitals.spo2)}
            </div>
          </div>
        </div>

        {/* Capnography */}
        <div className="relative flex-1 min-h-0 flex flex-col">
          <WaveformCanvas
            data={buffers.capno.map(v => v / 7.501)}
            color={WAVE_COLOR.capno}
            label="CO₂"
            unit="kPa"
            minValue={-0.5}
            maxValue={8}
            autoHeight
          />
          <div className="absolute top-0 right-1 text-right" style={{ color: VITAL_COLOR.etco2 }}>
            <div className={labelSize}>EtCO₂</div>
            <div className={`monitor-text ${numSize} font-bold`}>
              {(vitals.etco2 / 7.501).toFixed(1)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
