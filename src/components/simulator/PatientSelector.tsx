import { PatientPhysiology } from '@/lib/simulation/types';
import { patients } from '@/lib/simulation/patients';

interface PatientSelectorProps {
  selectedPatient: PatientPhysiology;
  onSelectPatient: (patient: PatientPhysiology) => void;
}

export function PatientSelector({ selectedPatient, onSelectPatient }: PatientSelectorProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold px-1">
        Patient
      </span>
      <div className="grid grid-cols-3 gap-1">
        {patients.map((patient) => (
          <button
            key={patient.id}
            onClick={() => onSelectPatient(patient)}
            className={`px-2 py-1.5 text-[11px] rounded transition-colors text-left leading-tight
              ${selectedPatient.id === patient.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
          >
            <div className="font-bold">{patient.name}</div>
            <div className="opacity-70 text-[9px] mt-0.5">{patient.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
