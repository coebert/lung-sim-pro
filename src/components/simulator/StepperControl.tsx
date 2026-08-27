import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronsDown, ChevronsUp } from 'lucide-react';
import { toast } from 'sonner';

export interface HoldAccelerationConfig {
  /** Delay before the first auto-repeat tick (ms). Default 350. */
  initialDelay?: number;
  /** Interval between ticks at the start of the hold (ms). Default 200. */
  startInterval?: number;
  /** Interval the hold ramps down to (ms). Default 40. */
  minInterval?: number;
  /** How much the interval shrinks each tick (ms). Default 20. */
  decay?: number;
}

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
  /** Optional long-press acceleration tuning. Defaults: 350ms delay, 200→40ms ramp at −20ms/tick. */
  holdAccel?: HoldAccelerationConfig;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Stepper with:
 *  – Configurable long-press acceleration (default: 350ms initial delay, then
 *    200ms → 40ms ramp at −20ms per tick).
 *  – Keyboard: Arrow ↑/↓ = step, Arrow →/← = step, PgUp/PgDn = big step.
 *  – Undo toast (6 s) capturing the pre-change value.
 *  – Live "Ramping…" indicator on the held button.
 *
 * Latest `value`/`onChange` live in refs so the long-press timer chain and
 * the debounced undo toast always read fresh state rather than the render
 * closure captured at pointerdown.
 */
export function StepperControl({
  label, value, unit, min, max, step, onChange, bigStepMult = 10, holdAccel,
}: StepperControlProps) {
  const {
    initialDelay = 350,
    startInterval = 200,
    minInterval = 40,
    decay = 20,
  } = holdAccel ?? {};

  const priorRef = useRef<number>(value);
  const holdTimer = useRef<number | null>(null);
  const undoToken = useRef<string | number | null>(null);
  const [ramping, setRamping] = useState<1 | -1 | null>(null);

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
      setRamping(null);
      // Only surface undo after a sustained press (i.e. accelerated changes).
      scheduleUndoToast();
    }
  }, [scheduleUndoToast]);

  const startHold = useCallback((dir: 1 | -1) => {
    setRamping(dir);
    let interval = startInterval;
    const tick = () => {
      commitFromRef(valueRef.current + dir * step);
      interval = Math.max(minInterval, interval - decay);
      holdTimer.current = window.setTimeout(tick, interval);
    };
    // First step happens on pointerdown; acceleration kicks in after initialDelay.
    holdTimer.current = window.setTimeout(tick, initialDelay);
  }, [commitFromRef, step, initialDelay, startInterval, minInterval, decay]);

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

  const holdButtonClass = (dir: 1 | -1) =>
    `w-6 h-6 rounded text-xs font-bold flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      ramping === dir
        ? 'bg-accent text-foreground ring-1 ring-primary'
        : 'bg-muted hover:bg-accent text-foreground'
    }`;

  return (
    <div
      tabIndex={0}
      role="group"
      aria-label={`${label} ${value} ${unit}${ramping !== null ? ' (ramping)' : ''}`}
      onKeyDown={onKeyDown}
      className="bg-secondary rounded p-2 flex flex-col items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`Decrease ${label}${ramping === -1 ? ' (ramping)' : ''}`}
          onPointerDown={() => { priorRef.current = valueRef.current; commitFromRef(valueRef.current - step); startHold(-1); }}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          className={holdButtonClass(-1)}
        >
          {ramping === -1 ? <ChevronsDown className="w-3.5 h-3.5 animate-pulse" /> : '−'}
        </button>
        <div className="flex flex-col items-center">
          <span className="monitor-text text-sm font-bold text-foreground min-w-[3rem] text-center tabular-nums">
            {value % 1 === 0 ? value : value.toFixed(1)}
          </span>
          <span
            aria-live="polite"
            className={`text-[8px] uppercase tracking-wider h-3 ${ramping !== null ? 'text-primary' : 'text-transparent'}`}
          >
            Ramping…
          </span>
        </div>
        <button
          type="button"
          aria-label={`Increase ${label}${ramping === 1 ? ' (ramping)' : ''}`}
          onPointerDown={() => { priorRef.current = valueRef.current; commitFromRef(valueRef.current + step); startHold(1); }}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          className={holdButtonClass(1)}
        >
          {ramping === 1 ? <ChevronsUp className="w-3.5 h-3.5 animate-pulse" /> : '+'}
        </button>
      </div>
      <span className="text-[9px] text-muted-foreground">{unit}</span>
    </div>
  );
}
