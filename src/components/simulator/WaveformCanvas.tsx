import { useRef, useEffect, useState, useCallback } from 'react';
import { MONITOR_COLOR } from '@/lib/theme';

interface WaveformCanvasProps {
  data: number[];
  color: string;
  label: string;
  unit: string;
  minValue: number;
  maxValue: number;
  height?: number;
  showGrid?: boolean;
  currentValue?: string;
  autoHeight?: boolean;
  /**
   * Optional per-sample flags aligned with `data`: 1 marks a sample where a
   * vertical event line is drawn (used for the APRV cycle-back-to-P-High
   * marker on the flow trace).
   */
  markers?: number[];
  /** Caption drawn beside the first visible marker line. */
  markerLabel?: string;
}

export function WaveformCanvas({
  data,
  color,
  label,
  unit,
  minValue,
  maxValue,
  height = 100,
  showGrid = true,
  currentValue,
  autoHeight = false,
  markers,
  markerLabel,
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(height);

  // Use ResizeObserver when autoHeight is enabled
  useEffect(() => {
    if (!autoHeight) return;
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.contentRect.height;
        if (h > 0) setContainerHeight(h);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [autoHeight]);

  const effectiveHeight = autoHeight ? containerHeight : height;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const h = autoHeight ? rect.height : effectiveHeight;
    if (h <= 0) return;

    canvas.width = rect.width * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;

    // Clear
    ctx.fillStyle = MONITOR_COLOR.bg;
    ctx.fillRect(0, 0, w, h);

    // Grid lines (subtle horizontal + vertical 1s-ish spacing)
    if (showGrid) {
      ctx.strokeStyle = MONITOR_COLOR.grid;
      ctx.lineWidth = 0.5;
      const gridLines = 4;
      for (let i = 1; i < gridLines; i++) {
        const y = (h / gridLines) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      for (let x = 0; x < w; x += w / 10) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
    }

    // Reserve a small left gutter for scale labels so they never overlap the trace
    const leftGutter = 22;
    const plotW = Math.max(1, w - leftGutter);

    // Draw waveform
    if (data.length < 2) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    const range = maxValue - minValue;
    const padding = Math.min(8, h * 0.1);
    const plotH = h - padding * 2;

    for (let i = 0; i < data.length; i++) {
      const x = leftGutter + (i / (data.length - 1)) * plotW;
      const normalized = (data[i] - minValue) / range;
      const y = padding + plotH * (1 - normalized);

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Event markers (e.g. APRV cycling back to P High): vertical dashed
    // lines through the trace, with a caption on the first visible one.
    if (markers && markers.length === data.length) {
      const markerX: number[] = [];
      for (let i = 0; i < markers.length; i++) {
        if (markers[i]) markerX.push(leftGutter + (i / (data.length - 1)) * plotW);
      }
      if (markerX.length > 0) {
        ctx.save();
        ctx.strokeStyle = MONITOR_COLOR.scaleText;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        for (const x of markerX) {
          ctx.beginPath();
          ctx.moveTo(x, 2);
          ctx.lineTo(x, h - 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        if (markerLabel) {
          const labelFont = Math.max(7, Math.min(9, h * 0.12));
          ctx.font = `${labelFont}px monospace`;
          ctx.fillStyle = MONITOR_COLOR.scaleText;
          const x = markerX[0];
          const label = `▼ ${markerLabel}`;
          // Keep the caption inside the plot area.
          const tx = Math.min(x + 3, w - ctx.measureText(label).width - 2);
          ctx.fillText(label, Math.max(leftGutter + 2, tx), h - 4);
        }
        ctx.restore();
      }
    }

    // Label (top-left, inside gutter area)
    const fontSize = Math.max(8, Math.min(11, h * 0.15));
    ctx.font = `${fontSize}px monospace`;
    ctx.fillStyle = color;
    ctx.fillText(`${label} (${unit})`, leftGutter + 2, fontSize + 1);

    // Scale markers on the LEFT gutter (not overlapping the trace)
    ctx.fillStyle = MONITOR_COLOR.scaleText;
    const scaleFontSize = Math.max(7, Math.min(9, h * 0.12));
    ctx.font = `${scaleFontSize}px monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(String(Math.round(maxValue)), leftGutter - 2, scaleFontSize + 1);
    ctx.fillText(String(Math.round(minValue)), leftGutter - 2, h - 2);
    ctx.textAlign = 'left';
  }, [data, color, label, unit, minValue, maxValue, effectiveHeight, showGrid, autoHeight, markers, markerLabel]);

  if (autoHeight) {
    return (
      <div ref={containerRef} className="relative w-full flex-1 min-h-0">
        <canvas
          ref={canvasRef}
          className="w-full h-full block"
        />
        {currentValue && (
          <div
            className="absolute top-1 right-10 monitor-text text-sm font-bold"
            style={{ color }}
          >
            {currentValue}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full" style={{ height }}>
      <canvas
        ref={canvasRef}
        className="w-full block"
        style={{ height }}
      />
      {currentValue && (
        <div
          className="absolute top-1 right-10 monitor-text text-sm font-bold"
          style={{ color }}
        >
          {currentValue}
        </div>
      )}
    </div>
  );
}
