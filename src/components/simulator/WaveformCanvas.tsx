import { useRef, useEffect, useState, useCallback } from 'react';

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
    ctx.fillStyle = 'hsl(220, 30%, 3%)';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    if (showGrid) {
      ctx.strokeStyle = 'hsl(216, 20%, 10%)';
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
      const x = (i / (data.length - 1)) * w;
      const normalized = (data[i] - minValue) / range;
      const y = padding + plotH * (1 - normalized);

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Label
    const fontSize = Math.max(8, Math.min(11, h * 0.15));
    ctx.font = `${fontSize}px monospace`;
    ctx.fillStyle = color;
    ctx.fillText(`${label} (${unit})`, 4, fontSize + 1);

    // Scale markers
    ctx.fillStyle = 'hsl(215, 15%, 40%)';
    const scaleFontSize = Math.max(7, Math.min(9, h * 0.12));
    ctx.font = `${scaleFontSize}px monospace`;
    ctx.fillText(String(Math.round(maxValue)), w - 30, scaleFontSize + 1);
    ctx.fillText(String(Math.round(minValue)), w - 30, h - 2);
  }, [data, color, label, unit, minValue, maxValue, effectiveHeight, showGrid, autoHeight]);

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
