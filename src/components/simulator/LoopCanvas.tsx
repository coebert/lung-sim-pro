import { useEffect, useRef } from 'react';

interface LoopCanvasProps {
  x: number[];
  y: number[];
  xRange: [number, number];
  yRange: [number, number];
  color: string;
  label: string;
  xUnit: string;
  yUnit: string;
  /** Number of most-recent samples to trace (≈ last 1–2 breaths). */
  samples?: number;
}

/**
 * Ventilator-style loop (e.g. pressure–volume, flow–volume). Older samples
 * fade out so the current breath stands out, like on a real machine.
 */
export function LoopCanvas({ x, y, xRange, yRange, color, label, xUnit, yUnit, samples = 400 }: LoopCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr; canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pad = { l: 22, r: 4, t: 14, b: 12 };
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
    const sx = (v: number) => pad.l + ((v - xRange[0]) / (xRange[1] - xRange[0])) * pw;
    const sy = (v: number) => pad.t + ph - ((v - yRange[0]) / (yRange[1] - yRange[0])) * ph;

    // axes
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const x0 = sx(Math.max(xRange[0], Math.min(0, xRange[1])));
    const y0 = sy(Math.max(yRange[0], Math.min(0, yRange[1])));
    ctx.moveTo(x0, pad.t); ctx.lineTo(x0, pad.t + ph);
    ctx.moveTo(pad.l, y0); ctx.lineTo(pad.l + pw, y0);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillText(String(yRange[1]), 1, pad.t + 6);
    ctx.fillText(String(xRange[1]), pad.l + pw - 18, h - 2);
    ctx.fillText(`${yUnit} / ${xUnit}`, pad.l + 2, h - 2);
    ctx.fillStyle = color;
    ctx.font = 'bold 10px Inter, sans-serif';
    ctx.fillText(label, pad.l + 2, 10);

    const n = Math.min(x.length, y.length);
    const start = Math.max(1, n - samples);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    for (let i = start; i < n; i++) {
      ctx.globalAlpha = 0.15 + 0.85 * ((i - start) / (n - start));
      ctx.beginPath();
      ctx.moveTo(sx(x[i - 1]), sy(y[i - 1]));
      ctx.lineTo(sx(x[i]), sy(y[i]));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, [x, y, xRange, yRange, color, label, xUnit, yUnit, samples]);

  return <canvas ref={ref} className="w-full h-full min-h-0 rounded bg-vent-screen" aria-label={`${label} loop`} role="img" />;
}
