import { useState } from 'react';
import { VentSettings, VentMode, AllModeParams } from '@/lib/simulation/types';

type TimingMode = 'ie' | 'ti';

interface VentilatorControlsProps {
  settings: VentSettings;
  /** Patch the persistent all-mode parameters (may include `mode` to switch mode). */
  onUpdate: (patch: Partial<AllModeParams>) => void;
}

const MODES: VentMode[] = ['VCV', 'PCV', 'PRVC', 'SIMV', 'PSV', 'APRV'];

export function VentilatorControls({ settings, onUpdate }: VentilatorControlsProps) {
  const [timingMode, setTimingMode] = useState<TimingMode>('ie');

  // Compute I:E and Te from Ti and RR
  const cycleTime = 60 / settings.respiratoryRate;
  const ti = timingMode === 'ti' && settings.inspiratoryTime > 0
    ? settings.inspiratoryTime
    : cycleTime / (1 + settings.ieRatio);
  const te = Math.max(0, cycleTime - ti);
  const eRatio = ti > 0 ? te / ti : 0;
  const computedIE = `1:${eRatio.toFixed(1)}`;
  const computedTi = cycleTime / (1 + settings.ieRatio);

  return (
    <div className="flex flex-col gap-2">
      {/* Mode selector */}
      <div className="grid grid-cols-3 sm:flex gap-1">
        {MODES.map((mode) => (
          <button
            key={mode}
            onClick={() => onUpdate({ mode })}
            className={`flex-1 py-1.5 px-2 text-xs font-bold rounded transition-colors monitor-text
              ${settings.mode === mode
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:bg-accent'
              }`}
          >
            {mode}
          </button>
        ))}
      </div>

      {/* Settings grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {settings.mode !== 'APRV' && (
          <SettingControl
            label="PEEP"
            value={settings.peep}
            unit="cmH₂O"
            min={0} max={25} step={1}
            onChange={(v) => onUpdate({ peep: v })}
          />
        )}

        <SettingControl
          label="FiO₂"
          value={Math.round(settings.fio2 * 100)}
          unit="%"
          min={21} max={100} step={1}
          onChange={(v) => onUpdate({ fio2: v / 100 })}
        />

        {(settings.mode === 'VCV' || settings.mode === 'SIMV') && (
          <>
            <SettingControl
              label="TV"
              value={settings.tidalVolume}
              unit="mL"
              min={200} max={800} step={10}
              onChange={(v) => onUpdate({ tidalVolume: v })}
            />
            <SettingControl
              label="RR"
              value={settings.respiratoryRate}
              unit="/min"
              min={4} max={40} step={1}
              onChange={(v) => onUpdate({ respiratoryRate: v })}
            />
            <TimingToggleAndControl
              timingMode={timingMode}
              onTimingModeChange={setTimingMode}
              ieRatio={settings.ieRatio}
              inspiratoryTime={settings.inspiratoryTime}
              onUpdate={onUpdate}
              computedIE={computedIE}
              computedTi={computedTi}
              te={te}
            />
          </>
        )}

        {settings.mode === 'PCV' && (
          <>
            <SettingControl
              label="Pinsp"
              value={settings.pInsp}
              unit="cmH₂O"
              min={5} max={40} step={1}
              onChange={(v) => onUpdate({ pInsp: v })}
            />
            <SettingControl
              label="RR"
              value={settings.respiratoryRate}
              unit="/min"
              min={4} max={40} step={1}
              onChange={(v) => onUpdate({ respiratoryRate: v })}
            />
            <TimingToggleAndControl
              timingMode={timingMode}
              onTimingModeChange={setTimingMode}
              ieRatio={settings.ieRatio}
              inspiratoryTime={settings.inspiratoryTime}
              onUpdate={onUpdate}
              computedIE={computedIE}
              computedTi={computedTi}
              te={te}
            />
          </>
        )}

        {settings.mode === 'PRVC' && (
          <>
            <SettingControl
              label="Target TV"
              value={settings.tidalVolume}
              unit="mL"
              min={200} max={800} step={10}
              onChange={(v) => onUpdate({ tidalVolume: v })}
            />
            <SettingControl
              label="RR"
              value={settings.respiratoryRate}
              unit="/min"
              min={4} max={40} step={1}
              onChange={(v) => onUpdate({ respiratoryRate: v })}
            />
            <SettingControl
              label="Pmax"
              value={settings.pMax}
              unit="cmH₂O"
              min={15} max={50} step={1}
              onChange={(v) => onUpdate({ pMax: v })}
            />
            <TimingToggleAndControl
              timingMode={timingMode}
              onTimingModeChange={setTimingMode}
              ieRatio={settings.ieRatio}
              inspiratoryTime={settings.inspiratoryTime}
              onUpdate={onUpdate}
              computedIE={computedIE}
              computedTi={computedTi}
              te={te}
            />
          </>
        )}

        {settings.mode === 'SIMV' && (
          <SettingControl
            label="PS"
            value={settings.pressureSupport}
            unit="cmH₂O"
            min={0} max={30} step={1}
            onChange={(v) => onUpdate({ pressureSupport: v })}
          />
        )}

        {settings.mode === 'PSV' && (
          <SettingControl
            label="PS"
            value={settings.pressureSupport}
            unit="cmH₂O"
            min={0} max={30} step={1}
            onChange={(v) => onUpdate({ pressureSupport: v })}
          />
        )}

        {settings.mode === 'APRV' && (
          <>
            <SettingControl
              label="P High"
              value={settings.pHigh}
              unit="cmH₂O"
              min={10} max={40} step={1}
              onChange={(v) => onUpdate({ pHigh: v })}
            />
            <SettingControl
              label="P Low"
              value={settings.pLow}
              unit="cmH₂O"
              min={0} max={10} step={1}
              onChange={(v) => onUpdate({ pLow: v })}
            />
            <SettingControl
              label="T High"
              value={settings.tHigh}
              unit="sec"
              min={1} max={8} step={0.5}
              onChange={(v) => onUpdate({ tHigh: v })}
            />
            <SettingControl
              label="T Low"
              value={settings.tLow}
              unit="sec"
              min={0.1} max={2} step={0.1}
              onChange={(v) => onUpdate({ tLow: v })}
            />
          </>
        )}
      </div>
    </div>
  );
}

/* ── Timing toggle: I:E ↔ Ti ── */

function TimingToggleAndControl({
  timingMode,
  onTimingModeChange,
  ieRatio,
  inspiratoryTime,
  onUpdate,
  computedIE,
  computedTi,
  te,
}: {
  timingMode: TimingMode;
  onTimingModeChange: (m: TimingMode) => void;
  ieRatio: number;
  inspiratoryTime: number;
  onUpdate: (patch: Partial<AllModeParams>) => void;
  computedIE: string;
  computedTi: number;
  te: number;
}) {
  const isWarning = te < 0.5;

  return (
    <>
      <div className="bg-secondary rounded p-2 flex flex-col items-center gap-1">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Timing</span>
        <div className="flex rounded overflow-hidden border border-border">
          <button
            onClick={() => onTimingModeChange('ie')}
            className={`px-2 py-1 text-[10px] font-bold transition-colors
              ${timingMode === 'ie'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
          >
            I:E
          </button>
          <button
            onClick={() => onTimingModeChange('ti')}
            className={`px-2 py-1 text-[10px] font-bold transition-colors
              ${timingMode === 'ti'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
          >
            Ti
          </button>
        </div>
      </div>

      {timingMode === 'ie' ? (
        <SettingControl
          label="I:E"
          value={ieRatio}
          unit={`1:${ieRatio}`}
          min={1} max={4} step={0.5}
          onChange={(v) => onUpdate({ ieRatio: v })}
        />
      ) : (
        <SettingControl
          label="Ti"
          value={inspiratoryTime}
          unit="sec"
          min={0.3} max={3.0} step={0.1}
          onChange={(v) => onUpdate({ inspiratoryTime: v })}
        />
      )}

      <div className="bg-secondary rounded p-2 flex flex-col items-center justify-center gap-0.5">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          {timingMode === 'ie' ? 'Computed Ti' : 'Computed I:E'}
        </span>
        <span className={`monitor-text text-sm font-bold ${isWarning ? 'text-destructive' : 'text-foreground'}`}>
          {timingMode === 'ie' ? `${computedTi.toFixed(1)}s` : computedIE}
        </span>
        <span className="text-[9px] text-muted-foreground">Te {te.toFixed(1)}s</span>
      </div>
    </>
  );
}

/* ── Setting control ── */

function SettingControl({
  label,
  value,
  unit,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const decrement = () => onChange(Math.max(min, value - step));
  const increment = () => onChange(Math.min(max, value + step));

  return (
    <div className="bg-secondary rounded p-2 flex flex-col items-center gap-1">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-1">
        <button
          onClick={decrement}
          className="w-6 h-6 rounded bg-muted hover:bg-accent text-foreground text-xs font-bold flex items-center justify-center"
        >
          −
        </button>
        <span className="monitor-text text-sm font-bold text-foreground min-w-[3rem] text-center">
          {value % 1 === 0 ? value : value.toFixed(1)}
        </span>
        <button
          onClick={increment}
          className="w-6 h-6 rounded bg-muted hover:bg-accent text-foreground text-xs font-bold flex items-center justify-center"
        >
          +
        </button>
      </div>
      <span className="text-[9px] text-muted-foreground">{unit}</span>
    </div>
  );
}
