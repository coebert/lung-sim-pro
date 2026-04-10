import { useState } from 'react';
import { VentSettings, VentMode } from '@/lib/simulation/types';

type TimingMode = 'ie' | 'ti';

interface VentilatorControlsProps {
  settings: VentSettings;
  onSettingsChange: (settings: VentSettings) => void;
}

const MODES: VentMode[] = ['VCV', 'PCV', 'PRVC', 'SIMV', 'PSV', 'APRV'];

export function VentilatorControls({ settings, onSettingsChange }: VentilatorControlsProps) {
  const [timingMode, setTimingMode] = useState<TimingMode>('ie');

  const update = (key: keyof VentSettings, value: number | string) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  // Compute I:E and Te from Ti and RR
  const cycleTime = 60 / settings.respiratoryRate;
  const ti = settings.inspiratoryTime > 0 ? settings.inspiratoryTime : cycleTime / (1 + settings.ieRatio);
  const te = Math.max(0, cycleTime - ti);
  const eRatio = ti > 0 ? te / ti : 0;
  const computedIE = `1:${eRatio.toFixed(1)}`;

  return (
    <div className="flex flex-col gap-2">
      {/* Mode selector */}
      <div className="grid grid-cols-3 sm:flex gap-1">
        {MODES.map((mode) => (
          <button
            key={mode}
            onClick={() => update('mode', mode)}
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
        {/* Common settings */}
        {(settings.mode !== 'APRV') && (
          <SettingControl
            label="PEEP"
            value={settings.peep}
            unit="cmH₂O"
            min={0} max={25} step={1}
            onChange={(v) => update('peep', v)}
          />
        )}
        
        <SettingControl
          label="FiO₂"
          value={Math.round(settings.fio2 * 100)}
          unit="%"
          min={21} max={100} step={1}
          onChange={(v) => update('fio2', v / 100)}
        />

        {/* VCV specific */}
        {(settings.mode === 'VCV' || settings.mode === 'SIMV') && (
          <>
            <SettingControl
              label="TV"
              value={settings.tidalVolume}
              unit="mL"
              min={200} max={800} step={10}
              onChange={(v) => update('tidalVolume', v)}
            />
            <SettingControl
              label="RR"
              value={settings.respiratoryRate}
              unit="/min"
              min={4} max={40} step={1}
              onChange={(v) => update('respiratoryRate', v)}
            />
            <TimingToggleAndControl
              timingMode={timingMode}
              onTimingModeChange={setTimingMode}
              settings={settings}
              onUpdate={update}
              computedIE={computedIE}
              te={te}
            />

        {/* PCV specific */}
        {settings.mode === 'PCV' && (
          <>
            <SettingControl
              label="Pinsp"
              value={settings.pInsp}
              unit="cmH₂O"
              min={5} max={40} step={1}
              onChange={(v) => update('pInsp', v)}
            />
            <SettingControl
              label="RR"
              value={settings.respiratoryRate}
              unit="/min"
              min={4} max={40} step={1}
              onChange={(v) => update('respiratoryRate', v)}
            />
            <TimingToggleAndControl
              timingMode={timingMode}
              onTimingModeChange={setTimingMode}
              settings={settings}
              onUpdate={update}
              computedIE={computedIE}
              te={te}
            />

        {/* PRVC specific */}
        {settings.mode === 'PRVC' && (
          <>
            <SettingControl
              label="Target TV"
              value={settings.tidalVolume}
              unit="mL"
              min={200} max={800} step={10}
              onChange={(v) => update('tidalVolume', v)}
            />
            <SettingControl
              label="RR"
              value={settings.respiratoryRate}
              unit="/min"
              min={4} max={40} step={1}
              onChange={(v) => update('respiratoryRate', v)}
            />
            <SettingControl
              label="Pmax"
              value={settings.pMax}
              unit="cmH₂O"
              min={15} max={50} step={1}
              onChange={(v) => update('pMax', v)}
            />
            <TimingToggleAndControl
              timingMode={timingMode}
              onTimingModeChange={setTimingMode}
              settings={settings}
              onUpdate={update}
              computedIE={computedIE}
              te={te}
            />

        {/* SIMV additional */}
        {settings.mode === 'SIMV' && (
          <SettingControl
            label="PS"
            value={settings.pressureSupport}
            unit="cmH₂O"
            min={0} max={30} step={1}
            onChange={(v) => update('pressureSupport', v)}
          />
        )}

        {/* PSV specific */}
        {settings.mode === 'PSV' && (
          <SettingControl
            label="PS"
            value={settings.pressureSupport}
            unit="cmH₂O"
            min={0} max={30} step={1}
            onChange={(v) => update('pressureSupport', v)}
          />
        )}

        {/* APRV specific */}
        {settings.mode === 'APRV' && (
          <>
            <SettingControl
              label="P High"
              value={settings.pHigh}
              unit="cmH₂O"
              min={10} max={40} step={1}
              onChange={(v) => update('pHigh', v)}
            />
            <SettingControl
              label="P Low"
              value={settings.pLow}
              unit="cmH₂O"
              min={0} max={10} step={1}
              onChange={(v) => update('pLow', v)}
            />
            <SettingControl
              label="T High"
              value={settings.tHigh}
              unit="sec"
              min={1} max={8} step={0.5}
              onChange={(v) => update('tHigh', v)}
            />
            <SettingControl
              label="T Low"
              value={settings.tLow}
              unit="sec"
              min={0.1} max={2} step={0.1}
              onChange={(v) => update('tLow', v)}
            />
          </>
        )}
      </div>
    </div>
  );
}

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

function ComputedIEDisplay({ ie, te }: { ie: string; te: number }) {
  const isWarning = te < 0.5;
  return (
    <div className="bg-secondary rounded p-2 flex flex-col items-center justify-center gap-0.5">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Computed</span>
      <span className={`monitor-text text-sm font-bold ${isWarning ? 'text-destructive' : 'text-foreground'}`}>
        {ie}
      </span>
      <span className="text-[9px] text-muted-foreground">Te {te.toFixed(1)}s</span>
    </div>
  );
}
