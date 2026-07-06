import { ChevronDown, User } from 'lucide-react';
import { PatientPhysiology } from '@/lib/simulation/types';
import { patients } from '@/lib/simulation/patients';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Props {
  selectedPatient: PatientPhysiology;
  onSelectPatient: (patient: PatientPhysiology) => void;
  compact?: boolean;
}

export function PatientDropdown({ selectedPatient, onSelectPatient, compact }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Select patient"
        className="flex items-center gap-1.5 px-2 py-1 rounded bg-secondary hover:bg-muted text-[10px] font-medium text-foreground border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors max-w-[260px]"
      >
        <User className="w-3 h-3 text-muted-foreground shrink-0" />
        <span className="truncate">{selectedPatient.name}</span>
        {!compact && (
          <span className="hidden md:inline text-muted-foreground monitor-text shrink-0">
            · C{selectedPatient.compliance} · R{selectedPatient.resistance}
          </span>
        )}
        <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Patient scenario — press 1–6
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {patients.map((p, idx) => (
          <DropdownMenuItem
            key={p.id}
            onSelect={() => onSelectPatient(p)}
            className={selectedPatient.id === p.id ? 'bg-accent/50' : ''}
          >
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold truncate">{p.name}</span>
                <kbd className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{idx + 1}</kbd>
              </div>
              <span className="text-[10px] text-muted-foreground leading-tight">{p.description}</span>
              <span className="text-[9px] text-muted-foreground monitor-text mt-0.5">
                C {p.compliance} · R {p.resistance} · SpO₂ {p.baseSpO2}%
              </span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
