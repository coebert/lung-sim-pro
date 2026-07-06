import { ChevronDown, User } from 'lucide-react';
import { PatientPhysiology } from '@/lib/simulation/types';
import { patients } from '@/lib/simulation/patients';
import { classifyPatient, SEVERITY_META } from '@/lib/simulation/severity';
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
  const currentSev = classifyPatient(selectedPatient);
  const currentMeta = SEVERITY_META[currentSev];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Select patient"
        className="flex items-center gap-1.5 px-2 py-1 rounded bg-secondary hover:bg-muted text-[10px] font-medium text-foreground border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors max-w-[280px]"
      >
        <User className="w-3 h-3 text-muted-foreground shrink-0" />
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${currentMeta.dot}`} aria-hidden />
        <span className="truncate">{selectedPatient.name}</span>
        {!compact && (
          <span className={`hidden md:inline text-[9px] uppercase tracking-wider shrink-0 ${currentMeta.token}`}>
            {currentMeta.label}
          </span>
        )}
        <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Patient scenario — press 1–6
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {patients.map((p, idx) => {
          const sev = classifyPatient(p);
          const meta = SEVERITY_META[sev];
          return (
            <DropdownMenuItem
              key={p.id}
              onSelect={() => onSelectPatient(p)}
              className={selectedPatient.id === p.id ? 'bg-accent/50' : ''}
            >
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dot}`} aria-hidden />
                    <span className="text-xs font-bold truncate">{p.name}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className={`text-[9px] uppercase tracking-wider ${meta.token}`}>{meta.label}</span>
                    <kbd className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground">{idx + 1}</kbd>
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground leading-tight">{p.description}</span>
                <span className="text-[9px] text-muted-foreground monitor-text mt-0.5">
                  C {p.compliance} · R {p.resistance} · SpO₂ {p.baseSpO2}%
                </span>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

