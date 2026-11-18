import { VentSettings, VentMode, AllModeParams, PatientPhysiology } from '@/lib/simulation/types';
import { prvcInspPressure, psvInspTime, simvSupportInspTime, aprvReleaseMetrics, PRVC_PMAX_RESERVE } from '@/lib/simulation/waveformGenerators';
import { computeIE, type IEMetrics } from '@/lib/simulation/scoring';
import { controlSpec } from '@/lib/simulation/controlSpecs';
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
  // Timing basis is stored with the settings (explicit Ti > 0 ⇒ Ti control),
  // and every readout uses the same calculation the engine applies.
  const ie = computeIE(settings);
  const timingMode: TimingMode = ie.basis;
  const setTimingMode = (m: TimingMode) => {
    if (m === timingMode) return;
    if (m === 'ti') onUpdate({ inspiratoryTime: Math.max(0.3, Math.min(3, Math.round(ie.iTime * 10) / 10)) });
    else onUpdate({ ieRatio: Math.max(0.25, Math.min(4, Math.round(ie.eRatio * 4) / 4)), inspiratoryTime: 0 });
  };
  // Ranges come from the shared control spec (also used by reachability tests).
  const R = (f: keyof AllModeParams) => controlSpec(f, settings.mode, patient) ?? { min: 0, max: 0, step: 1 };

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
            {...R('peep')}
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
              label="P limit"
              value={settings.pLimit}
              unit="cmH₂O"
              {...R('pLimit')}
              onChange={(v) => onUpdate({ pLimit: v })}
            />
            <SettingControl
              label="TV"
              value={settings.tidalVolume}
              unit="mL"
              {...R('tidalVolume')}
              onChange={(v) => onUpdate({ tidalVolume: v })}
            />
            <SettingControl
              label="RR"
              value={settings.respiratoryRate}
              unit="/min"
              {...R('respiratoryRate')}
              onChange={(v) => onUpdate({ respiratoryRate: v })}
            />
            <TimingToggleAndControl
              timingMode={timingMode}
              onTimingModeChange={setTimingMode}
              ieRatio={settings.ieRatio}
              inspiratoryTime={settings.inspiratoryTime}
              onUpdate={onUpdate}
              ie={ie}
            />
          </>
        )}

        {settings.mode === 'PCV' && (
          <>
            <SettingControl
              label="Pinsp"
              value={settings.pInsp}
              unit="cmH₂O"
              {...R('pInsp')}
              onChange={(v) => onUpdate({ pInsp: v })}
            />
            <SettingControl
              label="Rise"
              value={settings.riseTime}
              unit="sec"
              {...R('riseTime')}
              onChange={(v) => onUpdate({ riseTime: Math.round(v * 100) / 100 })}
            />
            <SettingControl
              label="RR"
              value={settings.respiratoryRate}
              unit="/min"
              {...R('respiratoryRate')}
              onChange={(v) => onUpdate({ respiratoryRate: v })}
            />
            <TimingToggleAndControl
              timingMode={timingMode}
              onTimingModeChange={setTimingMode}
              ieRatio={settings.ieRatio}
              inspiratoryTime={settings.inspiratoryTime}
              onUpdate={onUpdate}
              ie={ie}
            />
          </>
        )}

        {settings.mode === 'PRVC' && (
          <>
            <SettingControl
              label="Target TV"
              value={settings.tidalVolume}
              unit="mL"
              {...R('tidalVolume')}
              onChange={(v) => onUpdate({ tidalVolume: v })}
            />
            <SettingControl
              label="RR"
              value={settings.respiratoryRate}
              unit="/min"
              {...R('respiratoryRate')}
              onChange={(v) => onUpdate({ respiratoryRate: v })}
            />
            <SettingControl
              label="Pmax"
              value={settings.pMax}
              unit="cmH₂O"
              {...R('pMax')}
              onChange={(v) => onUpdate({ pMax: v })}
            />
            <SettingControl
              label="Rise"
              value={settings.riseTime}
              unit="sec"
              {...R('riseTime')}
              onChange={(v) => onUpdate({ riseTime: Math.round(v * 100) / 100 })}
            />
            {patient && (() => {
              const r = prvcInspPressure(settings, patient);
              return (
                <ReadoutTile
                  label="Pinsp auto"
                  value={(r.pInsp).toFixed(0)}
                  unit="cmH₂O"
                  warn={r.limited || r.conflict}
                  note={r.conflict ? `Pmax ≤ PEEP+${PRVC_PMAX_RESERVE}: no breath` : r.limited ? `Pmax−${PRVC_PMAX_RESERVE} limit: target VT not reached` : 'regulated'}
                />
              );
            })()}
            <TimingToggleAndControl
              timingMode={timingMode}
              onTimingModeChange={setTimingMode}
              ieRatio={settings.ieRatio}
              inspiratoryTime={settings.inspiratoryTime}
              onUpdate={onUpdate}
              ie={ie}
            />
          </>
        )}

        {settings.mode === 'SIMV' && (
          <>
            <SettingControl
              label="PS"
              value={settings.pressureSupport}
              unit="cmH₂O"
              {...R('pressureSupport')}
              onChange={(v) => onUpdate({ pressureSupport: v })}
            />
            <SettingControl
              label="Rise"
              value={settings.riseTime}
              unit="sec"
              {...R('riseTime')}
              onChange={(v) => onUpdate({ riseTime: Math.round(v * 100) / 100 })}
            />
            <SettingControl
              label="ETS"
              value={settings.ets}
              unit="% pk"
              {...R('ets')}
              onChange={(v) => onUpdate({ ets: v })}
            />
            <SettingControl
              label="Trigger"
              value={settings.triggerSens}
              unit="L/min"
              {...R('triggerSens')}
              onChange={(v) => onUpdate({ triggerSens: Math.round(v * 10) / 10 })}
            />
            {patient && patient.spontaneousRate > 0 && settings.pressureSupport > 0 && (
              <ReadoutTile
                label="Ti (PS)"
                value={simvSupportInspTime(settings, patient).toFixed(2)}
                unit="sec"
                warn={simvSupportInspTime(settings, patient) >= 1.5}
                note="support breaths"
              />
            )}
          </>
        )}

        {settings.mode === 'PSV' && (
          <>
            <SettingControl
              label="PS"
              value={settings.pressureSupport}
              unit="cmH₂O"
              {...R('pressureSupport')}
              onChange={(v) => onUpdate({ pressureSupport: v })}
            />
            <SettingControl
              label="Rise"
              value={settings.riseTime}
              unit="sec"
              {...R('riseTime')}
              onChange={(v) => onUpdate({ riseTime: Math.round(v * 100) / 100 })}
            />
            <SettingControl
              label="ETS"
              value={settings.ets}
              unit="% pk"
              {...R('ets')}
              onChange={(v) => onUpdate({ ets: v })}
            />
            <SettingControl
              label="Trigger"
              value={settings.triggerSens}
              unit="L/min"
              {...R('triggerSens')}
              onChange={(v) => onUpdate({ triggerSens: Math.round(v * 10) / 10 })}
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
              {...R('pHigh')}
              onChange={(v) => onUpdate({ pHigh: v })}
            />
            <SettingControl
              label="P Low"
              value={settings.pLow}
              unit="cmH₂O"
              {...R('pLow')}
              onChange={(v) => onUpdate({ pLow: v })}
            />
            <SettingControl
              label="T High"
              value={settings.tHigh}
              unit="sec"
              {...R('tHigh')}
              onChange={(v) => onUpdate({ tHigh: v })}
            />
            <SettingControl
              label="T Low"
              value={settings.tLow}
              unit="sec"
              {...R('tLow')}
              onChange={(v) => onUpdate({ tLow: v })}
            />
            {settings.pHigh <= settings.pLow ? (
              <ReadoutTile label="Release" value="none" unit="P High ≤ P Low" warn note="CPAP only, no mandatory ventilation" />
            ) : patient && (() => {
              const r = aprvReleaseMetrics(settings, patient);
              return (
                <ReadoutTile
                  label="End-release flow"
                  value={`${r.endToPeakFlowPct}`}
                  unit="% of peak"
                  note={`release ${Math.round(r.releaseVolume)} mL`}
                />
              );
            })()}
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
  ie,
}: {
  timingMode: TimingMode;
  onTimingModeChange: (m: TimingMode) => void;
  ieRatio: number;
  inspiratoryTime: number;
  onUpdate: (patch: Partial<AllModeParams>) => void;
  /** Applied timing — identical to what the engine uses. */
  ie: IEMetrics;
}) {
  const isWarning = ie.eTime < 0.5 || ie.limited;
  const appliedIE = ie.ieActual <= 1 ? `1:${ie.eRatio.toFixed(1)}` : `${ie.ieActual.toFixed(1)}:1`;

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
          {timingMode === 'ie' ? 'Applied Ti' : 'Applied I:E'}
        </span>
        <span className={`monitor-text text-sm font-bold ${isWarning ? 'text-destructive' : 'text-foreground'}`}>
          {timingMode === 'ie' ? `${ie.iTime.toFixed(2)}s` : appliedIE}
        </span>
        <span className="text-[9px] text-muted-foreground">Te {ie.eTime.toFixed(2)}s</span>
        {ie.limited && (
          <span className="text-[9px] text-destructive text-center leading-tight" role="status">
            Entered Ti {ie.requestedTi.toFixed(1)}s limited to leave {ie.eTime.toFixed(1)}s expiration
          </span>
        )}
        {!ie.limited && ie.eTime < 0.5 && (
          <span className="text-[9px] text-destructive text-center leading-tight" role="status">Short expiration — risk of gas trapping</span>
        )}
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
