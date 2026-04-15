import { useMemo } from 'react';
import { PatientPhysiology, VentSettings, WaveformBuffers } from '@/lib/simulation/types';

interface LungAnimationProps {
  patient: PatientPhysiology;
  settings: VentSettings;
  buffers: WaveformBuffers;
}

export function LungAnimation({ patient, settings, buffers }: LungAnimationProps) {
  // Derive breath phase from recent volume buffer (0 = empty, 1 = peak inspiration)
  const recentVolume = buffers.volume;
  const currentVol = recentVolume[recentVolume.length - 1] || 0;
  const maxVol = Math.max(...recentVolume.slice(-250), 1);
  const breathPhase = Math.min(currentVol / maxVol, 1); // 0–1

  // Pathology-specific parameters
  const pathology = patient.id;

  // ARDS: atelectasis score (0 = fully atelectatic, 1 = fully recruited)
  // Open lung = high PEEP + appropriate FiO2
  const ardsRecruitment = useMemo(() => {
    if (pathology !== 'ards') return 1;
    const peepScore = Math.min(settings.peep / patient.optimalPEEP, 1.2);
    const fio2Score = Math.min(settings.fio2 / patient.optimalFiO2, 1);
    return Math.max(0.2, Math.min(1, peepScore * 0.7 + fio2Score * 0.3));
  }, [pathology, settings.peep, settings.fio2, patient.optimalPEEP, patient.optimalFiO2]);

  // Bronchospasm: hyperinflation score (1 = normal, >1 = hyperinflated)
  const hyperinflation = useMemo(() => {
    if (pathology !== 'bronchospasm') return 1;
    // High RR or high IE ratio causes air trapping
    const tau = patient.resistance * (patient.compliance / 1000);
    const cycleTime = 60 / settings.respiratoryRate;
    const iTime = settings.inspiratoryTime > 0 ? settings.inspiratoryTime : cycleTime / (1 + settings.ieRatio);
    const eTime = cycleTime - iTime;
    const retainedFraction = Math.exp(-eTime / tau);
    // Scale: 1.0 (normal) to 1.6 (severely hyperinflated)
    return 1 + retainedFraction * 1.5;
  }, [pathology, settings.respiratoryRate, settings.ieRatio, settings.inspiratoryTime, patient.resistance, patient.compliance]);

  // Lung expansion factor
  const baseExpansion = pathology === 'ards' ? 0.6 + ardsRecruitment * 0.4 : 1;
  const inflationBase = pathology === 'bronchospasm' ? hyperinflation : 1;
  const expansion = inflationBase * (baseExpansion * 0.7 + breathPhase * 0.3);

  // Colors
  const lungColor = getLungColor(pathology, ardsRecruitment, hyperinflation);
  const lungOpacity = pathology === 'ards' ? 0.5 + ardsRecruitment * 0.4 : 0.85;

  // Atelectasis patches for ARDS (dependent regions)
  const atelPatches = pathology === 'ards' ? getAtelPatches(ardsRecruitment) : [];

  // Bronchospasm: narrowed airways
  const airwayWidth = pathology === 'bronchospasm' ? 2.5 : 4;

  return (
    <svg
      viewBox="0 0 120 140"
      className="w-full h-full"
      style={{ filter: 'drop-shadow(0 0 4px rgba(0,200,255,0.15))' }}
    >
      {/* Trachea */}
      <rect
        x="55" y="4" width="10" height="30"
        rx="4"
        fill="hsl(200, 30%, 45%)"
        stroke="hsl(200, 40%, 55%)"
        strokeWidth="0.8"
      />
      {/* Tracheal rings */}
      {[8, 14, 20, 26].map(y => (
        <line key={y} x1="55" y1={y} x2="65" y2={y} stroke="hsl(200, 40%, 60%)" strokeWidth="0.6" />
      ))}

      {/* Carina */}
      <circle cx="60" cy="34" r="2" fill="hsl(200, 30%, 40%)" />

      {/* Left main bronchus */}
      <path
        d={`M60,34 Q48,42 ${42 - (expansion - 1) * 3},${50}`}
        fill="none"
        stroke="hsl(200, 30%, 45%)"
        strokeWidth={airwayWidth}
        strokeLinecap="round"
      />
      {/* Right main bronchus */}
      <path
        d={`M60,34 Q72,42 ${78 + (expansion - 1) * 3},${50}`}
        fill="none"
        stroke="hsl(200, 30%, 45%)"
        strokeWidth={airwayWidth}
        strokeLinecap="round"
      />

      {/* Sub-bronchi left */}
      <path d={`M${42 - (expansion - 1) * 3},50 Q35,58 30,65`} fill="none" stroke="hsl(200, 30%, 50%)" strokeWidth={airwayWidth * 0.6} strokeLinecap="round" />
      <path d={`M${42 - (expansion - 1) * 3},50 Q44,60 46,68`} fill="none" stroke="hsl(200, 30%, 50%)" strokeWidth={airwayWidth * 0.6} strokeLinecap="round" />

      {/* Sub-bronchi right */}
      <path d={`M${78 + (expansion - 1) * 3},50 Q85,58 90,65`} fill="none" stroke="hsl(200, 30%, 50%)" strokeWidth={airwayWidth * 0.6} strokeLinecap="round" />
      <path d={`M${78 + (expansion - 1) * 3},50 Q76,60 74,68`} fill="none" stroke="hsl(200, 30%, 50%)" strokeWidth={airwayWidth * 0.6} strokeLinecap="round" />

      {/* Left lung */}
      <path
        d={leftLungPath(expansion)}
        fill={lungColor}
        opacity={lungOpacity}
        stroke="hsl(200, 40%, 50%)"
        strokeWidth="1"
        style={{ transition: 'd 0.08s ease-out' }}
      />

      {/* Right lung */}
      <path
        d={rightLungPath(expansion)}
        fill={lungColor}
        opacity={lungOpacity}
        stroke="hsl(200, 40%, 50%)"
        strokeWidth="1"
        style={{ transition: 'd 0.08s ease-out' }}
      />

      {/* ARDS atelectasis patches */}
      {atelPatches.map((p, i) => (
        <ellipse
          key={i}
          cx={p.x}
          cy={p.y}
          rx={p.rx * expansion}
          ry={p.ry}
          fill="hsl(220, 20%, 30%)"
          opacity={p.opacity}
        />
      ))}

      {/* Bronchospasm: mucus/inflammation markers in airways */}
      {pathology === 'bronchospasm' && (
        <>
          <circle cx="38" cy="52" r="1.5" fill="hsl(40, 80%, 60%)" opacity="0.6" />
          <circle cx="82" cy="52" r="1.5" fill="hsl(40, 80%, 60%)" opacity="0.6" />
          <circle cx="32" cy="62" r="1" fill="hsl(40, 80%, 60%)" opacity="0.5" />
          <circle cx="88" cy="62" r="1" fill="hsl(40, 80%, 60%)" opacity="0.5" />
        </>
      )}

      {/* Hyperinflation indicator for bronchospasm */}
      {pathology === 'bronchospasm' && hyperinflation > 1.3 && (
        <text x="60" y="136" textAnchor="middle" fill="hsl(45, 100%, 70%)" fontSize="6" fontFamily="monospace">
          Air Trapping
        </text>
      )}

      {/* ARDS recruitment label */}
      {pathology === 'ards' && ardsRecruitment < 0.6 && (
        <text x="60" y="136" textAnchor="middle" fill="hsl(0, 80%, 60%)" fontSize="6" fontFamily="monospace">
          Atelectasis
        </text>
      )}
      {pathology === 'ards' && ardsRecruitment >= 0.6 && ardsRecruitment < 0.9 && (
        <text x="60" y="136" textAnchor="middle" fill="hsl(45, 100%, 70%)" fontSize="6" fontFamily="monospace">
          Partial Recruit
        </text>
      )}
    </svg>
  );
}

