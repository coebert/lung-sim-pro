/**
 * End-to-end flows through the LIVE simulation store (fake timers drive its
 * 50 Hz loop) and the real React panels the learner sees.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { simulationStore, useControls, useVitalsSnapshot } from '@/lib/simulation/simulationStore';
import { patients } from '@/lib/simulation/patients';
import { TutorialPanel } from '@/components/simulator/TutorialPanel';
import { ClinicalFeedback } from '@/components/simulator/ClinicalFeedback';
import { TrendStrip } from '@/components/simulator/TrendStrip';
import { etco2Display } from '@/lib/simulation/etco2Display';

const P = (id: string) => patients.find(p => p.id === id)!;

function Harness({ tutorial = true }: { tutorial?: boolean }) {
  const c = useControls();
  const { vitals, measured, alarms, trends } = useVitalsSnapshot();
  const e = etco2Display(vitals);
  return (
    <div>
      <div data-testid="header-etco2">EtCO₂ {e.text}{e.note ? ` (${e.note})` : ''}</div>
      <div data-testid="alarms">{alarms.filter(a => a.active).map(a => a.id).join(',')}</div>
      <TrendStrip spo2={trends.spo2} map={trends.map} etco2={trends.etco2} cadenceSec={trends.cadenceSec} />
      <ClinicalFeedback settings={c.settings} patient={c.patient} vitals={vitals} measured={measured} />
      {tutorial && (
        <TutorialPanel patient={c.patient} settings={c.settings} allSettings={c.allSettings}
          vitals={vitals} measured={measured} settingsRevision={c.revision} onClose={() => {}} />
      )}
    </div>
  );
}

const run = (sec: number) => act(() => { vi.advanceTimersByTime(sec * 1000); });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('live store: CO₂ display and advice (#4)', () => {
  it('COPD PCV RR40: no capnographic signal → dash everywhere, no hypocapnia advice, SpO₂ falls', () => {
    act(() => {
      simulationStore.setPatient(P('copd'));
      simulationStore.updateSettings({ mode: 'PCV', respiratoryRate: 40, inspiratoryTime: 1.4, pInsp: 15, peep: 5, fio2: 0.4, riseTime: 0 });
    });
    render(<Harness tutorial={false} />);
    run(90);
    const v = simulationStore.getVitalsSnapshot();
    expect(v.measured.measuredTV).toBeGreaterThan(60);
    expect(v.measured.alveolarVentilation).toBe(0);
    expect(screen.getByTestId('header-etco2').textContent).toBe('EtCO₂ — (no signal)');
    expect(screen.queryByText(/Hypocapnia/)).toBeNull();
    expect(screen.queryByText(/Reduce minute ventilation/i)).toBeNull();
    expect(screen.getByText(/No capnographic signal/)).toBeInTheDocument();
    expect(v.vitals.spo2).toBeLessThan(80);
    // Trends never plot an invalid EtCO₂ as a value.
    expect(v.trends.etco2.slice(-30).every(x => Number.isNaN(x))).toBe(true);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows "measuring" (not a stale number) right after a settings change', () => {
    act(() => { simulationStore.setPatient(P('healthy')); });
    render(<Harness tutorial={false} />);
    run(20);
    expect(screen.getByTestId('header-etco2').textContent).toMatch(/EtCO₂ \d/);
    act(() => { simulationStore.updateSettings({ tidalVolume: 450 }); });
    run(0.5);
    expect(screen.getByTestId('header-etco2').textContent).toBe('EtCO₂ — (measuring)');
    run(6);
    expect(screen.getByTestId('header-etco2').textContent).toMatch(/EtCO₂ \d/);
  });
});

describe('live store: tutorial rollback and completion (#5)', () => {
  it('ARDS step 1 earned in VCV loses its success and Next when switched to apnoeic PSV, then recovers', () => {
    act(() => { simulationStore.setPatient(P('ards')); simulationStore.updateSettings({ tidalVolume: 350 }); });
    render(<Harness />);
    run(15);
    expect(screen.getByText(/Delivered tidal volume is protective/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next/ })).toBeInTheDocument();

    act(() => { simulationStore.updateSettings({ mode: 'PSV' }); });
    run(30);
    expect(simulationStore.getVitalsSnapshot().measured.apnoea).toBe(true);
    expect(screen.queryByText(/Delivered tidal volume is protective/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Next/ })).toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/no longer met/);

    act(() => { simulationStore.updateSettings({ mode: 'VCV' }); });
    run(1);
    expect(screen.queryByText(/Delivered tidal volume is protective/)).toBeNull(); // not fresh yet
    run(10);
    expect(screen.getByText(/Delivered tidal volume is protective/)).toBeInTheDocument();
  });

  it('paediatric lesson completes through the UI, and the summary withdraws if a step is undone', () => {
    act(() => { simulationStore.setPatient(P('paediatric')); });
    render(<Harness />);
    act(() => { simulationStore.updateSettings({ mode: 'PCV' }); });
    run(5);
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    run(2); // RR 24 / PEEP 6 are the case defaults
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    act(() => { simulationStore.updateSettings({ pInsp: 11 }); });
    run(60);
    expect(screen.getByText('Scenario Complete!')).toBeInTheDocument();
    act(() => { simulationStore.updateSettings({ respiratoryRate: 14 }); });
    run(1);
    expect(screen.queryByText('Scenario Complete!')).toBeNull();
  });
});

describe('live store: interaction cases (#1, #2, #3)', () => {
  it('auto-trigger case shows the auto-trigger explanation; a 4 L/min trigger removes it', () => {
    act(() => { simulationStore.setPatient(P('autotrigger')); });
    render(<Harness tutorial={false} />);
    run(60);
    expect(screen.getByText(/Auto-triggering:/)).toBeInTheDocument();
    act(() => { simulationStore.updateSettings({ triggerSens: 4 }); });
    run(60);
    expect(screen.queryByText(/Auto-triggering:/)).toBeNull();
  });
  it('missed-trigger case explains intrinsic PEEP; ETS 40 restores triggering', () => {
    act(() => { simulationStore.setPatient(P('copd-spont')); });
    render(<Harness tutorial={false} />);
    run(60);
    expect(screen.getByText(/Missed triggering:/)).toBeInTheDocument();
    act(() => { simulationStore.updateSettings({ ets: 40 }); });
    run(60);
    expect(screen.queryByText(/Missed triggering:/)).toBeNull();
  });
  it('pressure-limited case raises the limit alarm until Ti is lengthened', () => {
    act(() => { simulationStore.setPatient(P('pressure-limited')); });
    render(<Harness tutorial={false} />);
    run(30);
    expect(screen.getByTestId('alarms').textContent).toContain('p-limit');
    act(() => { simulationStore.updateSettings({ respiratoryRate: 10, inspiratoryTime: 1.2 }); });
    run(30);
    expect(screen.getByTestId('alarms').textContent).not.toContain('p-limit');
  });
  it('SIMV measured rate does not fall when the mandatory rate rises 8 → 10 → 20', () => {
    act(() => { simulationStore.setPatient(P('healthy-spont')); simulationStore.updateSettings({ mode: 'SIMV', respiratoryRate: 8, pressureSupport: 1 }); });
    render(<Harness tutorial={false} />);
    const rates: number[] = [];
    for (const rr of [8, 10, 20]) {
      act(() => { simulationStore.updateSettings({ respiratoryRate: rr }); });
      run(70);
      rates.push(simulationStore.getVitalsSnapshot().measured.measuredRR);
    }
    expect(rates[1]).toBeGreaterThanOrEqual(rates[0] - 0.5);
    expect(rates[2]).toBeGreaterThanOrEqual(19);
  });
  it('APRV with equal pressures: self-ventilating adult breathes with exhaled CO₂; paralysed adult is apnoeic', () => {
    act(() => { simulationStore.setPatient(P('healthy-spont')); simulationStore.updateSettings({ mode: 'APRV', pHigh: 10, pLow: 10 }); });
    render(<Harness tutorial={false} />);
    run(60);
    let s = simulationStore.getVitalsSnapshot();
    expect(s.measured.measuredTV).toBeGreaterThan(300);
    expect(s.measured.measuredRR).toBeCloseTo(14, 0);
    expect(s.vitals.etco2Status).toBe('plateau');
    expect(screen.getByTestId('alarms').textContent).not.toContain('apnoea');
    act(() => { simulationStore.setPatient(P('healthy')); simulationStore.updateSettings({ mode: 'APRV', pHigh: 10, pLow: 10 }); });
    run(40);
    s = simulationStore.getVitalsSnapshot();
    expect(s.measured.apnoea).toBe(true);
    expect(screen.getByTestId('alarms').textContent).toContain('apnoea');
    expect(screen.getByTestId('header-etco2').textContent).toBe('EtCO₂ — (no signal)');
  });
});

describe('live feedback wording (#4, labels)', () => {
  it('COPD SpO₂ 90% is within its 88–92% target, not "low"; healthy 92% is below its 94% target', () => {
    function Fb({ spo2 }: { spo2: number }) {
      const c = useControls();
      const { vitals, measured } = useVitalsSnapshot();
      return <ClinicalFeedback settings={c.settings} patient={c.patient} vitals={{ ...vitals, spo2 }} measured={measured} />;
    }
    act(() => { simulationStore.setPatient(P('copd')); });
    const { container, unmount } = render(<Fb spo2={90} />);
    run(30);
    expect(container.textContent).toMatch(/SpO₂ 90% is within this patient's target \(88–92%\)/);
    expect(container.textContent).not.toMatch(/below this patient's target/);
    unmount();
    act(() => { simulationStore.setPatient(P('healthy')); });
    const h = render(<Fb spo2={92} />);
    run(30);
    expect(h.container.textContent).toMatch(/SpO₂ 92% is below this patient's target \(94–100%\)/);
  });
  it('bronchospasm: low dynamic compliance is attributed to resistance, not stiff lungs', () => {
    act(() => { simulationStore.setPatient(P('bronchospasm')); });
    render(<Harness tutorial={false} />);
    run(40);
    expect(screen.queryByText(/Stiff lungs/)).toBeNull();
  });
  it('ARDS target-limited PRVC: no "lung-protective strategy in place" reassurance', () => {
    act(() => { simulationStore.setPatient(P('ards')); simulationStore.updateSettings({ mode: 'PRVC', tidalVolume: 350, peep: 10, pMax: 17, respiratoryRate: 14 }); });
    render(<Harness />);
    run(100);
    expect(simulationStore.getVitalsSnapshot().measured.measuredTV).toBeLessThan(150);
    expect(screen.queryByText(/Lung-protective strategy in place/)).toBeNull();
    expect(screen.queryByText(/Delivered tidal volume is protective/)).toBeNull();
  });
});
