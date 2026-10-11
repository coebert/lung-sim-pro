import { useState } from 'react';
import { VentSettings, VentMode, AllModeParams, PatientPhysiology } from '@/lib/simulation/types';
import { prvcInspPressure, psvInspTime } from '@/lib/simulation/waveformGenerators';
import { StepperControl } from '@/components/simulator/StepperControl';
import type { ComponentProps } from 'react';

/** Dräger-style therapy tile. */
const SettingControl = (p: ComponentProps<typeof StepperControl>) => <StepperControl variant="drager" {...p} />;

type TimingMode = 'ie' | 'ti';

/** Long-press acceleration presets (StepperControl defaults: 350ms delay, 200→40ms @ −20ms/tick). */
/** FiO₂ spans 21–100 (79 steps) — ramp harder so holding is practical. */
const FIO2_ACCEL = { initialDelay: 300, startInterval: 180, minInterval: 25, decay: 20 };
/** PEEP spans 0–25 — moderately fast ramp. */
const PEEP_ACCEL = { initialDelay: 300, startInterval: 160, minInterval: 35, decay: 15 };

interface VentilatorControlsProps {
  settings: VentSettings;
  /** Current patient — lets PRVC/PSV show the pressure and Ti the machine is using. */
  patient?: PatientPhysiology;
  /** Patch the persistent all-mode parameters (may include `mode` to switch mode). */
  onUpdate: (patch: Partial<AllModeParams>) => void;
}

const MODES: VentMode[] = ['VCV', 'PCV', 'PRVC', 'SIMV', 'PSV', 'APRV'];

export function VentilatorControls({ settings, patient, onUpdate }: VentilatorControlsProps) {
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
      <div className="grid grid-cols-3 sm:flex gap-1" role="tablist" aria-label="Ventilation mode">
        {MODES.map((mode) => (
          <button
            key={mode}
            role="tab"
            aria-selected={settings.mode === mode}
            onClick={() => onUpdate({ mode })}
            className={`flex-1 py-1.5 px-2 text-xs font-bold rounded-md border-2 transition-colors monitor-text
              ${settings.mode === mode
                ? 'bg-vent-select border-vent-select text-vent-select-foreground'
                : 'bg-vent-tile border-vent-tile-border text-vent-label hover:border-vent-select'
              }`}
          >
            {mode}
          </button>
        ))}
      </div>

      {/* Settings grid */}
      <div className="flex flex-wrap gap-1.5">
        {settings.mode !== 'APRV' && (
          <SettingControl
            label="PEEP"
            value={settings.peep}
            unit="cmH₂O"
            min={0} max={25} step={1}
            onChange={(v) => onUpdate({ peep: v })}
            holdAccel={PEEP_ACCEL}
          />
        )}

        <SettingControl
          label="FiO₂"
          value={Math.round(settings.fio2 * 100)}
          unit="%"
          min={21} max={100} step={1}
          onChange={(v) => onUpdate({ fio2: v / 100 })}
          holdAccel={FIO2_ACCEL}
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
              label="Rise"
              value={settings.riseTime}
              unit="sec"
              min={0} max={0.6} step={0.05}
              onChange={(v) => onUpdate({ riseTime: Math.round(v * 100) / 100 })}
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
            <SettingControl
              label="Rise"
              value={settings.riseTime}
              unit="sec"
              min={0} max={0.6} step={0.05}
              onChange={(v) => onUpdate({ riseTime: Math.round(v * 100) / 100 })}
            />
            {patient && (() => {
              const r = prvcInspPressure(settings, patient);
              return (
                <ReadoutTile
                  label="Pinsp auto"
                  value={(r.pInsp).toFixed(0)}
                  unit="cmH₂O"
                  warn={r.limited}
                  note={r.limited ? 'Pmax−5 limit' : 'regulated'}
                />
              );
            })()}
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
          <>
            <SettingControl
              label="PS"
              value={settings.pressureSupport}
              unit="cmH₂O"
              min={0} max={30} step={1}
              onChange={(v) => onUpdate({ pressureSupport: v })}
            />
            <SettingControl
              label="Rise"
              value={settings.riseTime}
              unit="sec"
              min={0} max={0.6} step={0.05}
              onChange={(v) => onUpdate({ riseTime: Math.round(v * 100) / 100 })}
            />
            <SettingControl
              label="ETS"
              value={settings.ets}
              unit="% pk"
              min={5} max={80} step={5}
              onChange={(v) => onUpdate({ ets: v })}
            />
            {patient && patient.spontaneousRate > 0 && (
              <ReadoutTile
                label="Ti (pt)"
                value={psvInspTime(settings, patient).toFixed(2)}
                unit="sec"
                warn={psvInspTime(settings, patient) >= 1.5}
                note={`RR ${patient.spontaneousRate} pt`}
              />
            )}
          </>
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
      <div className="bg-vent-tile border-2 border-vent-tile-border rounded-md px-2 py-1 flex flex-col items-center gap-1">
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
          unit={ieRatio >= 1 ? `1:${ieRatio}` : `${(1 / ieRatio).toFixed(1)}:1`}
          min={0.25} max={4} step={0.25}
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

      <div className="bg-vent-tile border-2 border-vent-tile-border rounded-md px-2 py-1 flex flex-col items-center justify-center gap-0.5 min-w-[88px]">
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

/* SettingControl imported from StepperControl (long-press + keyboard + undo). */

/* ── Read-only tile for values the ventilator regulates itself ── */
function ReadoutTile({ label, value, unit, note, warn }: { label: string; value: string; unit: string; note?: string; warn?: boolean }) {
  return (
    <div
      className={`rounded-md border-2 border-dashed px-2 py-1 flex flex-col items-center justify-center min-w-[72px]
        ${warn ? 'border-destructive text-destructive' : 'border-vent-tile-border text-vent-label'}`}
      aria-label={`${label} ${value} ${unit}`}
    >
      <span className="text-[10px] uppercase tracking-wider">{label}</span>
      <span className="text-lg font-bold monitor-text leading-tight">{value}</span>
      <span className="text-[9px] opacity-80">{unit}{note ? ` · ${note}` : ''}</span>
    </div>
  );
}
