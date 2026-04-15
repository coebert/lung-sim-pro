import { useMemo } from 'react';
import { PatientPhysiology, VentSettings, Vitals, WaveformBuffers } from '@/lib/simulation/types';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

interface LungAnimationProps {
  patient: PatientPhysiology;
  settings: VentSettings;
  buffers: WaveformBuffers;
  vitals: Vitals;
  compact?: boolean;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function LungAnimation({ patient, settings, buffers, vitals, compact = false, collapsed: controlledCollapsed, onCollapsedChange }: LungAnimationProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const collapsed = controlledCollapsed !== undefined ? controlledCollapsed : internalCollapsed;
  const toggleCollapsed = () => {
    const next = !collapsed;
    if (onCollapsedChange) onCollapsedChange(next);
    else setInternalCollapsed(next);
  };

  const recentVolume = buffers.volume;
  const currentVol = recentVolume[recentVolume.length - 1] || 0;
  const maxVol = Math.max(...recentVolume.slice(-250), 1);
  const breathPhase = Math.min(currentVol / maxVol, 1);

  const pathology = patient.id;

  // APRV recruitment score (mirrors engine logic)
  const aprvRecruitment = useMemo(() => {
    if (settings.mode !== 'APRV') return null;
    const { pHigh, pLow, tHigh, tLow } = settings;
    const openingPressure = patient.optimalPEEP * 1.5;
    const drivingPressure = pHigh - pLow;
    const pHighScore = Math.max(0, Math.min(1, (drivingPressure - openingPressure * 0.5) / (openingPressure * 1.0)));
    const tHighScore = Math.max(0, Math.min(1, (tHigh - 1.5) / 3.0));
    let tLowScore: number;
    if (tLow < 0.1) tLowScore = 0.1;
    else if (tLow <= 0.8) tLowScore = Math.max(0, Math.min(1, tLow / 0.3));
    else tLowScore = Math.max(0, Math.min(1, 1.0 - (tLow - 0.8) / 0.7));
    const pLowPenalty = Math.max(0, Math.min(0.5, pLow / 10));
    return Math.max(0, Math.min(1, pHighScore * tHighScore * tLowScore * (1 - pLowPenalty)));
  }, [settings, patient.optimalPEEP]);

  // ARDS recruitment score — uses APRV recruitment when in APRV mode
  const ardsRecruitment = useMemo(() => {
    if (pathology !== 'ards') return 1;
    if (aprvRecruitment !== null) {
      // In APRV mode, recruitment is driven by APRV-specific parameters
      return Math.max(0.15, Math.min(1, aprvRecruitment));
    }
    const peepScore = Math.min(settings.peep / patient.optimalPEEP, 1.2);
    const fio2Score = Math.min(settings.fio2 / patient.optimalFiO2, 1);
    return Math.max(0.15, Math.min(1, peepScore * 0.7 + fio2Score * 0.3));
  }, [pathology, settings.peep, settings.fio2, patient.optimalPEEP, patient.optimalFiO2, aprvRecruitment]);

  // Obesity: basal atelectasis severity — improves with adequate PEEP
  const obeseAtelScore = useMemo(() => {
    if (pathology !== 'obese') return 0;
    const peepBenefit = Math.min(settings.peep / patient.optimalPEEP, 1.2);
    return Math.max(0, 1 - peepBenefit) * 0.9;
  }, [pathology, settings.peep, patient.optimalPEEP]);

  // Bronchospasm hyperinflation
  const hyperinflation = useMemo(() => {
    if (pathology !== 'bronchospasm') return 1;
    const tau = patient.resistance * (patient.compliance / 1000);
    const cycleTime = 60 / settings.respiratoryRate;
    const iTime = settings.inspiratoryTime > 0 ? settings.inspiratoryTime : cycleTime / (1 + settings.ieRatio);
    const eTime = cycleTime - iTime;
    const retainedFraction = Math.exp(-eTime / tau);
    return 1 + retainedFraction * 1.5;
  }, [pathology, settings.respiratoryRate, settings.ieRatio, settings.inspiratoryTime, patient.resistance, patient.compliance]);

  const baseExpansion = pathology === 'ards' ? 0.6 + ardsRecruitment * 0.4
    : pathology === 'obese' ? 0.85 - obeseAtelScore * 0.15
    : 1;
  const inflationBase = pathology === 'bronchospasm' ? hyperinflation : 1;
  const expansion = inflationBase * (baseExpansion * 0.75 + breathPhase * 0.25);

  // Scaling helpers: transform coordinates relative to each lung's hilum
  const e = expansion;
  // Left lung hilum at (75, 68)
  const lx = (x: number) => 75 + (x - 75) * e;
  const ly = (y: number) => 68 + (y - 68) * e;
  // Right lung hilum at (125, 62)
  const rx = (x: number) => 125 + (x - 125) * e;
  const ry = (y: number) => 62 + (y - 62) * e;
  // General mediastinal scaling from trachea base (100, 50)
  const mx = (x: number) => 100 + (x - 100) * e;
  const my = (y: number) => 50 + (y - 50) * e;

  // Heart compression from hyperinflation
  const heartCompression = pathology === 'bronchospasm'
    ? Math.max(0.55, 1 - (hyperinflation - 1) * 0.6)
    : 1;

  // Cardiac cycle phases from ECG buffer
  const cardiacPhase = useMemo(() => {
    const ecg = buffers.ecg;
    if (!ecg || ecg.length < 30) return { atrial: 0, ventricular: 0 };
    const window = ecg.slice(-30);
    const max = Math.max(...window);
    const min = Math.min(...window);
    const range = max - min || 1;
    const norm = window.map(v => (v - min) / range);
    let rPeakIdx = 0;
    let rPeakVal = 0;
    for (let i = 0; i < norm.length; i++) {
      if (norm[i] > rPeakVal) { rPeakVal = norm[i]; rPeakIdx = i; }
    }
    const distFromPeak = norm.length - 1 - rPeakIdx;
    const atrialDist = Math.abs(distFromPeak - 0) < 3 ? 0 :
      distFromPeak >= 5 && distFromPeak <= 12 ?
        Math.exp(-Math.pow((distFromPeak - 8) / 2.5, 2)) : 0;
    const ventricularPhase = distFromPeak <= 6 ?
      Math.exp(-Math.pow(distFromPeak / 3, 2)) : 0;
    const bradyScale = vitals.hr < 50 ? Math.max(0.4, vitals.hr / 50) : 1;
    const tachyScale = vitals.hr > 100 ? 1 + (Math.min(vitals.hr, 180) - 100) / 200 : 1;
    const hrScale = bradyScale * tachyScale;
    return {
      atrial: atrialDist * hrScale,
      ventricular: ventricularPhase * hrScale,
    };
  }, [buffers.ecg, vitals.hr]);

  const heartBeat = 1 + cardiacPhase.ventricular * 0.10;
  const tachyIntensity = Math.max(0, Math.min(1, (vitals.hr - 100) / 60));
  const bradyIntensity = Math.max(0, Math.min(1, (50 - vitals.hr) / 20));
  const heartTransition = bradyIntensity > 0 ? `transform ${0.08 + bradyIntensity * 0.3}s ease-out` : 'transform 0.08s ease-out';
  const chamberTransitionSlow = bradyIntensity > 0 ? `transform ${0.06 + bradyIntensity * 0.2}s ease-out` : undefined;

  const lungFill = getLungGradientId(pathology);
  const lungOpacity = pathology === 'ards' ? 0.5 + ardsRecruitment * 0.45 : 0.92;
  const airwayWidth = pathology === 'bronchospasm' ? 2.2 : 3.5;
  const subAirwayWidth = airwayWidth * 0.55;
  const tertiaryWidth = airwayWidth * 0.3;
  const quaternaryWidth = airwayWidth * 0.18;

  const atelPatches = pathology === 'ards'
    ? getArdsPatches(ardsRecruitment, expansion)
    : pathology === 'obese'
    ? getObeseBasalPatches(obeseAtelScore, expansion)
    : [];

  // Diaphragm position — varies by pathology
  const diaphragmY = pathology === 'obese'
    ? 158 - obeseAtelScore * 12
    : pathology === 'bronchospasm'
    ? 162 + (hyperinflation - 1) * 8 // flattened by hyperinflation
    : 160;

  let statusText = '';
  let statusColor = '';
  if (pathology === 'bronchospasm' && hyperinflation > 1.3) {
    statusText = '⚠ Air Trapping';
    statusColor = '#e8c840';
  } else if (pathology === 'ards' && ardsRecruitment < 0.5) {
    statusText = '⚠ Diffuse Atelectasis';
    statusColor = '#e06060';
  } else if (pathology === 'ards' && ardsRecruitment < 0.8) {
    statusText = 'Patchy Atelectasis';
    statusColor = '#d0a040';
  } else if (pathology === 'ards' && ardsRecruitment < 0.95) {
    statusText = 'Partial Recruitment';
    statusColor = '#90c070';
  } else if (pathology === 'obese' && obeseAtelScore > 0.3) {
    statusText = '⚠ Basal Atelectasis';
    statusColor = '#d0a040';
  }

  return (
    <div className="flex flex-col h-full bg-secondary rounded border border-border overflow-hidden">
      <button
        onClick={toggleCollapsed}
        className="flex items-center justify-between px-2 py-1 bg-secondary hover:bg-muted transition-colors shrink-0"
      >
        <span className="text-[10px] text-muted-foreground font-bold tracking-wider uppercase">
          Lung View
        </span>
        {collapsed ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronUp className="w-3 h-3 text-muted-foreground" />}
      </button>

      {!collapsed && (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center bg-[#0e1225] p-1">
          <svg
            viewBox="0 0 200 220"
            className="w-full h-full max-h-full"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              {/* ── Lung tissue gradients ── */}
              <radialGradient id="lg-healthy" cx="50%" cy="35%" r="65%">
                <stop offset="0%" stopColor="#e8a8a8" />
                <stop offset="30%" stopColor="#d48088" />
                <stop offset="65%" stopColor="#c06068" />
                <stop offset="100%" stopColor="#984858" />
              </radialGradient>
              <radialGradient id="lg-ards" cx="50%" cy="35%" r="65%">
                <stop offset="0%" stopColor={ardsColor(ardsRecruitment, 0)} />
                <stop offset="40%" stopColor={ardsColor(ardsRecruitment, 1)} />
                <stop offset="80%" stopColor={ardsColor(ardsRecruitment, 2)} />
                <stop offset="100%" stopColor={ardsColor(ardsRecruitment, 3)} />
              </radialGradient>
              <radialGradient id="lg-broncho" cx="50%" cy="35%" r="65%">
                {(() => {
                  const h = Math.min((hyperinflation - 1) * 180, 55);
                  return (<>
                    <stop offset="0%" stopColor={`rgb(${205 + h * 0.4},${165 - h},${155 - h})`} />
                    <stop offset="50%" stopColor={`rgb(${185 + h * 0.5},${125 - h * 0.8},${118 - h * 0.8})`} />
                    <stop offset="100%" stopColor={`rgb(${145 + h * 0.5},${92 - h * 0.5},${88 - h * 0.5})`} />
                  </>);
                })()}
              </radialGradient>
              <radialGradient id="lg-obese" cx="50%" cy="30%" r="65%">
                <stop offset="0%" stopColor="#d49898" />
                <stop offset="40%" stopColor="#b87878" />
                <stop offset="80%" stopColor="#a06565" />
                <stop offset="100%" stopColor="#885555" />
              </radialGradient>
              <radialGradient id="lg-restrictive" cx="50%" cy="35%" r="65%">
                <stop offset="0%" stopColor="#ccb0b0" />
                <stop offset="50%" stopColor="#b09090" />
                <stop offset="100%" stopColor="#907575" />
              </radialGradient>

              {/* Airway tissue */}
              <linearGradient id="aw-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#d4a0a0" />
                <stop offset="100%" stopColor="#b08080" />
              </linearGradient>

              {/* Pleural surface highlights */}
              <radialGradient id="pl-l" cx="25%" cy="25%" r="75%">
                <stop offset="0%" stopColor="rgba(255,255,255,0.14)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0)" />
              </radialGradient>
              <radialGradient id="pl-r" cx="75%" cy="25%" r="75%">
                <stop offset="0%" stopColor="rgba(255,255,255,0.14)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0)" />
              </radialGradient>

              {/* Consolidation gradients */}
              <radialGradient id="consol-grad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#4a3050" />
                <stop offset="100%" stopColor="#2a1828" />
              </radialGradient>
              <radialGradient id="basal-atel" cx="50%" cy="30%" r="60%">
                <stop offset="0%" stopColor="#6a5048" />
                <stop offset="100%" stopColor="#3a2820" />
              </radialGradient>

              {/* Heart gradients */}
              <radialGradient id="heart-myo" cx="45%" cy="35%" r="60%">
                <stop offset="0%" stopColor="#c84848" />
                <stop offset="35%" stopColor="#a83838" />
                <stop offset="70%" stopColor="#882828" />
                <stop offset="100%" stopColor="#682020" />
              </radialGradient>
              <radialGradient id="heart-ra" cx="50%" cy="40%" r="55%">
                <stop offset="0%" stopColor="#7848a0" />
                <stop offset="100%" stopColor="#583078" />
              </radialGradient>
              <radialGradient id="heart-la" cx="50%" cy="40%" r="55%">
                <stop offset="0%" stopColor="#c04040" />
                <stop offset="100%" stopColor="#982828" />
              </radialGradient>
              <linearGradient id="aorta-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#d04848" />
                <stop offset="100%" stopColor="#a03030" />
              </linearGradient>
              <linearGradient id="vein-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6848a0" />
                <stop offset="100%" stopColor="#483878" />
              </linearGradient>
              <radialGradient id="heart-sheen" cx="35%" cy="25%" r="65%">
                <stop offset="0%" stopColor="rgba(255,200,200,0.2)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0)" />
              </radialGradient>

              {/* Diaphragm gradient */}
              <linearGradient id="diaph-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#b08868" />
                <stop offset="100%" stopColor="#8a6848" />
              </linearGradient>

              {/* Alveolar sac gradient */}
              <radialGradient id="alv-grad" cx="40%" cy="40%" r="60%">
                <stop offset="0%" stopColor="rgba(230,180,180,0.5)" />
                <stop offset="100%" stopColor="rgba(180,120,120,0.15)" />
              </radialGradient>

              <filter id="tachy-glow">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>

              {/* Rib bone gradient */}
              <linearGradient id="rib-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#c0b8b0" />
                <stop offset="50%" stopColor="#a89888" />
                <stop offset="100%" stopColor="#908070" />
              </linearGradient>

              {/* Clip paths for lung outlines */}
              <clipPath id="clip-lungs">
                <path d={leftLungPath(expansion)} />
                <path d={rightLungPath(expansion)} />
              </clipPath>
            </defs>

            {/* ═══ RIB CAGE ═══ */}
            <g opacity="0.18">
              <rect x="96" y="48" width="8" height="80" rx="3" fill="#a89888" opacity="0.3" />
              <line x1="100" y1="48" x2="100" y2="128" stroke="#b0a090" strokeWidth="0.4" opacity="0.25" />
              {[
                { y: 52, lx: 22, rx: 178, curve: 6 },
                { y: 62, lx: 18, rx: 182, curve: 8 },
                { y: 74, lx: 16, rx: 184, curve: 10 },
                { y: 86, lx: 18, rx: 182, curve: 12 },
                { y: 98, lx: 20, rx: 180, curve: 13 },
                { y: 110, lx: 24, rx: 176, curve: 14 },
                { y: 122, lx: 28, rx: 172, curve: 14 },
                { y: 134, lx: 34, rx: 166, curve: 13 },
                { y: 144, lx: 40, rx: 160, curve: 11 },
                { y: 153, lx: 48, rx: 152, curve: 8 },
              ].map((rib, i) => (
                <g key={i}>
                  <path d={`M97,${rib.y} Q${60},${rib.y + rib.curve} ${rib.lx},${rib.y + rib.curve * 0.6}`}
                    fill="none" stroke="url(#rib-grad)" strokeWidth="1.8" strokeLinecap="round" />
                  <path d={`M103,${rib.y} Q${140},${rib.y + rib.curve} ${rib.rx},${rib.y + rib.curve * 0.6}`}
                    fill="none" stroke="url(#rib-grad)" strokeWidth="1.8" strokeLinecap="round" />
                </g>
              ))}
              {[52, 62, 74, 86, 98, 110, 122].map((y, i) => (
                <g key={`cart-${i}`}>
                  <path d={`M97,${y} Q92,${y + 1} 88,${y + 2}`} fill="none" stroke="#b0a898" strokeWidth="1" opacity="0.4" />
                  <path d={`M103,${y} Q108,${y + 1} 112,${y + 2}`} fill="none" stroke="#b0a898" strokeWidth="1" opacity="0.4" />
                </g>
              ))}
              {[57, 68, 80, 92, 104, 116, 128, 139, 149].map((y, i) => (
                <g key={`ic-${i}`} opacity="0.35">
                  <path d={`M92,${y} Q${58},${y + 3} ${20 + i * 3},${y + 2}`}
                    fill="none" stroke="#786860" strokeWidth="0.3" strokeDasharray="3,2" />
                  <path d={`M108,${y} Q${142},${y + 3} ${180 - i * 3},${y + 2}`}
                    fill="none" stroke="#786860" strokeWidth="0.3" strokeDasharray="3,2" />
                </g>
              ))}
              {[50, 60, 72, 84, 96, 108, 120, 132, 144].map((y, i) => (
                <rect key={`vert-${i}`} x="97" y={y} width="6" height="8" rx="1.5" fill="#908070" opacity="0.15" />
              ))}
            </g>

            {/* ═══ DIAPHRAGM ═══ */}
            <g>
              {/* Diaphragm domes — muscular sheet, scales with expansion */}
              <path
                d={`M${lx(20)},${my(diaphragmY + 4)} Q${lx(48)},${my(diaphragmY - 10)} ${mx(80)},${my(diaphragmY - 4)}
                   Q${mx(100)},${my(diaphragmY + 2)} ${mx(120)},${my(diaphragmY - 6)}
                   Q${rx(152)},${my(diaphragmY - 12)} ${rx(180)},${my(diaphragmY + 4)}`}
                fill="none" stroke="url(#diaph-grad)" strokeWidth="2" opacity="0.4"
              />
              {/* Central tendon */}
              <path
                d={`M${mx(80)},${my(diaphragmY - 4)} Q${mx(100)},${my(diaphragmY - 8)} ${mx(120)},${my(diaphragmY - 6)}`}
                fill="none" stroke="#c0a080" strokeWidth="1.2" opacity="0.25"
              />
              {/* Muscle fibre striations */}
              {[-25, -12, 12, 25].map((offset, i) => (
                <path key={`df-${i}`}
                  d={`M${mx(100 + offset)},${my(diaphragmY)} Q${mx(100 + offset * 0.8)},${my(diaphragmY - 6)} ${mx(100 + offset * 0.5)},${my(diaphragmY - 4)}`}
                  fill="none" stroke="#a08060" strokeWidth="0.4" opacity="0.2" />
              ))}
            </g>

            {/* ═══ TRACHEA ═══ */}
            <rect x="93" y="6" width="14" height="44" rx="6" fill="url(#aw-grad)" stroke="#a07070" strokeWidth="0.8" />
            {[12, 18, 24, 30, 36, 42].map(y => (
              <path key={y} d={`M93.5,${y} Q100,${y - 2} 106.5,${y}`} fill="none" stroke="#c49898" strokeWidth="1.1" opacity="0.55" />
            ))}
            <line x1="106.5" y1="8" x2="106.5" y2="48" stroke="#b08888" strokeWidth="0.4" opacity="0.4" />
            <rect x="96" y="8" width="8" height="40" rx="3" fill="#1a0a12" opacity="0.35" />
            {/* Mucosal folds in tracheal lumen */}
            {[14, 22, 30, 38].map(y => (
              <path key={`mu-${y}`} d={`M97,${y} Q100,${y - 0.5} 103,${y}`} fill="none" stroke="#2a1520" strokeWidth="0.3" opacity="0.2" />
            ))}

            {/* ═══ CARINA ═══ */}
            <ellipse cx="100" cy="50" rx="5" ry="3" fill="#b08080" />
            <ellipse cx="100" cy="50" rx="3" ry="1.5" fill="#1a0a12" opacity="0.25" />
            {/* Carinal ridge — sharp dividing cartilage */}
            <line x1="100" y1="48" x2="100" y2="52" stroke="#c09090" strokeWidth="0.6" opacity="0.4" />

            {/* ═══ MAIN BRONCHI (scale control points with expansion) ═══ */}
            {/* Left main — longer, more horizontal */}
            <path
              d={`M100,50 C${mx(90)},${my(56)} ${mx(82)},${my(61)} 75,68`}
              fill="none" stroke="url(#aw-grad)" strokeWidth={airwayWidth} strokeLinecap="round"
            />
            {/* Left main lumen */}
            <path
              d={`M100,50 C${mx(90)},${my(56)} ${mx(82)},${my(61)} 75,68`}
              fill="none" stroke="#1a0a12" strokeWidth={airwayWidth * 0.35} strokeLinecap="round" opacity="0.2"
            />
            {/* Right main — shorter, steeper */}
            <path
              d={`M100,50 C${mx(108)},${my(54)} ${mx(118)},${my(57)} 125,62`}
              fill="none" stroke="url(#aw-grad)" strokeWidth={airwayWidth} strokeLinecap="round"
            />
            {/* Right main lumen */}
            <path
              d={`M100,50 C${mx(108)},${my(54)} ${mx(118)},${my(57)} 125,62`}
              fill="none" stroke="#1a0a12" strokeWidth={airwayWidth * 0.35} strokeLinecap="round" opacity="0.2"
            />
            {/* Cartilage rings on main bronchi */}
            {[0.25, 0.5, 0.75].map((t, i) => {
              const lbx = 100 + (75 - 100) * t + (mx(82) - 100) * 0.3;
              const lby = 50 + (68 - 50) * t;
              return <circle key={`lbr-${i}`} cx={lbx} cy={lby} r="0.5" fill="#c49898" opacity="0.3" />;
            })}
            {[0.3, 0.6].map((t, i) => {
              const rbx = 100 + (125 - 100) * t;
              const rby = 50 + (62 - 50) * t;
              return <circle key={`rbr-${i}`} cx={rbx} cy={rby} r="0.5" fill="#c49898" opacity="0.3" />;
            })}

            {/* ═══ LEFT LOBAR BRONCHI ═══ */}
            <path d={`M75,68 C${lx(67)},${ly(72)} ${lx(59)},${ly(70)} ${lx(51.5)},${ly(74)}`} fill="none" stroke="#c09090" strokeWidth={subAirwayWidth} strokeLinecap="round" />
            <path d={`M75,68 C${lx(69)},${ly(78)} ${lx(63)},${ly(86)} ${lx(58)},${ly(94)}`} fill="none" stroke="#c09090" strokeWidth={subAirwayWidth} strokeLinecap="round" />
            <path d={`M75,68 C${lx(77)},${ly(80)} ${lx(75)},${ly(90)} ${lx(71)},${ly(100)}`} fill="none" stroke="#c09090" strokeWidth={subAirwayWidth} strokeLinecap="round" />

            {/* ═══ RIGHT LOBAR BRONCHI ═══ */}
            <path d={`M${rx(120)},${ry(58)} C${rx(128)},${ry(56)} ${rx(138)},${ry(54)} ${rx(144)},${ry(58)}`} fill="none" stroke="#c09090" strokeWidth={subAirwayWidth} strokeLinecap="round" />
            <path d={`M125,62 C${rx(133)},${ry(70)} ${rx(141)},${ry(76)} ${rx(147)},${ry(83)}`} fill="none" stroke="#c09090" strokeWidth={subAirwayWidth} strokeLinecap="round" />
            <path d={`M125,62 C${rx(127)},${ry(74)} ${rx(125)},${ry(84)} ${rx(123)},${ry(94)}`} fill="none" stroke="#c09090" strokeWidth={subAirwayWidth} strokeLinecap="round" />

            {/* ═══ SEGMENTAL AIRWAYS (3rd generation) ═══ */}
            {/* Left upper segments */}
            <path d={`M${lx(51.5)},${ly(74)} C${lx(47)},${ly(78)} ${lx(41)},${ly(84)} ${lx(37)},${ly(90)}`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            <path d={`M${lx(51.5)},${ly(74)} C${lx(51)},${ly(82)} ${lx(45)},${ly(88)} ${lx(43)},${ly(96)}`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            {/* Left lingular segments */}
            <path d={`M${lx(58)},${ly(94)} C${lx(53)},${ly(100)} ${lx(47)},${ly(106)} ${lx(43)},${ly(113)}`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            <path d={`M${lx(58)},${ly(94)} C${lx(55)},${ly(100)} ${lx(51)},${ly(98)} ${lx(47)},${ly(102)}`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.45" />
            {/* Left lower segments */}
            <path d={`M${lx(71)},${ly(100)} C${lx(67)},${ly(108)} ${lx(61)},${ly(116)} ${lx(57)},${ly(124)}`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            <path d={`M${lx(71)},${ly(100)} C${lx(75)},${ly(110)} ${lx(73)},${ly(120)} ${lx(69)},${ly(128)}`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            <path d={`M${lx(71)},${ly(100)} C${lx(66)},${ly(106)} ${lx(60)},${ly(108)} ${lx(54)},${ly(114)}`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.4" />

            {/* Right upper segments */}
            <path d={`M${rx(144)},${ry(58)} C${rx(150)},${ry(62)} ${rx(156)},${ry(66)} ${rx(160)},${ry(72)}`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            <path d={`M${rx(144)},${ry(58)} C${rx(148)},${ry(64)} ${rx(152)},${ry(70)} ${rx(154)},${ry(78)}`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            <path d={`M${rx(144)},${ry(58)} C${rx(150)},${ry(56)} ${rx(156)},${ry(58)} ${rx(162)},${ry(64)}`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.45" />
            {/* Right middle segments */}
            <path d={`M${rx(147)},${ry(83)} C${rx(153)},${ry(88)} ${rx(159)},${ry(94)} ${rx(163)},${ry(100)}`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            <path d={`M${rx(147)},${ry(83)} C${rx(151)},${ry(86)} ${rx(157)},${ry(84)} ${rx(162)},${ry(88)}`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.45" />
            {/* Right lower segments */}
            <path d={`M${rx(123)},${ry(94)} C${rx(127)},${ry(104)} ${rx(131)},${ry(114)} ${rx(133)},${ry(124)}`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            <path d={`M${rx(123)},${ry(94)} C${rx(119)},${ry(104)} ${rx(115)},${ry(114)} ${rx(113)},${ry(124)}`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            <path d={`M${rx(123)},${ry(94)} C${rx(128)},${ry(100)} ${rx(134)},${ry(104)} ${rx(140)},${ry(112)}`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.4" />

            {/* ═══ SUBSEGMENTAL AIRWAYS (4th generation) + TERMINAL ALVEOLAR CLUSTERS ═══ */}
            <g clipPath="url(#clip-lungs)">
              {/* Left upper subsegmentals */}
              <SubsegmentalAirway x1={lx(37)} y1={ly(90)} x2={lx(32)} y2={ly(96)} w={quaternaryWidth} e={e} />
              <SubsegmentalAirway x1={lx(37)} y1={ly(90)} x2={lx(34)} y2={ly(84)} w={quaternaryWidth} e={e} />
              <SubsegmentalAirway x1={lx(43)} y1={ly(96)} x2={lx(38)} y2={ly(103)} w={quaternaryWidth} e={e} />
              <SubsegmentalAirway x1={lx(43)} y1={ly(96)} x2={lx(40)} y2={ly(92)} w={quaternaryWidth} e={e} dir="up" />
              {/* Left lingular subsegmentals */}
              <SubsegmentalAirway x1={lx(43)} y1={ly(113)} x2={lx(38)} y2={ly(120)} w={quaternaryWidth} e={e} />
              <SubsegmentalAirway x1={lx(43)} y1={ly(113)} x2={lx(40)} y2={ly(108)} w={quaternaryWidth} e={e} dir="up" />
              <SubsegmentalAirway x1={lx(47)} y1={ly(102)} x2={lx(42)} y2={ly(106)} w={quaternaryWidth} e={e} />
              {/* Left lower subsegmentals */}
              <SubsegmentalAirway x1={lx(57)} y1={ly(124)} x2={lx(52)} y2={ly(132)} w={quaternaryWidth} e={e} />
              <SubsegmentalAirway x1={lx(57)} y1={ly(124)} x2={lx(54)} y2={ly(120)} w={quaternaryWidth} e={e} dir="up" />
              <SubsegmentalAirway x1={lx(69)} y1={ly(128)} x2={lx(66)} y2={ly(136)} w={quaternaryWidth} e={e} />
              <SubsegmentalAirway x1={lx(69)} y1={ly(128)} x2={lx(72)} y2={ly(134)} w={quaternaryWidth} e={e} />
              <SubsegmentalAirway x1={lx(54)} y1={ly(114)} x2={lx(48)} y2={ly(120)} w={quaternaryWidth} e={e} />

              {/* Right upper subsegmentals */}
              <SubsegmentalAirway x1={rx(160)} y1={ry(72)} x2={rx(166)} y2={ry(78)} w={quaternaryWidth} e={e} />
              <SubsegmentalAirway x1={rx(160)} y1={ry(72)} x2={rx(164)} y2={ry(66)} w={quaternaryWidth} e={e} dir="up" />
              <SubsegmentalAirway x1={rx(154)} y1={ry(78)} x2={rx(158)} y2={ry(86)} w={quaternaryWidth} e={e} />
              <SubsegmentalAirway x1={rx(162)} y1={ry(64)} x2={rx(168)} y2={ry(68)} w={quaternaryWidth} e={e} />
              <SubsegmentalAirway x1={rx(162)} y1={ry(64)} x2={rx(166)} y2={ry(60)} w={quaternaryWidth} e={e} dir="up" />
              {/* Right middle subsegmentals */}
              <SubsegmentalAirway x1={rx(163)} y1={ry(100)} x2={rx(168)} y2={ry(106)} w={quaternaryWidth} e={e} />
              <SubsegmentalAirway x1={rx(163)} y1={ry(100)} x2={rx(166)} y2={ry(96)} w={quaternaryWidth} e={e} dir="up" />
              <SubsegmentalAirway x1={rx(162)} y1={ry(88)} x2={rx(168)} y2={ry(92)} w={quaternaryWidth} e={e} />
              {/* Right lower subsegmentals */}
              <SubsegmentalAirway x1={rx(133)} y1={ry(124)} x2={rx(138)} y2={ry(132)} w={quaternaryWidth} e={e} />
              <SubsegmentalAirway x1={rx(133)} y1={ry(124)} x2={rx(130)} y2={ry(132)} w={quaternaryWidth} e={e} />
              <SubsegmentalAirway x1={rx(113)} y1={ry(124)} x2={rx(108)} y2={ry(132)} w={quaternaryWidth} e={e} />
              <SubsegmentalAirway x1={rx(113)} y1={ry(124)} x2={rx(116)} y2={ry(130)} w={quaternaryWidth} e={e} />
              <SubsegmentalAirway x1={rx(140)} y1={ry(112)} x2={rx(146)} y2={ry(118)} w={quaternaryWidth} e={e} />
              <SubsegmentalAirway x1={rx(140)} y1={ry(112)} x2={rx(144)} y2={ry(108)} w={quaternaryWidth} e={e} dir="up" />
            </g>

            {/* ═══ LEFT LUNG PARENCHYMA ═══ */}
            <path d={leftLungPath(expansion)} fill={`url(#${lungFill})`} opacity={lungOpacity} stroke="#8a5560" strokeWidth="1.2" />
            {/* Visceral pleura — thin glistening membrane */}
            <path d={leftLungPath(expansion)} fill="url(#pl-l)" opacity="0.45" />
            <path d={leftLungPath(expansion)} fill="none" stroke="rgba(255,220,220,0.08)" strokeWidth="0.4" />
            {/* Left oblique fissure */}
            <path d={leftFissure(expansion)} fill="none" stroke="#7a4a55" strokeWidth="0.7" strokeDasharray="4,2" opacity="0.45" />

            {/* ═══ RIGHT LUNG PARENCHYMA ═══ */}
            <path d={rightLungPath(expansion)} fill={`url(#${lungFill})`} opacity={lungOpacity} stroke="#8a5560" strokeWidth="1.2" />
            <path d={rightLungPath(expansion)} fill="url(#pl-r)" opacity="0.45" />
            <path d={rightLungPath(expansion)} fill="none" stroke="rgba(255,220,220,0.08)" strokeWidth="0.4" />
            {/* Right oblique fissure */}
            <path d={rightObliqueFissure(expansion)} fill="none" stroke="#7a4a55" strokeWidth="0.7" strokeDasharray="4,2" opacity="0.45" />
            {/* Right horizontal fissure */}
            <path d={rightHorizontalFissure(expansion)} fill="none" stroke="#7a4a55" strokeWidth="0.7" strokeDasharray="4,2" opacity="0.45" />

            {/* ═══ PULMONARY VASCULATURE ═══ */}
            {/* Left pulmonary artery branches */}
            <path d={`M98,52 C${lx(94)},${ly(58)} ${lx(88)},${ly(68)} ${lx(82)},${ly(78)}`} fill="none" stroke="#7a4060" strokeWidth="0.7" opacity="0.22" />
            <path d={`M${lx(82)},${ly(78)} C${lx(74)},${ly(88)} ${lx(62)},${ly(102)} ${lx(50)},${ly(118)}`} fill="none" stroke="#7a4060" strokeWidth="0.5" opacity="0.18" />
            <path d={`M${lx(82)},${ly(78)} C${lx(76)},${ly(86)} ${lx(66)},${ly(94)} ${lx(56)},${ly(104)}`} fill="none" stroke="#7a4060" strokeWidth="0.45" opacity="0.16" />
            <path d={`M${lx(50)},${ly(118)} C${lx(44)},${ly(126)} ${lx(38)},${ly(136)} ${lx(34)},${ly(146)}`} fill="none" stroke="#7a4060" strokeWidth="0.35" opacity="0.12" />
            <path d={`M${lx(56)},${ly(104)} C${lx(50)},${ly(112)} ${lx(42)},${ly(122)} ${lx(36)},${ly(132)}`} fill="none" stroke="#7a4060" strokeWidth="0.35" opacity="0.12" />
            <path d={`M${lx(88)},${ly(66)} C${lx(80)},${ly(62)} ${lx(70)},${ly(64)} ${lx(62)},${ly(70)}`} fill="none" stroke="#7a4060" strokeWidth="0.35" opacity="0.14" />
            <path d={`M${lx(62)},${ly(70)} C${lx(54)},${ly(76)} ${lx(46)},${ly(84)} ${lx(40)},${ly(94)}`} fill="none" stroke="#7a4060" strokeWidth="0.3" opacity="0.11" />
            <path d={`M${lx(70)},${ly(64)} C${lx(62)},${ly(58)} ${lx(54)},${ly(60)} ${lx(46)},${ly(66)}`} fill="none" stroke="#7a4060" strokeWidth="0.25" opacity="0.10" />
            <path d={`M${lx(74)},${ly(86)} C${lx(64)},${ly(94)} ${lx(56)},${ly(106)} ${lx(50)},${ly(116)}`} fill="none" stroke="#7a4060" strokeWidth="0.3" opacity="0.12" />
            {/* Left pulmonary veins */}
            <path d={`M${lx(92)},${ly(70)} C${lx(84)},${ly(80)} ${lx(72)},${ly(90)} ${lx(62)},${ly(98)}`} fill="none" stroke="#605080" strokeWidth="0.4" opacity="0.14" />
            <path d={`M${lx(62)},${ly(98)} C${lx(52)},${ly(108)} ${lx(44)},${ly(120)} ${lx(38)},${ly(134)}`} fill="none" stroke="#605080" strokeWidth="0.3" opacity="0.11" />
            <path d={`M${lx(78)},${ly(76)} C${lx(68)},${ly(70)} ${lx(58)},${ly(68)} ${lx(48)},${ly(74)}`} fill="none" stroke="#605080" strokeWidth="0.25" opacity="0.10" />

            {/* Right pulmonary artery branches */}
            <path d={`M102,52 C${rx(106)},${ry(58)} ${rx(114)},${ry(66)} ${rx(122)},${ry(74)}`} fill="none" stroke="#7a4060" strokeWidth="0.7" opacity="0.22" />
            <path d={`M${rx(122)},${ry(74)} C${rx(130)},${ry(82)} ${rx(142)},${ry(96)} ${rx(150)},${ry(110)}`} fill="none" stroke="#7a4060" strokeWidth="0.5" opacity="0.18" />
            <path d={`M${rx(122)},${ry(74)} C${rx(128)},${ry(82)} ${rx(136)},${ry(92)} ${rx(144)},${ry(102)}`} fill="none" stroke="#7a4060" strokeWidth="0.45" opacity="0.16" />
            <path d={`M${rx(150)},${ry(110)} C${rx(156)},${ry(120)} ${rx(162)},${ry(132)} ${rx(166)},${ry(142)}`} fill="none" stroke="#7a4060" strokeWidth="0.35" opacity="0.12" />
            <path d={`M${rx(144)},${ry(102)} C${rx(150)},${ry(112)} ${rx(158)},${ry(124)} ${rx(164)},${ry(134)}`} fill="none" stroke="#7a4060" strokeWidth="0.35" opacity="0.12" />
            <path d={`M${rx(114)},${ry(60)} C${rx(124)},${ry(56)} ${rx(134)},${ry(54)} ${rx(144)},${ry(58)}`} fill="none" stroke="#7a4060" strokeWidth="0.35" opacity="0.14" />
            <path d={`M${rx(144)},${ry(58)} C${rx(152)},${ry(62)} ${rx(160)},${ry(70)} ${rx(166)},${ry(80)}`} fill="none" stroke="#7a4060" strokeWidth="0.3" opacity="0.11" />
            <path d={`M${rx(130)},${ry(54)} C${rx(138)},${ry(50)} ${rx(146)},${ry(52)} ${rx(154)},${ry(58)}`} fill="none" stroke="#7a4060" strokeWidth="0.25" opacity="0.10" />
            <path d={`M${rx(134)},${ry(80)} C${rx(144)},${ry(86)} ${rx(154)},${ry(94)} ${rx(162)},${ry(104)}`} fill="none" stroke="#7a4060" strokeWidth="0.3" opacity="0.12" />
            {/* Right pulmonary veins */}
            <path d={`M${rx(110)},${ry(64)} C${rx(120)},${ry(74)} ${rx(132)},${ry(84)} ${rx(142)},${ry(92)}`} fill="none" stroke="#605080" strokeWidth="0.4" opacity="0.14" />
            <path d={`M${rx(142)},${ry(92)} C${rx(150)},${ry(102)} ${rx(158)},${ry(116)} ${rx(164)},${ry(128)}`} fill="none" stroke="#605080" strokeWidth="0.3" opacity="0.11" />
            <path d={`M${rx(126)},${ry(68)} C${rx(136)},${ry(64)} ${rx(146)},${ry(62)} ${rx(156)},${ry(66)}`} fill="none" stroke="#605080" strokeWidth="0.25" opacity="0.10" />

            {/* Peripheral capillary blush */}
            {[
              [lx(44), ly(86)], [lx(38), ly(108)], [lx(52), ly(128)], [lx(60), ly(114)],
              [lx(48), ly(96)], [lx(42), ly(122)], [lx(34), ly(100)], [lx(56), ly(138)],
            ].map(([cx, cy], i) => (
              <circle key={`lcb-${i}`} cx={cx} cy={cy} r={0.4 + (i % 3) * 0.15} fill="#7a4060" opacity={0.06 + (i % 2) * 0.02} />
            ))}
            {[
              [rx(156), ry(84)], [rx(164), ry(106)], [rx(148), ry(124)], [rx(140), ry(110)],
              [rx(158), ry(94)], [rx(162), ry(120)], [rx(168), ry(98)], [rx(144), ry(136)],
            ].map(([cx, cy], i) => (
              <circle key={`rcb-${i}`} cx={cx} cy={cy} r={0.4 + (i % 3) * 0.15} fill="#7a4060" opacity={0.06 + (i % 2) * 0.02} />
            ))}

            {/* ═══ MEDIASTINAL STRUCTURES ═══ */}
            {/* Esophagus — posterior to trachea */}
            <path d={`M104,10 C105,20 105,35 104,48`} fill="none" stroke="#906060" strokeWidth="1.2" opacity="0.12" />
            {/* Thoracic aorta — descending, lateral to spine */}
            <path d={`M106,50 C108,70 108,100 106,140`} fill="none" stroke="#a04040" strokeWidth="1.5" opacity="0.1" />
            {/* Azygos vein — right paravertebral */}
            <path d={`M110,130 C112,110 112,80 108,55`} fill="none" stroke="#605080" strokeWidth="0.6" opacity="0.08" />
            {/* Mediastinal fat pad */}
            <ellipse cx="100" cy="55" rx="8" ry="4" fill="#c0a880" opacity="0.06" />

            {/* ═══ HEART ═══ */}
            <g
              transform={`translate(${100 - 18 * heartCompression}, 72) scale(${heartCompression * heartBeat}, ${heartBeat})`}
              style={{ transformOrigin: '20px 35px', transition: heartTransition }}
              filter={tachyIntensity > 0.3 ? 'url(#tachy-glow)' : undefined}
              opacity={bradyIntensity > 0 ? 1 - bradyIntensity * 0.15 : 1}
            >
              {tachyIntensity > 0 && (
                <path d="M18,0 C8,5 2,20 4,38 C6,52 14,62 22,68 C28,72 34,70 38,64 C44,54 42,38 40,24 C38,12 30,-2 18,0Z"
                  fill={`rgba(255, ${Math.round(60 - tachyIntensity * 40)}, ${Math.round(40 - tachyIntensity * 30)}, ${tachyIntensity * 0.25})`} />
              )}
              {bradyIntensity > 0 && (
                <path d="M18,0 C8,5 2,20 4,38 C6,52 14,62 22,68 C28,72 34,70 38,64 C44,54 42,38 40,24 C38,12 30,-2 18,0Z"
                  fill={`rgba(${Math.round(60 + bradyIntensity * 20)}, ${Math.round(40 + bradyIntensity * 30)}, ${Math.round(100 + bradyIntensity * 55)}, ${bradyIntensity * 0.35})`} />
              )}
              <path d="M18,0 C8,5 2,20 4,38 C6,52 14,62 22,68 C28,72 34,70 38,64 C44,54 42,38 40,24 C38,12 30,-2 18,0Z"
                fill="none" stroke={bradyIntensity > 0 ? `rgba(${100 - bradyIntensity * 20}, ${80 - bradyIntensity * 20}, ${100 + bradyIntensity * 40}, 0.5)` : '#a06060'} strokeWidth="0.6" opacity="0.4" />

              {/* Right atrium */}
              <g transform={`scale(${1 + cardiacPhase.atrial * 0.08}, ${1 + cardiacPhase.atrial * 0.06})`} style={{ transformOrigin: '34px 30px', transition: chamberTransitionSlow || 'transform 0.06s ease-out' }}>
                <path d="M30,12 C36,16 40,24 39,34 C38,42 34,48 28,50 C26,42 28,28 30,12Z"
                  fill="url(#heart-ra)" opacity={0.85 + cardiacPhase.atrial * 0.1} stroke="#5a2868" strokeWidth="0.5" />
                {/* Tricuspid valve annulus hint */}
                <ellipse cx="30" cy="38" rx="3" ry="1.5" fill="none" stroke="#7a4890" strokeWidth="0.3" opacity="0.3" />
              </g>
              <path d="M34,4 C36,8 36,12 34,16" fill="none" stroke="url(#vein-grad)" strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
              <path d="M35,50 C37,54 37,58 36,62" fill="none" stroke="url(#vein-grad)" strokeWidth="2.5" strokeLinecap="round" opacity="0.6" />

              {/* Right ventricle */}
              <g transform={`scale(${1 + cardiacPhase.ventricular * 0.10}, ${1 + cardiacPhase.ventricular * 0.06})`} style={{ transformOrigin: '22px 38px', transition: chamberTransitionSlow || 'transform 0.05s ease-out' }}>
                <path d="M18,18 C22,16 28,18 30,24 C32,32 30,44 26,52 C22,58 16,56 14,48 C12,38 14,26 18,18Z"
                  fill="url(#heart-myo)" opacity={0.75 + cardiacPhase.ventricular * 0.15} stroke="#802020" strokeWidth="0.5" />
                {/* RV trabeculations */}
                <path d="M20,24 C22,30 22,38 20,44" fill="none" stroke="#601818" strokeWidth="0.25" opacity="0.2" />
                <path d="M24,22 C25,28 24,36 23,42" fill="none" stroke="#601818" strokeWidth="0.2" opacity="0.15" />
              </g>

              {/* Left atrium */}
              <g transform={`scale(${1 + cardiacPhase.atrial * 0.08}, ${1 + cardiacPhase.atrial * 0.06})`} style={{ transformOrigin: '10px 28px', transition: chamberTransitionSlow || 'transform 0.06s ease-out' }}>
                <path d="M10,14 C6,18 4,26 6,34 C8,40 12,44 16,42 C14,34 12,24 10,14Z"
                  fill="url(#heart-la)" opacity={0.8 + cardiacPhase.atrial * 0.1} stroke="#802020" strokeWidth="0.4" />
                {/* Mitral valve annulus hint */}
                <ellipse cx="12" cy="36" rx="2.5" ry="1.2" fill="none" stroke="#a03030" strokeWidth="0.3" opacity="0.25" />
              </g>
              <path d="M4,20 C2,22 0,26 2,30" fill="none" stroke="#a04040" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
              <path d="M4,30 C2,34 0,38 2,42" fill="none" stroke="#a04040" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />

              {/* Left ventricle */}
              <g transform={`scale(${1 + cardiacPhase.ventricular * 0.12}, ${1 + cardiacPhase.ventricular * 0.08})`} style={{ transformOrigin: '15px 50px', transition: chamberTransitionSlow || 'transform 0.05s ease-out' }}>
                <path d="M8,30 C4,36 2,46 6,56 C10,64 18,70 24,66 C28,62 26,52 24,44 C22,38 16,32 8,30Z"
                  fill="url(#heart-myo)" opacity={0.9 + cardiacPhase.ventricular * 0.1} stroke="#802020" strokeWidth="0.6" />
                {/* LV papillary muscle hints */}
                <circle cx="10" cy="50" r="1" fill="#702020" opacity="0.2" />
                <circle cx="16" cy="56" r="0.8" fill="#702020" opacity="0.2" />
                {/* Chordae tendineae suggestion */}
                <path d="M10,50 C11,46 12,40 12,36" fill="none" stroke="#802020" strokeWidth="0.2" opacity="0.15" />
                <path d="M16,56 C15,50 13,44 12,38" fill="none" stroke="#802020" strokeWidth="0.2" opacity="0.15" />
              </g>
              <path d="M16,28 C18,38 20,50 18,60" fill="none" stroke="#601818" strokeWidth="0.5" opacity="0.4" />
              <path d="M18,20 C20,30 22,44 20,56" fill="none" stroke="#6a2020" strokeWidth="0.8" opacity="0.35" />

              {/* Aortic arch */}
              <path d="M16,8 C14,2 16,-4 22,-6 C28,-6 34,-2 32,6" fill="none" stroke="url(#aorta-grad)" strokeWidth="3" strokeLinecap="round" opacity="0.8" />
              <path d="M18,18 C17,14 16,10 16,8" fill="none" stroke="url(#aorta-grad)" strokeWidth="2.8" strokeLinecap="round" opacity="0.75" />
              {/* Aortic valve hint */}
              <circle cx="17" cy="16" r="1.5" fill="none" stroke="#c04040" strokeWidth="0.3" opacity="0.25" />
              <path d="M24,-5 C26,-10 28,-14" fill="none" stroke="#c04040" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
              <path d="M22,-6 C22,-12 22,-16" fill="none" stroke="#c04040" strokeWidth="1" strokeLinecap="round" opacity="0.45" />
              <path d="M20,-5 C18,-10 16,-14" fill="none" stroke="#c04040" strokeWidth="1" strokeLinecap="round" opacity="0.45" />
              <path d="M32,6 C34,16 34,30 32,44" fill="none" stroke="url(#aorta-grad)" strokeWidth="2.2" strokeLinecap="round" opacity="0.6" />

              {/* Pulmonary trunk */}
              <path d="M20,14 C18,8 14,4 10,6 C6,8 4,14 6,18" fill="none" stroke="#7050a0" strokeWidth="2.2" strokeLinecap="round" opacity="0.65" />
              {/* Pulmonary valve hint */}
              <circle cx="18" cy="12" r="1.2" fill="none" stroke="#7050a0" strokeWidth="0.3" opacity="0.2" />
              <path d="M10,6 C6,2 2,2 0,6" fill="none" stroke="#7050a0" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
              <path d="M10,6 C14,2 18,0 20,2" fill="none" stroke="#7050a0" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />

              {/* Epicardial surface sheen */}
              <path d="M8,30 C4,36 2,46 6,56 C10,64 18,70 24,66 C28,62 26,52 24,44 C22,38 16,32 8,30Z"
                fill="url(#heart-sheen)" opacity="0.6" />

              {/* Coronary arteries */}
              <path d="M16,16 C14,24 12,34 14,48" fill="none" stroke="#d05050" strokeWidth="0.6" opacity="0.4" strokeDasharray="2,1" />
              <path d="M24,14 C28,20 30,30 28,42" fill="none" stroke="#d05050" strokeWidth="0.6" opacity="0.35" strokeDasharray="2,1" />
              <path d="M14,18 C8,24 6,32 8,42" fill="none" stroke="#d05050" strokeWidth="0.5" opacity="0.3" strokeDasharray="2,1" />
              {/* Coronary sinus */}
              <path d="M28,42 C30,46 32,48 34,48" fill="none" stroke="#605080" strokeWidth="0.4" opacity="0.2" strokeDasharray="1.5,1" />

              {/* Apex */}
              <circle cx="20" cy="68" r="1.5" fill="#a03030" opacity="0.5" />
            </g>

            {/* Heart status warnings */}
            {heartCompression < 0.75 && (
              <text x="100" y="145" textAnchor="middle" fill="#e08050" fontSize="7" fontFamily="monospace" fontWeight="bold" opacity="0.8">
                Cardiac Compression
              </text>
            )}
            {tachyIntensity > 0.3 && heartCompression >= 0.75 && (
              <text x="100" y="145" textAnchor="middle" fill="#e05050" fontSize="7" fontFamily="monospace" fontWeight="bold" opacity={0.5 + tachyIntensity * 0.4}>
                {vitals.hr >= 150 ? '⚠ Severe Tachycardia' : '⚠ Tachycardia'} ({Math.round(vitals.hr)} bpm)
              </text>
            )}
            {bradyIntensity > 0 && heartCompression >= 0.75 && (
              <text x="100" y="145" textAnchor="middle" fill="#7080d0" fontSize="7" fontFamily="monospace" fontWeight="bold" opacity={0.5 + bradyIntensity * 0.4}>
                {vitals.hr <= 30 ? '⚠ Severe Bradycardia' : '⚠ Bradycardia'} ({Math.round(vitals.hr)} bpm)
              </text>
            )}

            {/* ═══ ATELECTASIS / CONSOLIDATION PATCHES ═══ */}
            <g clipPath="url(#clip-lungs)">
              {atelPatches.map((p, i) => {
                const isLeft = p.x < 100;
                const sx = isLeft ? lx(p.x) : rx(p.x);
                const sy = isLeft ? ly(p.y) : ry(p.y);
                return (
                  <ellipse key={i} cx={sx} cy={sy} rx={p.rx} ry={p.ry}
                    fill={p.fill || 'url(#consol-grad)'} opacity={p.opacity}
                    transform={p.rotate ? `rotate(${p.rotate} ${sx} ${sy})` : undefined} />
                );
              })}
            </g>

            {/* ═══ BRONCHOSPASM ═══ */}
            {pathology === 'bronchospasm' && (
              <>
                <circle cx={lx(65)} cy={ly(71)} r="2" fill="#e8c040" opacity="0.45" />
                <circle cx={rx(133)} cy={ry(65)} r="2" fill="#e8c040" opacity="0.45" />
                <circle cx={lx(52)} cy={ly(88)} r="1.5" fill="#e8c040" opacity="0.35" />
                <circle cx={rx(150)} cy={ry(81)} r="1.5" fill="#e8c040" opacity="0.35" />
                <ellipse cx={lx(58)} cy={ly(80)} rx="2.5" ry="1" fill="#c8a830" opacity="0.35" />
                <ellipse cx={rx(143)} cy={ry(74)} rx="2.5" ry="1" fill="#c8a830" opacity="0.35" />
              </>
            )}

            {/* ═══ PLEURAL REFLECTION LINES (costophrenic angles) ═══ */}
            <path d={`M${lx(28)},${my(diaphragmY)} Q${lx(24)},${my(diaphragmY - 8)} ${lx(22)},${my(diaphragmY - 20)}`}
              fill="none" stroke="#8a5560" strokeWidth="0.4" opacity="0.15" />
            <path d={`M${rx(172)},${my(diaphragmY)} Q${rx(176)},${my(diaphragmY - 8)} ${rx(178)},${my(diaphragmY - 20)}`}
              fill="none" stroke="#8a5560" strokeWidth="0.4" opacity="0.15" />

            {/* ═══ STATUS TEXT ═══ */}
            {statusText && (
              <text x="100" y="212" textAnchor="middle" fill={statusColor} fontSize="8.5" fontFamily="monospace" fontWeight="bold">
                {statusText}
              </text>
            )}
          </svg>
        </div>
      )}
    </div>
  );
}

/* ── Subsegmental airway with terminal alveolar cluster ── */
function SubsegmentalAirway({ x1, y1, x2, y2, w, e, dir }: {
  x1: number; y1: number; x2: number; y2: number; w: number; e: number; dir?: string;
}) {
  // Terminal alveolar sac cluster — 3-5 tiny circles at the end
  const alvR = 1.0 + e * 0.4;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const nx = len > 0 ? -dy / len : 0;
  const ny = len > 0 ? dx / len : 1;

  return (
    <g opacity="0.4">
      {/* Subsegmental airway */}
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#a07070" strokeWidth={w} strokeLinecap="round" />
      {/* Lumen */}
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#1a0a12" strokeWidth={w * 0.3} strokeLinecap="round" opacity="0.15" />
      {/* Terminal alveolar cluster */}
      <circle cx={x2} cy={y2} r={alvR} fill="rgba(220,170,170,0.25)" stroke="#b08080" strokeWidth="0.2" />
      <circle cx={x2 + nx * alvR * 0.9} cy={y2 + ny * alvR * 0.9} r={alvR * 0.75} fill="rgba(220,170,170,0.2)" stroke="#b08080" strokeWidth="0.15" />
      <circle cx={x2 - nx * alvR * 0.9} cy={y2 - ny * alvR * 0.9} r={alvR * 0.75} fill="rgba(220,170,170,0.2)" stroke="#b08080" strokeWidth="0.15" />
      <circle cx={x2 + (dx / len) * alvR * 0.8} cy={y2 + (dy / len) * alvR * 0.8} r={alvR * 0.6} fill="rgba(220,170,170,0.15)" stroke="#b08080" strokeWidth="0.12" />
    </g>
  );
}

/* ── Lung outline paths ── */
function leftLungPath(exp: number): string {
  const w = 42 * exp;
  const h = 95 * exp;
  const cx = 70;
  const top = 60;
  return `M${cx},${top}
    C${cx - w * 0.12},${top + h * 0.06} ${cx - w * 0.4},${top + h * 0.12} ${cx - w * 0.65},${top + h * 0.22}
    C${cx - w * 0.85},${top + h * 0.35} ${cx - w * 0.95},${top + h * 0.5} ${cx - w},${top + h * 0.65}
    C${cx - w * 0.98},${top + h * 0.78} ${cx - w * 0.88},${top + h * 0.9} ${cx - w * 0.7},${top + h * 0.96}
    C${cx - w * 0.45},${top + h} ${cx - w * 0.15},${top + h * 0.99} ${cx + 4},${top + h * 0.95}
    C${cx + 8},${top + h * 0.82} ${cx + 12},${top + h * 0.72} ${cx + 10},${top + h * 0.62}
    C${cx + 7},${top + h * 0.54} ${cx + 5},${top + h * 0.48} ${cx + 5},${top + h * 0.42}
    C${cx + 4},${top + h * 0.3} ${cx + 3},${top + h * 0.18} ${cx + 1},${top + h * 0.08}
    C${cx},${top + h * 0.02} ${cx},${top} ${cx},${top}Z`;
}

function rightLungPath(exp: number): string {
  const w = 45 * exp;
  const h = 100 * exp;
  const cx = 130;
  const top = 56;
  return `M${cx},${top}
    C${cx + w * 0.12},${top + h * 0.06} ${cx + w * 0.4},${top + h * 0.12} ${cx + w * 0.65},${top + h * 0.22}
    C${cx + w * 0.85},${top + h * 0.35} ${cx + w * 0.95},${top + h * 0.5} ${cx + w},${top + h * 0.65}
    C${cx + w * 0.98},${top + h * 0.78} ${cx + w * 0.88},${top + h * 0.9} ${cx + w * 0.7},${top + h * 0.96}
    C${cx + w * 0.45},${top + h} ${cx + w * 0.15},${top + h * 0.99} ${cx - 4},${top + h * 0.96}
    C${cx - 5},${top + h * 0.7} ${cx - 5},${top + h * 0.45} ${cx - 4},${top + h * 0.2}
    C${cx - 2},${top + h * 0.08} ${cx},${top} ${cx},${top}Z`;
}

function leftFissure(exp: number): string {
  const w = 42 * exp; const h = 95 * exp;
  const cx = 70; const top = 60;
  return `M${cx - w * 0.05},${top + h * 0.28}
    C${cx - w * 0.3},${top + h * 0.5} ${cx - w * 0.55},${top + h * 0.7} ${cx - w * 0.75},${top + h * 0.88}`;
}

function rightObliqueFissure(exp: number): string {
  const w = 45 * exp; const h = 100 * exp;
  const cx = 130; const top = 56;
  return `M${cx + w * 0.08},${top + h * 0.22}
    C${cx + w * 0.35},${top + h * 0.48} ${cx + w * 0.55},${top + h * 0.68} ${cx + w * 0.78},${top + h * 0.88}`;
}

function rightHorizontalFissure(exp: number): string {
  const w = 45 * exp; const h = 100 * exp;
  const cx = 130; const top = 56;
  const y = top + h * 0.36;
  return `M${cx + w * 0.08},${y}
    C${cx + w * 0.25},${y - 2} ${cx + w * 0.5},${y + 1} ${cx + w * 0.72},${y - 1}`;
}

function getLungGradientId(pathology: string): string {
  switch (pathology) {
    case 'ards': return 'lg-ards';
    case 'bronchospasm': return 'lg-broncho';
    case 'obese': return 'lg-obese';
    case 'restrictive': return 'lg-restrictive';
    default: return 'lg-healthy';
  }
}

function ardsColor(recruitment: number, stop: number): string {
  const presets = [
    [[100, 75, 95], [220, 160, 160]],
    [[75, 55, 75], [200, 130, 135]],
    [[55, 40, 60], [175, 100, 110]],
    [[40, 28, 45], [150, 80, 90]],
  ];
  const [low, high] = presets[stop];
  const r = Math.round(low[0] + (high[0] - low[0]) * recruitment);
  const g = Math.round(low[1] + (high[1] - low[1]) * recruitment);
  const b = Math.round(low[2] + (high[2] - low[2]) * recruitment);
  return `rgb(${r},${g},${b})`;
}

interface AtelPatch {
  x: number; y: number; rx: number; ry: number;
  opacity: number; fill?: string; rotate?: number;
}

function getArdsPatches(recruitment: number, expansion: number): AtelPatch[] {
  const severity = 1 - recruitment;
  if (severity < 0.08) return [];
  const consol = 'url(#consol-grad)';
  const allPatches: AtelPatch[] = [
    { x: 46, y: 152, rx: 16 * expansion, ry: 8, opacity: severity * 0.85, fill: consol, rotate: -10 },
    { x: 38, y: 142, rx: 12 * expansion, ry: 7, opacity: severity * 0.75, fill: consol, rotate: -15 },
    { x: 56, y: 148, rx: 10 * expansion, ry: 5, opacity: severity * 0.7, fill: consol, rotate: 5 },
    { x: 150, y: 155, rx: 18 * expansion, ry: 9, opacity: severity * 0.88, fill: consol, rotate: 10 },
    { x: 160, y: 145, rx: 13 * expansion, ry: 7, opacity: severity * 0.78, fill: consol, rotate: 15 },
    { x: 138, y: 150, rx: 10 * expansion, ry: 5, opacity: severity * 0.65, fill: consol, rotate: -5 },
    { x: 42, y: 125, rx: 9 * expansion, ry: 5, opacity: severity > 0.3 ? (severity - 0.3) * 0.9 : 0, fill: consol, rotate: -8 },
    { x: 60, y: 118, rx: 7 * expansion, ry: 4, opacity: severity > 0.35 ? (severity - 0.35) * 0.8 : 0, fill: consol, rotate: 12 },
    { x: 50, y: 110, rx: 6 * expansion, ry: 3.5, opacity: severity > 0.4 ? (severity - 0.4) * 0.7 : 0, fill: consol, rotate: -20 },
    { x: 156, y: 120, rx: 10 * expansion, ry: 5, opacity: severity > 0.3 ? (severity - 0.3) * 0.85 : 0, fill: consol, rotate: 8 },
    { x: 136, y: 112, rx: 7 * expansion, ry: 4, opacity: severity > 0.35 ? (severity - 0.35) * 0.75 : 0, fill: consol, rotate: -12 },
    { x: 146, y: 105, rx: 5 * expansion, ry: 3, opacity: severity > 0.45 ? (severity - 0.45) * 0.7 : 0, fill: consol, rotate: 25 },
    { x: 46, y: 90, rx: 6 * expansion, ry: 3, opacity: severity > 0.6 ? (severity - 0.6) * 0.8 : 0, fill: consol, rotate: -15 },
    { x: 54, y: 82, rx: 5 * expansion, ry: 2.5, opacity: severity > 0.7 ? (severity - 0.7) * 0.7 : 0, fill: consol, rotate: 10 },
    { x: 153, y: 85, rx: 6 * expansion, ry: 3, opacity: severity > 0.6 ? (severity - 0.6) * 0.75 : 0, fill: consol, rotate: 18 },
    { x: 144, y: 78, rx: 5 * expansion, ry: 2.5, opacity: severity > 0.7 ? (severity - 0.7) * 0.65 : 0, fill: consol, rotate: -10 },
    { x: 34, y: 132, rx: 4 * expansion, ry: 2, opacity: severity > 0.25 ? severity * 0.4 : 0, fill: consol, rotate: 30 },
    { x: 64, y: 135, rx: 5 * expansion, ry: 2.5, opacity: severity > 0.3 ? severity * 0.35 : 0, fill: consol, rotate: -25 },
    { x: 163, y: 130, rx: 4 * expansion, ry: 2, opacity: severity > 0.25 ? severity * 0.4 : 0, fill: consol, rotate: -30 },
    { x: 130, y: 128, rx: 5 * expansion, ry: 2.5, opacity: severity > 0.3 ? severity * 0.35 : 0, fill: consol, rotate: 22 },
  ];
  return allPatches.filter(p => p.opacity > 0.04);
}

function getObeseBasalPatches(score: number, expansion: number): AtelPatch[] {
  if (score < 0.05) return [];
  const fill = 'url(#basal-atel)';
  return [
    { x: 46, y: 155, rx: 22 * expansion, ry: 10, opacity: score * 0.85, fill, rotate: -5 },
    { x: 42, y: 145, rx: 18 * expansion, ry: 7, opacity: score * 0.7, fill, rotate: -3 },
    { x: 50, y: 138, rx: 14 * expansion, ry: 5, opacity: score > 0.3 ? (score - 0.2) * 0.6 : 0, fill, rotate: -2 },
    { x: 148, y: 158, rx: 24 * expansion, ry: 11, opacity: score * 0.88, fill, rotate: 5 },
    { x: 152, y: 148, rx: 20 * expansion, ry: 8, opacity: score * 0.72, fill, rotate: 3 },
    { x: 144, y: 140, rx: 15 * expansion, ry: 5, opacity: score > 0.3 ? (score - 0.2) * 0.6 : 0, fill, rotate: 2 },
    { x: 54, y: 132, rx: 10 * expansion, ry: 4, opacity: score > 0.5 ? (score - 0.4) * 0.5 : 0, fill, rotate: -8 },
    { x: 140, y: 134, rx: 11 * expansion, ry: 4, opacity: score > 0.5 ? (score - 0.4) * 0.5 : 0, fill, rotate: 8 },
  ].filter(p => p.opacity > 0.04);
}
