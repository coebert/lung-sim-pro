import { LiveSimulation } from './liveSimulation';
import { etco2Display } from './etco2Display';
import { useSyncExternalStore } from 'react';
import {
  VentSettings,
  PatientPhysiology,
  Vitals,
  MeasuredValues,
  WaveformBuffers,
  AllModeParams,
  buildVentSettings,
} from './types';
import { BUFFER_SIZE } from './engine';
import { evaluateAlarms, alarmLimitsFor, type Alarm } from './alarms';
import { patients, getDefaultAllParams } from './patients';

/**
 * Simulation is driven outside React so the 50Hz tick loop doesn't cause
 * every consumer (controls, patient selector, alarm banner, tutorial) to
 * re-render 50 times per second. Ring buffers avoid per-tick array cloning.
 *
 * Two subscription channels:
 *   • waveforms — notified every tick (50Hz), consumed by the canvases.
 *   • vitals    — notified at ~4Hz, consumed by numeric displays, alarms,
 *                 clinical feedback and the lung animation.
 */

// ─── Fixed-size ring buffer (writes are O(1), snapshot is O(N)) ──────

class Ring {
  private data: number[];
  private head = 0;
  constructor(private size: number, private empty = 0) {
    this.data = new Array(size).fill(empty);
  }
  push(v: number): void {
    this.data[this.head] = v;
    this.head = (this.head + 1) % this.size;
  }
  reset(): void {
    this.data.fill(this.empty);
    this.head = 0;
  }
  /** Linearised copy — oldest sample first, newest last. */
  snapshot(): number[] {
    if (this.head === 0) return this.data.slice();
    return this.data.slice(this.head).concat(this.data.slice(0, this.head));
  }
  /** Read the most-recent N samples in chronological order. */
  recent(n: number): number[] {
    const take = Math.min(n, this.size);
    const start = (this.head - take + this.size) % this.size;
    if (start + take <= this.size) return this.data.slice(start, start + take);
    return this.data.slice(start).concat(this.data.slice(0, (start + take) % this.size));
  }
}

// ─── Snapshots exposed to React (immutable per notification) ─────────

export interface Trends {
  /** Cadence between samples, seconds. */
  cadenceSec: number;
  spo2: number[];
  map: number[];
  etco2: number[];
}

export interface VitalsSnapshot {
  vitals: Vitals;
  measured: MeasuredValues;
  alarms: Alarm[];
  trends: Trends;
}

export interface ControlSnapshot {
  settings: VentSettings;
  /** Full superset of ventilator parameters (persists per-mode values across mode switches). */
  allSettings: AllModeParams;
  patient: PatientPhysiology;
  prone: boolean;
  frozen: boolean;
  /** Increments on every settings or patient change (tutorials require fresh breaths). */
  revision: number;
}

// ─── Store ───────────────────────────────────────────────────────────

const VITALS_NOTIFY_INTERVAL_MS = 250;   // 4 Hz
const TICK_INTERVAL_MS = 20;             // 50 Hz — matches TICK_DT

class SimulationStore {
  private sim: LiveSimulation;

  // Controls
  private allSettings: AllModeParams;
  private settings: VentSettings;
  private patient: PatientPhysiology;
  private prone = false;
  private frozen = false;

  private alarms: Alarm[] = [];

  // Trend rings: 1Hz cadence, 5-minute window (300 samples).
  private static readonly TREND_CADENCE_SEC = 1;
  private static readonly TREND_SIZE = 300;
  private trendCounter = 0;
  private trendRings = {
    // Empty trend slots are NaN (gaps), never plotted as zero readings.
    spo2: new Ring(SimulationStore.TREND_SIZE, NaN),
    map: new Ring(SimulationStore.TREND_SIZE, NaN),
    etco2: new Ring(SimulationStore.TREND_SIZE, NaN),
  };

  private rings = {
    pressure: new Ring(BUFFER_SIZE),
    flow: new Ring(BUFFER_SIZE),
    volume: new Ring(BUFFER_SIZE),
    ecg: new Ring(BUFFER_SIZE),
    abp: new Ring(BUFFER_SIZE),
    spo2Pleth: new Ring(BUFFER_SIZE),
    capno: new Ring(BUFFER_SIZE),
    aprvMarkers: new Ring(BUFFER_SIZE),
  };
  /** Last APRV cycle phase seen, for detecting the T Low → P High wrap. */
  private prevAprvPhase = 0;
  /** Last APRV cycle length; a change resets phase tracking. */
  private prevAprvCycle = 0;

  // Cached immutable snapshots — replaced on each notification.
  private waveformSnapshot: WaveformBuffers;
  private vitalsSnapshot: VitalsSnapshot;
  private controlSnapshot: ControlSnapshot;

