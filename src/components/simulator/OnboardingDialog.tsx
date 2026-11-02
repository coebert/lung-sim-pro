import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Keyboard, Users, Sliders, GraduationCap } from 'lucide-react';
import { patients } from '@/lib/simulation/patients';

const STORAGE_KEY = 'lungsim.onboarded.v2';

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
          <DialogTitle>Welcome to Lung Sim Pro</DialogTitle>
          <DialogDescription>
            Interactive ventilator simulator with realistic waveforms, alarms and patient physiology.
          </DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col gap-3 py-2 text-sm">
          <Item icon={<Users className="w-4 h-4" />} title="Pick a patient scenario">
            {patients.length} patient profiles — healthy adults through ARDS, airway obstruction, sepsis and a child — each with its own compliance, resistance and gas-exchange defects.
          </Item>
          <Item icon={<Sliders className="w-4 h-4" />} title="Adjust ventilator settings">
            Tap ± to adjust, press and hold for fast changes. On a keyboard, arrows give fine control.
          </Item>
          <Item icon={<GraduationCap className="w-4 h-4" />} title="Open the tutorial">
            Guided teaching cases with targets to hit and instant feedback on your choices.
          </Item>
          <Item icon={<Keyboard className="w-4 h-4" />} title="Keyboard shortcuts">
            <span className="font-mono text-xs">Space</span> freeze · <span className="font-mono text-xs">P</span> prone ·{' '}
            <span className="font-mono text-xs">T</span> tutorial · <span className="font-mono text-xs">1–6</span> patient
          </Item>
        </ul>

        <p className="text-xs text-muted-foreground border-t border-border pt-3">
          For education only. This is a teaching model, not a medical device — never use it to guide
          real patient care.
        </p>

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
