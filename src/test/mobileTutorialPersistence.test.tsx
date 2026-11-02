import { describe, it, expect, vi, afterEach } from 'vitest';
import { gradeStep, overallGrade } from '@/lib/simulation/scoring';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MobileOverlayPanel, type MobileOverlay } from '@/components/simulator/MobileShell';
import { simulationStore } from '@/lib/simulation/simulationStore';
import { patients } from '@/lib/simulation/patients';

const ards = patients.find(p => p.id === 'ards')!;
const obese = patients.find(p => p.id === 'obese')!;
const healthy = patients.find(p => p.id === 'healthy')!;
const sepsis = patients.find(p => p.id === 'sepsis')!;

function props(overlay: MobileOverlay, patient = ards, allPatch: Record<string, unknown> = {}) {
  const c = simulationStore.getControlSnapshot();
  const v = simulationStore.getVitalsSnapshot();
  return {
    overlay, onClose: () => {}, bottomOffset: 44, maxHeight: '60vh',
    settings: { ...c.settings, ...allPatch } as typeof c.settings, allSettings: { ...c.allSettings, ...allPatch } as typeof c.allSettings, patient,
    vitals: v.vitals, measured: v.measured, prone: false,
    buffers: simulationStore.getWaveformSnapshot(),
  };
}

const tutorialRegion = () => screen.getByTestId('mobile-tutorial-panel');
const selectedTab = () => within(tutorialRegion()).getByRole('tab', { selected: true }).textContent;

describe('mobile tutorial overlay', () => {
  it('keeps APRV tab and step through ARDS → Tutorial → APRV → Settings → Tutorial', () => {
    const { rerender } = render(<MobileOverlayPanel {...props('tutorial')} />);
    fireEvent.click(screen.getByRole('tab', { name: 'APRV' }));
    fireEvent.click(screen.getByTitle('Step 2'));
    expect(screen.getByText(/Step 2 of/)).toBeInTheDocument();

    rerender(<MobileOverlayPanel {...props('controls')} />);
    // Parked tutorial is hidden from the accessibility tree; only settings are exposed.
    expect(tutorialRegion()).not.toBeVisible();
    expect(within(tutorialRegion()).queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tablist', { name: 'Choose tutorial' })).toBeNull();

    rerender(<MobileOverlayPanel {...props('tutorial')} />);
    expect(tutorialRegion()).toBeVisible();
    expect(selectedTab()).toBe('APRV');
    expect(screen.getByText(/Step 2 of/)).toBeInTheDocument();
    expect(screen.getAllByTestId('mobile-tutorial-panel')).toHaveLength(1);
  });

  it('still resets the tutorial when the patient changes', () => {
    const { rerender } = render(<MobileOverlayPanel {...props('tutorial')} />);
    fireEvent.click(screen.getByRole('tab', { name: 'APRV' }));
    fireEvent.click(screen.getByTitle('Step 2'));
    rerender(<MobileOverlayPanel {...props('patients', obese)} />);
    rerender(<MobileOverlayPanel {...props('tutorial', obese)} />);
    expect(screen.getByText(/Step 1 of/)).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'APRV' })).toBeNull();
  });

  afterEach(() => vi.useRealTimers());

  it('a new patient tutorial starts clean even after time and settings changes before first opening it', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
    const { rerender } = render(<MobileOverlayPanel {...props('tutorial', healthy)} />);
    rerender(<MobileOverlayPanel {...props('patients', sepsis)} />);
    expect(screen.queryByTestId('mobile-tutorial-panel')).toBeNull(); // unmounted until reopened
    rerender(<MobileOverlayPanel {...props('controls', sepsis)} />);
    vi.setSystemTime(new Date('2026-11-02T12:01:05Z')); // >60 s in Settings
    rerender(<MobileOverlayPanel {...props('controls', sepsis, { tidalVolume: 440 })} />);
    expect(screen.queryByTestId('mobile-tutorial-panel')).toBeNull();

    rerender(<MobileOverlayPanel {...props('tutorial', sepsis, { tidalVolume: 440 })} />);
    const expected = overallGrade([gradeStep(0, 0)]);
    const stale = overallGrade([gradeStep(65, 1)]);
    expect(expected.grade).not.toBe(stale.grade);
    expect(within(tutorialRegion()).getByText(`${expected.grade} (${expected.pct}%)`)).toBeInTheDocument();
  });

  it('switching patient while the tutorial is open resets it', () => {
    const { rerender } = render(<MobileOverlayPanel {...props('tutorial')} />);
    fireEvent.click(screen.getByRole('tab', { name: 'APRV' }));
    fireEvent.click(screen.getByTitle('Step 2'));
    rerender(<MobileOverlayPanel {...props('tutorial', obese)} />);
    expect(screen.getByText(/Step 1 of/)).toBeInTheDocument();
  });
});
