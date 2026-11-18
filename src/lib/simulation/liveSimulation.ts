import { MeasuredValues, PatientPhysiology, VentSettings, Vitals } from './types';
import { CardiacClock, CapnoSensor, breathKindAt, triggerStats } from './waveformGenerators';
import {
  TICK_DT, baselinePressure, createInitialVitals, generateWaveformSample, updateVitals, isApnoeic,
  type WaveformSample,
} from './engine';
import { BreathTracker, measureFromBreaths } from './measurement';

export const EMPTY_MEASURED: MeasuredValues = {
  peakPressure: 0, plateauPressure: 0, meanPressure: 0, autoPEEP: 0,
  measuredTV: 0, minuteVentilation: 0, measuredRR: 0, dynamicCompliance: 0, warmingUp: true,
};

/**
 * Simulation core shared by the live store and headless tests: advances the
 * waveform generator at 50 Hz, tracks breaths, and updates measurements and
 * vitals from complete breaths. Holds no display buffers.
 */
export class LiveSimulation {
  time = 0;
  revision = 0;
  /** Simulation time of the last settings change. */
  since = 0;
  vitals: Vitals;
  measured: MeasuredValues = { ...EMPTY_MEASURED };
  readonly tracker = new BreathTracker();
  readonly cardiac = new CardiacClock();
  private capno: CapnoSensor;

  constructor(public settings: VentSettings, public patient: PatientPhysiology) {
    this.vitals = createInitialVitals(patient);
    this.capno = new CapnoSensor(patient);
  }

  /** New settings: measurements restart on fresh breaths; `restart` also clears the breath clock. */
  setSettings(settings: VentSettings, restart = false): void {
    this.settings = settings;
    this.revision++;
    if (restart) {
      this.time = 0;
      this.tracker.reset(0);
      this.capno = new CapnoSensor(this.patient);
    }
    this.since = this.time;
  }

  setPatient(patient: PatientPhysiology, settings: VentSettings): void {
    this.patient = patient;
    this.settings = settings;
    this.revision++;
    this.time = 0;
    this.since = 0;
    this.vitals = createInitialVitals(patient);
    this.measured = { ...EMPTY_MEASURED };
    this.tracker.reset(0);
    this.cardiac.reset();
    this.capno = new CapnoSensor(patient);
  }

  step(): WaveformSample {
    this.time += TICK_DT;
    const sample = generateWaveformSample(this.time, this.settings, this.patient, this.vitals, this.cardiac.next(this.vitals.hr), this.capno);
    this.tracker.push(this.time, sample.pressure, sample.flow, sample.volume, sample.capno, breathKindAt(this.time, this.settings, this.patient));
    return sample;
  }

  /** Recompute measured values and advance vitals by `ticks` 20 ms ticks. */
  update(prone: boolean, ticks: number): void {
    this.measured = measureFromBreaths(
      this.tracker, this.time, this.since, baselinePressure(this.settings),
      this.settings, this.patient, this.measured, this.revision,
    );
    if (!this.measured.warmingUp) {
      const from = Math.max(this.since, this.time - 60);
      const st = triggerStats(this.settings, this.patient, from, this.time);
      const r1 = (v: number) => Math.round(v * 10) / 10;
      this.measured = { ...this.measured, effortRate: r1(st.effortRate), missedTriggers: r1(st.missedTriggers), autoTriggers: r1(st.autoTriggers), machineRate: r1(st.machineRate), assistedRate: r1(st.assistedRate), mandatoryRate: r1(st.mandatoryRate), pressureLimited: r1(st.pressureLimited) };
    }
    // Hold physiology until a complete breath on the new settings has been measured.
    if (!this.measured.warmingUp) {
      this.vitals = updateVitals(this.settings, this.patient, this.vitals, this.measured, prone, ticks);
    }
  }

  /** Vitals as the monitor shows them: EtCO₂ sampled from the last complete breath's capnogram. */
  displayedVitals(): Vitals {
    const alveolar = this.vitals.paco2 ?? this.vitals.etco2;
    const last = this.tracker.breaths[this.tracker.breaths.length - 1];
    if (this.measured.warmingUp && !this.measured.apnoea) {
      return { ...this.vitals, etco2: 0, etco2Status: 'measuring' };
    }
    if (isApnoeic(this.measured) || !last || last.capPeak < 1) {
      return { ...this.vitals, etco2: 0, etco2Status: 'unavailable' };
    }
    const status = last.capPeak >= alveolar * 0.97 ? 'plateau' : 'no-plateau';
    return { ...this.vitals, etco2: Math.round(last.capPeak * 10) / 10, etco2Status: status };
  }

  /** Run headlessly for `seconds`, updating measurements at 4 Hz like the live store. */
  run(seconds: number, prone = false): void {
    const steps = Math.round(seconds / TICK_DT);
    for (let i = 1; i <= steps; i++) {
      this.step();
      if (i % 13 === 0 || i === steps) this.update(prone, 12.5);
    }
  }
}
