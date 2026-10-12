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

    // Temporal smoothing, like the display filter on a real ventilator:
    // an exponential moving average rounds off the sharp corners that raw
    // 50 Hz samples produce at breath transitions. Kept light (~2-sample
    // time constant): anything heavier smears APRV's fast release into a
    // diagonal and turns the box-shaped loop into a fake oval.
    const alpha = 0.5;
    const xs: number[] = new Array(n - start);
    const ys: number[] = new Array(n - start);
    let fx = x[start - 1], fy = y[start - 1];
    for (let i = start; i < n; i++) {
      fx += alpha * (x[i] - fx);
      fy += alpha * (y[i] - fy);
      xs[i - start] = fx;
      ys[i - start] = fy;
    }
    const m = xs.length;

    // Draw as smooth curve joins (quadratic through segment midpoints) in
    // alpha bands so older samples fade, without per-segment stroke seams.
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const bands = 8;
    const bandLen = Math.max(2, Math.ceil(m / bands));
    for (let b = 0; b < bands; b++) {
      const i0 = b * bandLen;
      if (i0 >= m - 1) break;
      const i1 = Math.min(m - 1, i0 + bandLen);
      ctx.globalAlpha = 0.15 + 0.85 * (i1 / m);
      ctx.beginPath();
      ctx.moveTo(sx(xs[i0]), sy(ys[i0]));
      for (let i = i0 + 1; i < i1; i++) {
        const mx = (sx(xs[i]) + sx(xs[i + 1])) / 2;
        const my = (sy(ys[i]) + sy(ys[i + 1])) / 2;
        ctx.quadraticCurveTo(sx(xs[i]), sy(ys[i]), mx, my);
      }
      ctx.lineTo(sx(xs[i1]), sy(ys[i1]));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, [x, y, xRange, yRange, color, label, xUnit, yUnit, samples]);

  return <canvas ref={ref} className="w-full h-full min-h-0 rounded bg-vent-screen" aria-label={`${label} loop`} role="img" />;
}
