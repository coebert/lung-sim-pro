import { useMemo } from 'react';
import { VITAL_COLOR, spo2Color } from '@/lib/theme';

interface TrendStripProps {
  spo2: number[];
  map: number[];
  etco2: number[];
  /** Cadence between samples in seconds (default 1s → 300 samples = 5 min). */
  cadenceSec?: number;
}

interface Lane {
  label: string;
  unit: string;
  values: number[];
  color: string;
  min: number;
  max: number;
  format: (n: number) => string;
}

function Sparkline({ lane, width = 120, height = 26 }: { lane: Lane; width?: number; height?: number }) {
  const path = useMemo(() => {
    const vs = lane.values;
    if (vs.length < 2) return '';
    const span = Math.max(1e-6, lane.max - lane.min);
    const stepX = width / (vs.length - 1);
    let d = '';
    for (let i = 0; i < vs.length; i++) {
      const x = i * stepX;
      const yNorm = (vs[i] - lane.min) / span;
      const y = height - Math.min(1, Math.max(0, yNorm)) * height;
      d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
    }
    return d;
  }, [lane, width, height]);

  const latest = lane.values[lane.values.length - 1] ?? 0;

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <div className="flex flex-col items-end leading-none">
        <span className="text-[8px] text-muted-foreground uppercase tracking-wider">{lane.label}</span>
        <span className="monitor-text text-[11px] font-bold tabular-nums" style={{ color: lane.color }}>
          {lane.format(latest)}
        </span>
      </div>
      <svg width={width} height={height} className="shrink-0" aria-hidden>
        <path d={path} fill="none" stroke={lane.color} strokeWidth={1.25} strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function TrendStrip({ spo2, map, etco2, cadenceSec = 1 }: TrendStripProps) {
  const windowMin = ((spo2.length * cadenceSec) / 60).toFixed(1);
  const lanes: Lane[] = [
    { label: 'SpO₂', unit: '%', values: spo2, color: spo2Color(spo2[spo2.length - 1] ?? 100), min: 80, max: 100, format: (n) => `${Math.round(n)}%` },
    { label: 'MAP',  unit: 'mmHg', values: map,  color: VITAL_COLOR.abp,   min: 40, max: 120, format: (n) => `${Math.round(n)}` },
    { label: 'EtCO₂', unit: 'kPa', values: etco2, color: VITAL_COLOR.etco2, min: 2.5, max: 8, format: (n) => n.toFixed(1) },
  ];
  return (
    <div className="flex items-center gap-3 px-2 py-1 border-t border-border bg-secondary/50 overflow-x-auto">
      <span className="text-[8px] text-muted-foreground uppercase tracking-wider shrink-0">
        Trend · last {windowMin} min
      </span>
      {lanes.map((l) => <Sparkline key={l.label} lane={l} />)}
    </div>
  );
}
