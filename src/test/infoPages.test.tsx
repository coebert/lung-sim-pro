import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Support from '@/pages/Support';
import Privacy from '@/pages/Privacy';

const at = (el: JSX.Element) => render(<MemoryRouter>{el}</MemoryRouter>);

describe('support and privacy pages', () => {
  it('support page links to the owner-supplied email and back to the simulator', () => {
    at(<Support />);
    expect(screen.getByRole('link', { name: 'support@anaesthesiacore.app' })).toHaveAttribute('href', 'mailto:support@anaesthesiacore.app');
    expect(screen.getByRole('link', { name: /back to simulator/i })).toHaveAttribute('href', '/');
    expect(screen.getByText(/never send real patient information/i)).toBeInTheDocument();
  });

  it('privacy page is dated 2 November 2026 and gives the support contact', () => {
    at(<Privacy />);
    expect(screen.getByText('Last updated: 2 November 2026')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'support@anaesthesiacore.app' })).toHaveAttribute('href', 'mailto:support@anaesthesiacore.app');
  });
});