  private waveformListeners = new Set<() => void>();
  private vitalsListeners = new Set<() => void>();
  private controlListeners = new Set<() => void>();

  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private msSinceVitalsNotify = 0;
  private refCount = 0;

  constructor(patient: PatientPhysiology) {
    this.patient = patient;
    this.allSettings = getDefaultAllParams(patient);
    this.settings = buildVentSettings(this.allSettings);
    this.sim = new LiveSimulation(this.settings, patient);
    this.waveformSnapshot = this.buildWaveformSnapshot();
    this.vitalsSnapshot = this.buildVitalsSnapshot();
    this.controlSnapshot = {
      settings: this.settings,
      allSettings: this.allSettings,
      patient: this.patient,
      prone: this.prone,
      frozen: this.frozen,
      revision: this.sim.revision,
    };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  private ensureRunning() {
    if (this.tickTimer !== null) return;
    this.tickTimer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  private maybeStop() {
    if (this.refCount > 0 || this.tickTimer === null) return;
    clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  // ── Control setters ────────────────────────────────────────────────

  /** Patch any subset of the ventilator parameters (including `mode`). The store
   * retains all parameters across mode switches. */
  updateSettings = (patch: Partial<AllModeParams>) => {
    // I:E and Ti are alternative ways to set timing — whichever was set last wins.
    if ('ieRatio' in patch && !('inspiratoryTime' in patch)) patch = { ...patch, inspiratoryTime: 0 };
    const modeChanged = 'mode' in patch && patch.mode !== this.allSettings.mode;
    this.allSettings = { ...this.allSettings, ...patch };
    this.settings = buildVentSettings(this.allSettings);
    this.sim.setSettings(this.settings, modeChanged);
    if (modeChanged) {
      // A mode switch starts the traces fresh: the loop window spans ~8 s,
      // so leftover breaths from the previous mode would otherwise draw a
      // hybrid loop (e.g. VCV ramps mixed into the APRV box) for several
      // seconds — much longer on throttled/slow timers.
      Object.values(this.rings).forEach(r => r.reset());
      this.prevAprvPhase = 0;
      this.prevAprvCycle = 0;
      this.emitWaveforms();
    }
    this.emitControls();
  };

  setPatient = (patient: PatientPhysiology) => {
    this.patient = patient;
    // A new patient starts from fresh default settings, supine.
    this.allSettings = getDefaultAllParams(patient);
    this.settings = buildVentSettings(this.allSettings);
    this.prone = false;
    this.msSinceVitalsNotify = 0;
    this.sim.setPatient(patient, this.settings);
    this.alarms = [];
    Object.values(this.rings).forEach(r => r.reset());
    Object.values(this.trendRings).forEach(r => r.reset());
    this.trendCounter = 0;
    this.prevAprvPhase = 0;
    this.emitControls();
    this.emitWaveforms();
    this.emitVitals();
  };

  setProne = (prone: boolean) => {
    this.prone = prone;
    this.emitControls();
  };

  toggleProne = () => this.setProne(!this.prone);

  setFrozen = (frozen: boolean) => {
    this.frozen = frozen;
    this.emitControls();
  };

  toggleFrozen = () => this.setFrozen(!this.frozen);

  // ── Subscriptions (for useSyncExternalStore) ───────────────────────

  subscribeWaveforms = (fn: () => void): (() => void) => {
    this.waveformListeners.add(fn);
    this.refCount++;
    this.ensureRunning();
    return () => {
      this.waveformListeners.delete(fn);
      this.refCount--;
      this.maybeStop();
    };
  };
  getWaveformSnapshot = (): WaveformBuffers => this.waveformSnapshot;

  subscribeVitals = (fn: () => void): (() => void) => {
    this.vitalsListeners.add(fn);
    this.refCount++;
    this.ensureRunning();
    return () => {
      this.vitalsListeners.delete(fn);
      this.refCount--;
      this.maybeStop();
    };
  };
  getVitalsSnapshot = (): VitalsSnapshot => this.vitalsSnapshot;

  subscribeControls = (fn: () => void): (() => void) => {
    this.controlListeners.add(fn);
    return () => this.controlListeners.delete(fn);
  };
  getControlSnapshot = (): ControlSnapshot => this.controlSnapshot;

  // ── Simulation tick ────────────────────────────────────────────────

  private tick() {
    if (this.frozen) return;
    const sample = this.sim.step();
    this.rings.pressure.push(sample.pressure);
    this.rings.flow.push(sample.flow);
    this.rings.volume.push(sample.volume);
    this.rings.ecg.push(sample.ecg);
    this.rings.abp.push(sample.abp);
    this.rings.spo2Pleth.push(sample.spo2Pleth);
    this.rings.capno.push(sample.capno);

    // APRV: flag the sample where the cycle wraps from T Low back to P High,
    // so the flow trace can mark the moment relative to expiratory flow.
    if (this.settings.mode === 'APRV') {
      const totalCycle = Math.max(0.2, this.settings.tHigh + this.settings.tLow);
      if (totalCycle !== this.prevAprvCycle) {
        this.prevAprvCycle = totalCycle;
        this.prevAprvPhase = 0;
      }
      const phase = this.sim.time % totalCycle;
      this.rings.aprvMarkers.push(phase < this.prevAprvPhase ? 1 : 0);
      this.prevAprvPhase = phase;
    } else {
      this.rings.aprvMarkers.push(0);
      this.prevAprvPhase = 0;
    }

    // Waveforms notify every tick (50Hz) — canvases need every sample.
    this.emitWaveforms();

    // Recompute measured + vitals + alarms only at the vitals rate (4Hz),
    // from complete breaths (see measurement.ts).
    this.msSinceVitalsNotify += TICK_INTERVAL_MS;
    if (this.msSinceVitalsNotify >= VITALS_NOTIFY_INTERVAL_MS) {
      this.msSinceVitalsNotify = 0;
      this.sim.update(this.prone, VITALS_NOTIFY_INTERVAL_MS / 20);
      this.alarms = evaluateAlarms(this.sim.measured, this.sim.displayedVitals(), alarmLimitsFor(this.patient), this.settings, this.patient);

      // Trends at 1Hz (every 4th vitals tick @ 250ms).
      this.trendCounter++;
      if (this.trendCounter >= 4) {
        this.trendCounter = 0;
        const v = this.sim.displayedVitals();
        this.trendRings.spo2.push(v.spo2);
        this.trendRings.map.push((v.sbp + 2 * v.dbp) / 3);
        this.trendRings.etco2.push(etco2Display(v).kPa); // kPa, NaN when no valid sample
      }

      this.emitVitals();
    }
  }

  // ── Snapshot building + emit ───────────────────────────────────────

  private buildWaveformSnapshot(): WaveformBuffers {
    return {
      pressure: this.rings.pressure.snapshot(),
      flow: this.rings.flow.snapshot(),
      volume: this.rings.volume.snapshot(),
      ecg: this.rings.ecg.snapshot(),
      abp: this.rings.abp.snapshot(),
      spo2Pleth: this.rings.spo2Pleth.snapshot(),
      capno: this.rings.capno.snapshot(),
      aprvCycleMarkers: this.rings.aprvMarkers.snapshot(),
    };
  }

  private emitWaveforms() {
    this.waveformSnapshot = this.buildWaveformSnapshot();
    this.waveformListeners.forEach(l => l());
  }

  private buildVitalsSnapshot(): VitalsSnapshot {
    return {
      vitals: this.sim.displayedVitals(),
      measured: this.sim.measured,
      alarms: this.alarms,
      trends: {
        cadenceSec: SimulationStore.TREND_CADENCE_SEC,
        spo2: this.trendRings.spo2.snapshot(),
        map: this.trendRings.map.snapshot(),
        etco2: this.trendRings.etco2.snapshot(),
      },
    };
  }

  private emitVitals() {
    this.vitalsSnapshot = this.buildVitalsSnapshot();
    this.vitalsListeners.forEach(l => l());
  }

  private emitControls() {
    this.controlSnapshot = {
      settings: this.settings,
      allSettings: this.allSettings,
      patient: this.patient,
      prone: this.prone,
      frozen: this.frozen,
      revision: this.sim.revision,
    };
    this.controlListeners.forEach(l => l());
  }
}

// ─── Singleton + hooks ───────────────────────────────────────────────

const defaultPatient = patients[0];
export const simulationStore = new SimulationStore(defaultPatient);

export function useWaveforms(): WaveformBuffers {
  return useSyncExternalStore(
    simulationStore.subscribeWaveforms,
    simulationStore.getWaveformSnapshot,
    simulationStore.getWaveformSnapshot,
  );
}

export function useVitalsSnapshot(): VitalsSnapshot {
  return useSyncExternalStore(
    simulationStore.subscribeVitals,
    simulationStore.getVitalsSnapshot,
    simulationStore.getVitalsSnapshot,
  );
}

export function useControls(): ControlSnapshot {
  return useSyncExternalStore(
    simulationStore.subscribeControls,
    simulationStore.getControlSnapshot,
    simulationStore.getControlSnapshot,
  );
}
