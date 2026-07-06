import { WaveformCanvas } from './WaveformCanvas';
import { WaveformBuffers, Vitals } from '@/lib/simulation/types';
import { VITAL_COLOR, WAVE_COLOR, spo2Color, hrColor } from '@/lib/theme';

interface MonitorPanelProps {
  buffers: WaveformBuffers;
  vitals: Vitals;
  compact?: boolean;
  /** 'row' = waveforms left, numerics stacked right (desktop / landscape).
   *  'grid' = 2×2 numerics tiles on top, 2×2 waveforms below (portrait). */
  layout?: 'row' | 'grid';
}

export function MonitorPanel({ buffers, vitals, compact = false, layout = 'row' }: MonitorPanelProps) {
  const spo2C = spo2Color(vitals.spo2);
  const hrC = hrColor(vitals.hr);
  const map = Math.round(vitals.dbp + (vitals.sbp - vitals.dbp) / 3);

  const numColWidth = compact ? 'w-[64px]' : 'w-[92px]';
  const bigNum = compact ? 'text-2xl' : 'text-4xl';
  const midNum = compact ? 'text-lg' : 'text-2xl';
  const labelSize = compact ? 'text-[9px]' : 'text-[10px]';
  const subSize = compact ? 'text-[9px]' : 'text-[10px]';

  const numBoxes = [
    { key: 'HR',    label: 'HR',    unit: 'bpm',  color: VITAL_COLOR.hr,    valueColor: hrC,  value: Math.round(vitals.hr).toString(),           bigClass: bigNum },
    { key: 'ABP',   label: 'ABP',   unit: 'mmHg', color: VITAL_COLOR.abp,                     value: `${Math.round(vitals.sbp)}/${Math.round(vitals.dbp)}`, sub: `(${map})`, bigClass: midNum },
    { key: 'SpO2',  label: 'SpO₂',  unit: '%',    color: spo2C,                               value: Math.round(vitals.spo2).toString(),         bigClass: bigNum },
    { key: 'EtCO2', label: 'EtCO₂', unit: 'kPa',  color: VITAL_COLOR.etco2,                   value: (vitals.etco2 / 7.501).toFixed(1),          bigClass: bigNum },
  ];

  const waves = (
    <>
      <WaveformLane>
        <WaveformCanvas data={buffers.ecg} color={WAVE_COLOR.ecg} label="II" unit="ECG"
          minValue={-0.5} maxValue={1.5} autoHeight />
      </WaveformLane>
      <WaveformLane>
        <WaveformCanvas data={buffers.abp} color={WAVE_COLOR.abp} label="ABP" unit="mmHg"
          minValue={20} maxValue={180} autoHeight />
      </WaveformLane>
      <WaveformLane>
        <WaveformCanvas data={buffers.spo2Pleth} color={spo2C} label="Pleth" unit="SpO₂"
          minValue={-0.2} maxValue={1.3} autoHeight />
      </WaveformLane>
      <WaveformLane>
        <WaveformCanvas data={buffers.capno.map((v) => v / 7.501)} color={WAVE_COLOR.capno} label="CO₂" unit="kPa"
          minValue={-0.5} maxValue={8} autoHeight />
      </WaveformLane>
    </>
  );

  // ── PORTRAIT / GRID layout ─────────────────────────────────
  if (layout === 'grid') {
    return (
      <div className="flex flex-col gap-1 h-full bg-monitor-bg rounded p-1 overflow-hidden">
        {/* 2×2 numerics grid — auto-fit, min 130px per tile */}
        <div className="grid gap-1 shrink-0" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
          {numBoxes.map(({ key, ...b }) => (
            <NumBox key={key} {...b} labelSize="text-[10px]" subSize="text-[9px]" />
          ))}
        </div>
        {/* 2×2 waveforms grid */}
        <div className="grid grid-cols-2 gap-1 flex-1 min-h-0">
          {waves}
        </div>
      </div>
    );
  }

  // ── DEFAULT ROW layout (desktop / landscape) ───────────────
  return (
    <div className="flex flex-col gap-0.5 h-full">
      {!compact && (
        <div className="flex items-center justify-between px-2 py-1 bg-secondary rounded-t shrink-0">
          <span className="text-xs text-muted-foreground font-bold tracking-wider uppercase">
            Patient Monitor
          </span>
        </div>
      )}

      <div className="flex-1 flex min-h-0 bg-monitor-bg rounded-b p-1 gap-1 overflow-hidden">
        <div className="flex-1 flex flex-col gap-0.5 min-w-0 min-h-0">{waves}</div>

        {/* Dedicated numerics column — never overlaps traces */}
        <div className={`flex flex-col gap-0.5 ${numColWidth} shrink-0`}>
          {numBoxes.map(({ key, ...b }) => (
            <NumBox key={key} {...b} labelSize={labelSize} subSize={subSize} />
          ))}
        </div>
      </div>
    </div>
  );
}

function WaveformLane({ children }: { children: React.ReactNode }) {
  return <div className="relative flex-1 min-h-0 min-w-0 flex flex-col">{children}</div>;
}

function NumBox({
  label, unit, color, valueColor, value, sub, bigClass, labelSize, subSize,
}: {
  label: string;
  unit: string;
  color: string;
  valueColor?: string;
  value: string;
  sub?: string;
  bigClass: string;
  labelSize: string;
  subSize: string;
}) {
  return (
    <div className="flex-1 min-h-0 bg-secondary/60 rounded flex flex-col justify-center items-end px-2 py-1 border-l-2" style={{ borderColor: color }}>
      <div className="flex items-baseline gap-1 w-full justify-between">
        <span className={`${labelSize} uppercase tracking-wider`} style={{ color }}>{label}</span>
        <span className={`${subSize} text-muted-foreground`}>{unit}</span>
      </div>
      <div className={`monitor-text ${bigClass} font-bold leading-none tabular-nums`} style={{ color: valueColor ?? color }}>
        {value}
      </div>
      {sub && (
        <div className={`${subSize} monitor-text`} style={{ color }}>{sub}</div>
      )}
    </div>
  );
}