function leftLungPath(expansion: number): string {
  const w = 28 * expansion;
  const h = 60 * expansion;
  // Heart notch on medial side
  const cx = 38;
  const top = 46;
  return `M${cx},${top} 
    Q${cx - w * 0.3},${top + h * 0.15} ${cx - w * 0.8},${top + h * 0.35}
    Q${cx - w},${top + h * 0.6} ${cx - w * 0.7},${top + h * 0.85}
    Q${cx - w * 0.3},${top + h} ${cx + 2},${top + h * 0.95}
    Q${cx + 6},${top + h * 0.7} ${cx + 4},${top + h * 0.45}
    Q${cx + 3},${top + h * 0.2} ${cx},${top}`;
}

function rightLungPath(expansion: number): string {
  const w = 30 * expansion;
  const h = 64 * expansion;
  const cx = 82;
  const top = 44;
  return `M${cx},${top}
    Q${cx + w * 0.3},${top + h * 0.15} ${cx + w * 0.8},${top + h * 0.35}
    Q${cx + w},${top + h * 0.6} ${cx + w * 0.7},${top + h * 0.85}
    Q${cx + w * 0.3},${top + h} ${cx - 2},${top + h * 0.95}
    Q${cx - 4},${top + h * 0.5} ${cx - 2},${top + h * 0.2}
    Q${cx - 1},${top + h * 0.05} ${cx},${top}`;
}

function getLungColor(pathology: string, recruitment: number, hyperinflation: number): string {
  switch (pathology) {
    case 'ards':
      // Darker/more opaque when atelectatic, pinker when recruited
      const r = Math.round(80 + recruitment * 100);
      const g = Math.round(60 + recruitment * 80);
      const b = Math.round(100 + recruitment * 50);
      return `rgb(${r}, ${g}, ${b})`;
    case 'bronchospasm':
      // More reddish/distended when hyperinflated
      const redness = Math.min((hyperinflation - 1) * 300, 80);
      return `rgb(${120 + redness}, ${130 - redness * 0.5}, ${170 - redness})`;
    case 'obese':
      return 'hsl(200, 25%, 50%)';
    case 'restrictive':
      return 'hsl(210, 20%, 45%)';
    default:
      return 'hsl(200, 40%, 55%)';
  }
}

function getAtelPatches(recruitment: number): Array<{ x: number; y: number; rx: number; ry: number; opacity: number }> {
  // More patches when recruitment is low; patches are in dependent (lower) regions
  const severity = 1 - recruitment;
  if (severity < 0.1) return [];

  const patches = [
    // Lower left lung (most dependent)
    { x: 28, y: 105, rx: 10, ry: 6, opacity: severity * 0.8 },
    { x: 22, y: 95, rx: 8, ry: 5, opacity: severity * 0.6 },
    // Lower right lung
    { x: 92, y: 108, rx: 11, ry: 6, opacity: severity * 0.8 },
    { x: 96, y: 96, rx: 8, ry: 5, opacity: severity * 0.6 },
    // Mid zones (appear with worse atelectasis)
    { x: 30, y: 82, rx: 7, ry: 4, opacity: severity > 0.4 ? (severity - 0.4) * 1.2 : 0 },
    { x: 90, y: 80, rx: 7, ry: 4, opacity: severity > 0.4 ? (severity - 0.4) * 1.2 : 0 },
  ];

  return patches.filter(p => p.opacity > 0.05);
}
