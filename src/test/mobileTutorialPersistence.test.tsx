import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MobileOverlayPanel, type MobileOverlay } from '@/components/simulator/MobileShell';
import { simulationStore } from '@/lib/simulation/simulationStore';
import { patients } from '@/lib/simulation/patients';

const ards = patients.find(p => p.id === 'ards')!;
const obese = patients.find(p => p.id === 'obese')!;

function props(overlay: MobileOverlay, patient = ards) {
  const c = simulationStore.getControlSnapshot();
  const v = simulationStore.getVitalsSnapshot();
  return {
    overlay, onClose: () => {}, bottomOffset: 44, maxHeight: '60vh',
    settings: c.settings, allSettings: c.allSettings, patient,
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
    expect(screen.queryByRole('tab', { name: 'APRV' })).toBeNull();

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
});
