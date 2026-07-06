import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Keyboard, Users, Sliders, GraduationCap } from 'lucide-react';

const STORAGE_KEY = 'lungsim.onboarded.v1';

/** First-visit onboarding sheet. Persists dismissal in localStorage. */
export function OnboardingDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setOpen(true);
    } catch { /* private mode — silently skip */ }
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dismiss(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Welcome to ICU Vent Sim</DialogTitle>
          <DialogDescription>
            Interactive ventilator simulator with realistic waveforms, alarms and patient physiology.
          </DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col gap-3 py-2 text-sm">
          <Item icon={<Users className="w-4 h-4" />} title="Pick a patient scenario">
            Six scenarios — healthy through ARDS — with distinct compliance, resistance and gas-exchange defects.
          </Item>
          <Item icon={<Sliders className="w-4 h-4" />} title="Adjust ventilator settings">
            Long-press ± for fast changes, use keyboard arrows for fine control, Page Up/Down for big jumps.
          </Item>
          <Item icon={<GraduationCap className="w-4 h-4" />} title="Open the tutorial">
            Guided teaching cases with targets to hit and instant feedback on your choices.
          </Item>
          <Item icon={<Keyboard className="w-4 h-4" />} title="Keyboard shortcuts">
            <span className="font-mono text-xs">Space</span> freeze · <span className="font-mono text-xs">P</span> prone ·{' '}
            <span className="font-mono text-xs">T</span> tutorial · <span className="font-mono text-xs">1–6</span> patient
          </Item>
        </ul>

        <DialogFooter>
          <button
            onClick={dismiss}
            className="px-4 py-2 rounded bg-primary text-primary-foreground font-medium hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Start simulating
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Item({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 items-start">
      <span className="mt-0.5 p-1.5 rounded bg-secondary text-primary shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="font-semibold text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground leading-snug">{children}</div>
      </div>
    </li>
  );
}
