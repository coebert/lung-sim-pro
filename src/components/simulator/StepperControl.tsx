import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

interface StepperControlProps {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** Optional big-step multiplier for PageUp/PageDown (default 10×). */
  bigStepMult?: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Stepper with:
 *  – Long-press acceleration (starts at 200ms, ramps to 40ms).
 *  – Keyboard: Arrow ↑/↓ = step, Arrow →/← = step, PgUp/PgDn = big step.
 *  – Undo toast (6 s) capturing the pre-change value.
 *
 * Latest `value`/`onChange` live in refs so the long-press timer chain and
 * the debounced undo toast always read fresh state rather than the render
 * closure captured at pointerdown.
 */
export function StepperControl({
  label, value, unit, min, max, step, onChange, bigStepMult = 10,
}: StepperControlProps) {
  const priorRef = useRef<number>(value);
  const holdTimer = useRef<number | null>(null);
  const undoToken = useRef<string | number | null>(null);

  // Always-current mirrors of the incoming props.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const clampSnap = useCallback((next: number) => {
    const clamped = clamp(next, min, max);
    // Round to step precision to avoid float drift.
    const snapped = Math.round(clamped / step) * step;
    return Math.abs(snapped - clamped) < step / 2 ? snapped : clamped;
  }, [min, max, step]);

  const commitFromRef = useCallback((next: number) => {
    const final = clampSnap(next);
    if (final === valueRef.current) return;
    onChangeRef.current(final);
  }, [clampSnap]);

  const scheduleUndoToast = useCallback(() => {
    if (undoToken.current !== null) toast.dismiss(undoToken.current);
    const prior = priorRef.current;
    const current = valueRef.current;
    undoToken.current = toast(`${label} changed`, {
      description: `${prior} → ${current} ${unit}`,
      duration: 6000,
      action: {
        label: 'Undo',
        onClick: () => onChangeRef.current(prior),
      },
    });
  }, [label, unit]);

  const stopHold = useCallback(() => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
      // Only surface undo after a sustained press (i.e. accelerated changes).
      scheduleUndoToast();
    }
  }, [scheduleUndoToast]);

  const startHold = useCallback((dir: 1 | -1) => {
    priorRef.current = valueRef.current;
    let interval = 200;
    const tick = () => {
      commitFromRef(valueRef.current + dir * step);
      interval = Math.max(40, interval - 20);
      holdTimer.current = window.setTimeout(tick, interval);
    };
    // First step happens on pointerdown (below); acceleration kicks in after 350ms.
    holdTimer.current = window.setTimeout(tick, 350);
  }, [commitFromRef]);

  useEffect(() => () => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
  }, []);

  const singleStep = (dir: 1 | -1, big = false) => {
    priorRef.current = valueRef.current;
    commitFromRef(valueRef.current + dir * step * (big ? bigStepMult : 1));
    // Debounced undo for discrete keypresses — reads fresh state via refs.
    window.setTimeout(scheduleUndoToast, 0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        e.preventDefault(); singleStep(1); break;
      case 'ArrowDown':
      case 'ArrowLeft':
        e.preventDefault(); singleStep(-1); break;
      case 'PageUp':
        e.preventDefault(); singleStep(1, true); break;
      case 'PageDown':
        e.preventDefault(); singleStep(-1, true); break;
    }
  };

  return (
    <div
      tabIndex={0}
      role="group"
      aria-label={`${label} ${value} ${unit}`}
      onKeyDown={onKeyDown}
      className="bg-secondary rounded p-2 flex flex-col items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          onPointerDown={() => { priorRef.current = valueRef.current; commitFromRef(valueRef.current - step); startHold(-1); }}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          className="w-6 h-6 rounded bg-muted hover:bg-accent text-foreground text-xs font-bold flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          −
        </button>
        <span className="monitor-text text-sm font-bold text-foreground min-w-[3rem] text-center tabular-nums">
          {value % 1 === 0 ? value : value.toFixed(1)}
        </span>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          onPointerDown={() => { priorRef.current = valueRef.current; commitFromRef(valueRef.current + step); startHold(1); }}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          className="w-6 h-6 rounded bg-muted hover:bg-accent text-foreground text-xs font-bold flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          +
        </button>
      </div>
      <span className="text-[9px] text-muted-foreground">{unit}</span>
    </div>
  );
}
