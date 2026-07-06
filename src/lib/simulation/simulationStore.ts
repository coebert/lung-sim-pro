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
import {
  BUFFER_SIZE,
  RECENT_WINDOW,
  TICK_DT,
  computeMeasured,
  createInitialVitals,
  generateWaveformSample,
  updateVitals,
} from './engine';
import { evaluateAlarms, DEFAULT_ALARM_LIMITS, type Alarm } from './alarms';
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
  constructor(private size: number) {
    this.data = new Array(size).fill(0);
  }
  push(v: number): void {
    this.data[this.head] = v;
    this.head = (this.head + 1) % this.size;
  }
  reset(): void {
    this.data.fill(0);
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
}

// ─── Store ───────────────────────────────────────────────────────────

const VITALS_NOTIFY_INTERVAL_MS = 250;   // 4 Hz
const TICK_INTERVAL_MS = 20;             // 50 Hz — matches TICK_DT

class SimulationStore {
  private time = 0;

  // Controls
  private allSettings: AllModeParams;
  private settings: VentSettings;
  private patient: PatientPhysiology;
  private prone = false;
  private frozen = false;

  // Live physiology
  private vitals: Vitals;
  private measured: MeasuredValues = {
    peakPressure: 0, plateauPressure: 0, meanPressure: 0,
    measuredTV: 0, minuteVentilation: 0, measuredRR: 14, dynamicCompliance: 0,
  };
  private alarms: Alarm[] = [];

  // Trend rings: 1Hz cadence, 5-minute window (300 samples).
  private static readonly TREND_CADENCE_SEC = 1;
  private static readonly TREND_SIZE = 300;
  private trendCounter = 0;
  private trendRings = {
    spo2: new Ring(SimulationStore.TREND_SIZE),
    map: new Ring(SimulationStore.TREND_SIZE),
    etco2: new Ring(SimulationStore.TREND_SIZE),
  };

  private rings = {
    pressure: new Ring(BUFFER_SIZE),
    flow: new Ring(BUFFER_SIZE),
    volume: new Ring(BUFFER_SIZE),
    ecg: new Ring(BUFFER_SIZE),
    abp: new Ring(BUFFER_SIZE),
    spo2Pleth: new Ring(BUFFER_SIZE),
    capno: new Ring(BUFFER_SIZE),
  };

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
    this.vitals = createInitialVitals(patient);
    this.waveformSnapshot = this.buildWaveformSnapshot();
    this.vitalsSnapshot = this.buildVitalsSnapshot();
    this.controlSnapshot = {
      settings: this.settings,
      allSettings: this.allSettings,
      patient: this.patient,
      prone: this.prone,
      frozen: this.frozen,
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
    this.allSettings = { ...this.allSettings, ...patch };
    this.settings = buildVentSettings(this.allSettings);
    this.emitControls();
  };

  setPatient = (patient: PatientPhysiology) => {
    this.patient = patient;
    this.vitals = createInitialVitals(patient);
    this.measured = {
      peakPressure: 0, plateauPressure: 0, meanPressure: 0,
      measuredTV: 0, minuteVentilation: 0, measuredRR: 14, dynamicCompliance: 0,
    };
    this.alarms = [];
    Object.values(this.rings).forEach(r => r.reset());
    Object.values(this.trendRings).forEach(r => r.reset());
    this.trendCounter = 0;
    this.time = 0;
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
    this.time += TICK_DT;

    const sample = generateWaveformSample(this.time, this.settings, this.patient, this.vitals);
    this.rings.pressure.push(sample.pressure);
    this.rings.flow.push(sample.flow);
    this.rings.volume.push(sample.volume);
    this.rings.ecg.push(sample.ecg);
    this.rings.abp.push(sample.abp);
    this.rings.spo2Pleth.push(sample.spo2Pleth);
    this.rings.capno.push(sample.capno);

    // Waveforms notify every tick (50Hz) — canvases need every sample.
    this.emitWaveforms();

    // Recompute measured + vitals + alarms only at the vitals rate (4Hz).
    this.msSinceVitalsNotify += TICK_INTERVAL_MS;
    if (this.msSinceVitalsNotify >= VITALS_NOTIFY_INTERVAL_MS) {
      this.msSinceVitalsNotify = 0;
      const actualRR = this.settings.mode === 'PSV'
        ? (this.patient.spontaneousRate || 12)
        : this.settings.respiratoryRate;
      this.measured = computeMeasured(
        this.rings.pressure.recent(RECENT_WINDOW),
        this.rings.volume.recent(RECENT_WINDOW),
        actualRR,
        this.settings.peep,
      );
      this.vitals = updateVitals(this.settings, this.patient, this.vitals, this.measured, this.prone);
      this.alarms = evaluateAlarms(this.measured, this.vitals, DEFAULT_ALARM_LIMITS);

      // Trends at 1Hz (every 4th vitals tick @ 250ms).
      this.trendCounter++;
      if (this.trendCounter >= 4) {
        this.trendCounter = 0;
        this.trendRings.spo2.push(this.vitals.spo2);
        this.trendRings.map.push((this.vitals.sbp + 2 * this.vitals.dbp) / 3);
        this.trendRings.etco2.push(this.vitals.etco2 / 7.501); // → kPa
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
    };
  }

  private emitWaveforms() {
    this.waveformSnapshot = this.buildWaveformSnapshot();
    this.waveformListeners.forEach(l => l());
  }

  private buildVitalsSnapshot(): VitalsSnapshot {
    return {
      vitals: this.vitals,
      measured: this.measured,
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
