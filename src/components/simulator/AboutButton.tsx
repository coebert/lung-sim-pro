import { useState } from 'react';
import { Info } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const AUTHOR = 'Dr Rob Coe BA MA (OXON) MBBS FRCA FFICM';

interface Props {
  compact?: boolean;
}

export function AboutButton({ compact }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="About this app"
        className={`p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${compact ? '' : ''}`}
        title="About"
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>About ICU Vent Sim</DialogTitle>
            <DialogDescription>
              A teaching simulator that models patient physiology and ventilator waveforms across six
              modes (VCV, PCV, PRVC, SIMV, PSV, APRV) with real-time alarms and scoring.
            </DialogDescription>
          </DialogHeader>
          <div className="text-xs text-muted-foreground space-y-2">
            <p><span className="text-foreground font-medium">Created by</span> {AUTHOR}.</p>
            <p>
              Intended for clinical education only — not for use in patient care or as a substitute for
              formal ventilator training.
            </p>
            <p className="pt-2 border-t border-border">
              Keyboard: <span className="font-mono">Space</span> freeze · <span className="font-mono">P</span> prone ·
              <span className="font-mono"> T</span> tutorial · <span className="font-mono">1–6</span> patient
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
