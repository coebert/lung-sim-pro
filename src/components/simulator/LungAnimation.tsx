import { useMemo } from 'react';
import { PatientPhysiology, VentSettings, WaveformBuffers } from '@/lib/simulation/types';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

interface LungAnimationProps {
  patient: PatientPhysiology;
  settings: VentSettings;
  buffers: WaveformBuffers;
  compact?: boolean;
}

export function LungAnimation({ patient, settings, buffers, compact = false }: LungAnimationProps) {
  const [collapsed, setCollapsed] = useState(false);

  const recentVolume = buffers.volume;
  const currentVol = recentVolume[recentVolume.length - 1] || 0;
  const maxVol = Math.max(...recentVolume.slice(-250), 1);
  const breathPhase = Math.min(currentVol / maxVol, 1);

  const pathology = patient.id;

  const ardsRecruitment = useMemo(() => {
    if (pathology !== 'ards') return 1;
    const peepScore = Math.min(settings.peep / patient.optimalPEEP, 1.2);
    const fio2Score = Math.min(settings.fio2 / patient.optimalFiO2, 1);
    return Math.max(0.2, Math.min(1, peepScore * 0.7 + fio2Score * 0.3));
  }, [pathology, settings.peep, settings.fio2, patient.optimalPEEP, patient.optimalFiO2]);

  const hyperinflation = useMemo(() => {
    if (pathology !== 'bronchospasm') return 1;
    const tau = patient.resistance * (patient.compliance / 1000);
    const cycleTime = 60 / settings.respiratoryRate;
    const iTime = settings.inspiratoryTime > 0 ? settings.inspiratoryTime : cycleTime / (1 + settings.ieRatio);
    const eTime = cycleTime - iTime;
    const retainedFraction = Math.exp(-eTime / tau);
    return 1 + retainedFraction * 1.5;
  }, [pathology, settings.respiratoryRate, settings.ieRatio, settings.inspiratoryTime, patient.resistance, patient.compliance]);

  const baseExpansion = pathology === 'ards' ? 0.6 + ardsRecruitment * 0.4 : 1;
  const inflationBase = pathology === 'bronchospasm' ? hyperinflation : 1;
  const expansion = inflationBase * (baseExpansion * 0.75 + breathPhase * 0.25);

  const lungFill = getLungGradientId(pathology);
  const lungOpacity = pathology === 'ards' ? 0.55 + ardsRecruitment * 0.4 : 0.92;
  const atelPatches = pathology === 'ards' ? getAtelPatches(ardsRecruitment) : [];
  const airwayWidth = pathology === 'bronchospasm' ? 2.2 : 3.5;
  const subAirwayWidth = airwayWidth * 0.55;
  const tertiaryWidth = airwayWidth * 0.3;

  // Status text
  let statusText = '';
  let statusColor = '';
  if (pathology === 'bronchospasm' && hyperinflation > 1.3) {
    statusText = '⚠ Air Trapping';
    statusColor = 'hsl(45, 100%, 70%)';
  } else if (pathology === 'ards' && ardsRecruitment < 0.6) {
    statusText = '⚠ Atelectasis';
    statusColor = 'hsl(0, 80%, 65%)';
  } else if (pathology === 'ards' && ardsRecruitment < 0.9) {
    statusText = 'Partial Recruitment';
    statusColor = 'hsl(45, 90%, 65%)';
  }

  return (
    <div className="flex flex-col h-full bg-secondary rounded border border-border overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="flex items-center justify-between px-2 py-1 bg-secondary hover:bg-muted transition-colors shrink-0"
      >
        <span className="text-[10px] text-muted-foreground font-bold tracking-wider uppercase">
          Lung View
        </span>
        {collapsed ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronUp className="w-3 h-3 text-muted-foreground" />}
      </button>

      {!collapsed && (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center bg-[#1a1a2e] p-1">
          <svg
            viewBox="0 0 200 220"
            className="w-full h-full max-h-full"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              {/* Healthy lung gradient — realistic pink/salmon */}
              <radialGradient id="lung-healthy" cx="50%" cy="40%" r="60%">
                <stop offset="0%" stopColor="#e8a0a0" />
                <stop offset="40%" stopColor="#d4787e" />
                <stop offset="80%" stopColor="#b85a62" />
                <stop offset="100%" stopColor="#944a52" />
              </radialGradient>
              {/* ARDS lung — grey/hepatised depending on recruitment */}
              <radialGradient id="lung-ards" cx="50%" cy="40%" r="60%">
                <stop offset="0%" stopColor={`rgb(${120 + ardsRecruitment * 80}, ${90 + ardsRecruitment * 60}, ${100 + ardsRecruitment * 30})`} />
                <stop offset="60%" stopColor={`rgb(${80 + ardsRecruitment * 70}, ${60 + ardsRecruitment * 50}, ${80 + ardsRecruitment * 20})`} />
                <stop offset="100%" stopColor={`rgb(${60 + ardsRecruitment * 50}, ${45 + ardsRecruitment * 35}, ${65 + ardsRecruitment * 15})`} />
              </radialGradient>
              {/* Bronchospasm — pinkish but gets redder with hyperinflation */}
              <radialGradient id="lung-broncho" cx="50%" cy="40%" r="60%">
                {(() => {
                  const r = Math.min((hyperinflation - 1) * 200, 60);
                  return (
                    <>
                      <stop offset="0%" stopColor={`rgb(${200 + r * 0.3}, ${160 - r}, ${150 - r})`} />
                      <stop offset="50%" stopColor={`rgb(${180 + r * 0.5}, ${120 - r * 0.8}, ${115 - r * 0.8})`} />
                      <stop offset="100%" stopColor={`rgb(${140 + r * 0.5}, ${90 - r * 0.5}, ${85 - r * 0.5})`} />
                    </>
                  );
                })()}
              </radialGradient>
              {/* Obese */}
              <radialGradient id="lung-obese" cx="50%" cy="40%" r="60%">
                <stop offset="0%" stopColor="#c89898" />
                <stop offset="60%" stopColor="#a87878" />
                <stop offset="100%" stopColor="#886060" />
              </radialGradient>
              {/* Restrictive — slightly fibrotic, paler */}
              <radialGradient id="lung-restrictive" cx="50%" cy="40%" r="60%">
                <stop offset="0%" stopColor="#c8a8a8" />
                <stop offset="60%" stopColor="#a88888" />
                <stop offset="100%" stopColor="#887070" />
              </radialGradient>
              {/* Airway tissue gradient */}
              <linearGradient id="airway-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#d4a0a0" />
                <stop offset="100%" stopColor="#b08080" />
              </linearGradient>
              {/* Pleural highlight */}
              <radialGradient id="pleural-sheen-l" cx="30%" cy="30%" r="70%">
                <stop offset="0%" stopColor="rgba(255,255,255,0.12)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0)" />
              </radialGradient>
              <radialGradient id="pleural-sheen-r" cx="70%" cy="30%" r="70%">
                <stop offset="0%" stopColor="rgba(255,255,255,0.12)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0)" />
              </radialGradient>
            </defs>

            {/* === TRACHEA === */}
            <rect x="93" y="8" width="14" height="42" rx="6" fill="url(#airway-grad)" stroke="#a07070" strokeWidth="0.8" />
            {/* Tracheal cartilage rings */}
            {[14, 20, 26, 32, 38, 44].map(y => (
              <path key={y} d={`M93,${y} Q100,${y - 1.5} 107,${y}`} fill="none" stroke="#c09090" strokeWidth="1" opacity="0.6" />
            ))}
            {/* Tracheal lumen */}
            <rect x="96" y="10" width="8" height="38" rx="3" fill="#2a1520" opacity="0.4" />

            {/* === CARINA === */}
            <ellipse cx="100" cy="50" rx="5" ry="3" fill="#b08080" />

            {/* === LEFT MAIN BRONCHUS === */}
            <path
              d={`M100,50 C88,56 ${72 - (expansion - 1) * 4},60 ${62 - (expansion - 1) * 5},68`}
              fill="none" stroke="url(#airway-grad)" strokeWidth={airwayWidth} strokeLinecap="round"
            />
            {/* === RIGHT MAIN BRONCHUS === */}
            <path
              d={`M100,50 C112,55 ${128 + (expansion - 1) * 4},58 ${138 + (expansion - 1) * 5},65`}
              fill="none" stroke="url(#airway-grad)" strokeWidth={airwayWidth} strokeLinecap="round"
            />

            {/* Left lobar bronchi */}
            <path d={`M${62 - (expansion - 1) * 5},68 C55,76 42,80 ${36 - expansion * 2},90`} fill="none" stroke="#c09090" strokeWidth={subAirwayWidth} strokeLinecap="round" />
            <path d={`M${62 - (expansion - 1) * 5},68 C58,78 55,85 ${52 - expansion},95`} fill="none" stroke="#c09090" strokeWidth={subAirwayWidth} strokeLinecap="round" />
            <path d={`M${62 - (expansion - 1) * 5},68 C65,78 68,88 ${65},98`} fill="none" stroke="#c09090" strokeWidth={subAirwayWidth} strokeLinecap="round" />

            {/* Right lobar bronchi */}
            <path d={`M${138 + (expansion - 1) * 5},65 C145,72 155,76 ${162 + expansion * 2},85`} fill="none" stroke="#c09090" strokeWidth={subAirwayWidth} strokeLinecap="round" />
            <path d={`M${138 + (expansion - 1) * 5},65 C140,75 142,83 ${145 + expansion},92`} fill="none" stroke="#c09090" strokeWidth={subAirwayWidth} strokeLinecap="round" />
            <path d={`M${138 + (expansion - 1) * 5},65 C132,74 128,82 ${130},92`} fill="none" stroke="#c09090" strokeWidth={subAirwayWidth} strokeLinecap="round" />

            {/* Tertiary airways - left */}
            <path d={`M${36 - expansion * 2},90 C30,98 25,105 ${22},112`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.6" />
            <path d={`M${52 - expansion},95 C48,105 44,112 ${42},120`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.6" />

            {/* Tertiary airways - right */}
            <path d={`M${162 + expansion * 2},85 C168,93 172,100 ${175},108`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.6" />
            <path d={`M${145 + expansion},92 C150,100 153,108 ${155},116`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.6" />

            {/* === LEFT LUNG === */}
            <path
              d={leftLungPath(expansion)}
              fill={`url(#${lungFill})`}
              opacity={lungOpacity}
              stroke="#8a5a5a"
              strokeWidth="1.2"
            />
            {/* Pleural sheen */}
            <path d={leftLungPath(expansion)} fill="url(#pleural-sheen-l)" opacity="0.5" />
            {/* Left fissure — oblique */}
            <path
              d={leftFissure(expansion)}
              fill="none" stroke="#7a4a50" strokeWidth="0.6" strokeDasharray="3,2" opacity="0.5"
            />

            {/* === RIGHT LUNG === */}
            <path
              d={rightLungPath(expansion)}
              fill={`url(#${lungFill})`}
              opacity={lungOpacity}
              stroke="#8a5a5a"
              strokeWidth="1.2"
            />
            {/* Pleural sheen */}
            <path d={rightLungPath(expansion)} fill="url(#pleural-sheen-r)" opacity="0.5" />
            {/* Right fissures — oblique + horizontal */}
            <path
              d={rightObliqueFissure(expansion)}
              fill="none" stroke="#7a4a50" strokeWidth="0.6" strokeDasharray="3,2" opacity="0.5"
            />
            <path
              d={rightHorizontalFissure(expansion)}
              fill="none" stroke="#7a4a50" strokeWidth="0.6" strokeDasharray="3,2" opacity="0.5"
            />

            {/* === ARDS: Atelectasis patches (dependent consolidation) === */}
            {atelPatches.map((p, i) => (
              <ellipse
                key={i} cx={p.x} cy={p.y}
                rx={p.rx * expansion} ry={p.ry}
                fill="#3a2a3a" opacity={p.opacity}
              />
            ))}

            {/* === Bronchospasm: inflammation/mucus markers === */}
            {pathology === 'bronchospasm' && (
              <>
                {/* Thickened airway walls shown as parallel lines */}
                <circle cx="55" cy="72" r="2" fill="#e8c040" opacity="0.5" />
                <circle cx="145" cy="69" r="2" fill="#e8c040" opacity="0.5" />
                <circle cx="40" cy="88" r="1.5" fill="#e8c040" opacity="0.4" />
                <circle cx="158" cy="84" r="1.5" fill="#e8c040" opacity="0.4" />
                {/* Mucus plugs */}
                <ellipse cx="48" cy="80" rx="2" ry="1" fill="#c8a830" opacity="0.4" />
                <ellipse cx="152" cy="77" rx="2" ry="1" fill="#c8a830" opacity="0.4" />
              </>
            )}

            {/* === STATUS TEXT === */}
            {statusText && (
              <text x="100" y="210" textAnchor="middle" fill={statusColor} fontSize="9" fontFamily="monospace" fontWeight="bold">
                {statusText}
              </text>
            )}
          </svg>
        </div>
      )}
    </div>
  );
}

/* ── Lung outline paths ── */

function leftLungPath(exp: number): string {
  const w = 42 * exp;
  const h = 95 * exp;
  const cx = 58;
  const top = 60;
  // Anatomical: apex narrow, lateral curve, base flat, medial with cardiac notch
  return `M${cx},${top}
    C${cx - w * 0.15},${top + h * 0.08} ${cx - w * 0.5},${top + h * 0.15} ${cx - w * 0.75},${top + h * 0.3}
    C${cx - w * 0.95},${top + h * 0.5} ${cx - w},${top + h * 0.7} ${cx - w * 0.85},${top + h * 0.88}
    C${cx - w * 0.6},${top + h * 0.98} ${cx - w * 0.2},${top + h} ${cx + 4},${top + h * 0.95}
    C${cx + 8},${top + h * 0.78} ${cx + 10},${top + h * 0.65} ${cx + 8},${top + h * 0.52}
    C${cx + 5},${top + h * 0.4} ${cx + 4},${top + h * 0.25} ${cx + 2},${top + h * 0.12}
    C${cx + 1},${top + h * 0.04} ${cx},${top} ${cx},${top}Z`;
}

function rightLungPath(exp: number): string {
  const w = 45 * exp;
  const h = 100 * exp;
  const cx = 142;
  const top = 56;
  return `M${cx},${top}
    C${cx + w * 0.15},${top + h * 0.08} ${cx + w * 0.5},${top + h * 0.15} ${cx + w * 0.75},${top + h * 0.3}
    C${cx + w * 0.95},${top + h * 0.5} ${cx + w},${top + h * 0.7} ${cx + w * 0.85},${top + h * 0.88}
    C${cx + w * 0.6},${top + h * 0.98} ${cx + w * 0.2},${top + h} ${cx - 4},${top + h * 0.96}
    C${cx - 6},${top + h * 0.65} ${cx - 5},${top + h * 0.35} ${cx - 3},${top + h * 0.15}
    C${cx - 1},${top + h * 0.04} ${cx},${top} ${cx},${top}Z`;
}

function leftFissure(exp: number): string {
  const cx = 58;
  const w = 42 * exp;
  const h = 95 * exp;
  const top = 60;
  return `M${cx - w * 0.1},${top + h * 0.25} C${cx - w * 0.4},${top + h * 0.55} ${cx - w * 0.65},${top + h * 0.75} ${cx - w * 0.8},${top + h * 0.88}`;
}

function rightObliqueFissure(exp: number): string {
  const cx = 142;
  const w = 45 * exp;
  const h = 100 * exp;
  const top = 56;
  return `M${cx + w * 0.1},${top + h * 0.2} C${cx + w * 0.4},${top + h * 0.5} ${cx + w * 0.6},${top + h * 0.7} ${cx + w * 0.8},${top + h * 0.88}`;
}

function rightHorizontalFissure(exp: number): string {
  const cx = 142;
  const w = 45 * exp;
  const h = 100 * exp;
  const top = 56;
  const y = top + h * 0.38;
  return `M${cx + w * 0.1},${y} C${cx + w * 0.3},${y - 2} ${cx + w * 0.55},${y + 1} ${cx + w * 0.75},${y}`;
}

function getLungGradientId(pathology: string): string {
  switch (pathology) {
    case 'ards': return 'lung-ards';
    case 'bronchospasm': return 'lung-broncho';
    case 'obese': return 'lung-obese';
    case 'restrictive': return 'lung-restrictive';
    default: return 'lung-healthy';
  }
}

function getAtelPatches(recruitment: number): Array<{ x: number; y: number; rx: number; ry: number; opacity: number }> {
  const severity = 1 - recruitment;
  if (severity < 0.1) return [];
  return [
    { x: 38, y: 148, rx: 14, ry: 8, opacity: severity * 0.7 },
    { x: 28, y: 135, rx: 10, ry: 6, opacity: severity * 0.5 },
    { x: 160, y: 150, rx: 16, ry: 9, opacity: severity * 0.7 },
    { x: 170, y: 135, rx: 10, ry: 6, opacity: severity * 0.5 },
    { x: 32, y: 118, rx: 8, ry: 5, opacity: severity > 0.4 ? (severity - 0.4) * 1.0 : 0 },
    { x: 165, y: 115, rx: 9, ry: 5, opacity: severity > 0.4 ? (severity - 0.4) * 1.0 : 0 },
    { x: 45, y: 105, rx: 6, ry: 4, opacity: severity > 0.6 ? (severity - 0.6) * 1.2 : 0 },
    { x: 155, y: 102, rx: 7, ry: 4, opacity: severity > 0.6 ? (severity - 0.6) * 1.2 : 0 },
  ].filter(p => p.opacity > 0.05);
}
