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

  // ARDS recruitment score
  const ardsRecruitment = useMemo(() => {
    if (pathology !== 'ards') return 1;
    const peepScore = Math.min(settings.peep / patient.optimalPEEP, 1.2);
    const fio2Score = Math.min(settings.fio2 / patient.optimalFiO2, 1);
    return Math.max(0.15, Math.min(1, peepScore * 0.7 + fio2Score * 0.3));
  }, [pathology, settings.peep, settings.fio2, patient.optimalPEEP, patient.optimalFiO2]);

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

  // Heart compression from hyperinflation (1 = normal, <1 = compressed)
  const heartCompression = pathology === 'bronchospasm'
    ? Math.max(0.55, 1 - (hyperinflation - 1) * 0.6)
    : 1;

  // Cardiac cycle phases from ECG buffer
  // We track the ECG signal to derive atrial vs ventricular contraction timing
  const cardiacPhase = useMemo(() => {
    const ecg = buffers.ecg;
    if (!ecg || ecg.length < 30) return { atrial: 0, ventricular: 0 };

    // Look at the last ~30 samples to find the cardiac cycle phase
    const window = ecg.slice(-30);
    const max = Math.max(...window);
    const min = Math.min(...window);
    const range = max - min || 1;

    // Normalise the recent window
    const norm = window.map(v => (v - min) / range);

    // Find the R-wave peak position (highest value in recent window)
    let rPeakIdx = 0;
    let rPeakVal = 0;
    for (let i = 0; i < norm.length; i++) {
      if (norm[i] > rPeakVal) { rPeakVal = norm[i]; rPeakIdx = i; }
    }

    // Current position relative to R-peak
    const distFromPeak = norm.length - 1 - rPeakIdx;

    // Atrial systole: P-wave occurs ~6-10 samples before R-peak
    // Peaks when we're ~8 samples before R, decays quickly
    const atrialDist = Math.abs(distFromPeak - 0) < 3 ? 0 : // near R-peak, atria relaxed
      distFromPeak >= 5 && distFromPeak <= 12 ? // P-wave zone
        Math.exp(-Math.pow((distFromPeak - 8) / 2.5, 2)) : 0;

    // Ventricular systole: QRS/early systole, peaks at R-wave, sustained briefly
    const ventricularPhase = distFromPeak <= 6 ?
      Math.exp(-Math.pow(distFromPeak / 3, 2)) : 0;

    const tachyScale = vitals.hr > 100 ? 1 + (Math.min(vitals.hr, 180) - 100) / 200 : 1;

    return {
      atrial: atrialDist * tachyScale,
      ventricular: ventricularPhase * tachyScale,
    };
  }, [buffers.ecg, vitals.hr]);

  // Overall heart scale for the whole organ (ventricular dominant)
  const heartBeat = 1 + cardiacPhase.ventricular * 0.10;

  // Tachycardia visual intensity (0 = normal, 1 = severe tachy ≥150)
  const tachyIntensity = Math.max(0, Math.min(1, (vitals.hr - 100) / 60));

  const lungFill = getLungGradientId(pathology);
  const lungOpacity = pathology === 'ards' ? 0.5 + ardsRecruitment * 0.45 : 0.92;
  const airwayWidth = pathology === 'bronchospasm' ? 2.2 : 3.5;
  const subAirwayWidth = airwayWidth * 0.55;
  const tertiaryWidth = airwayWidth * 0.3;

  // Collect all atelectasis/consolidation patches
  const atelPatches = pathology === 'ards'
    ? getArdsPatches(ardsRecruitment, expansion)
    : pathology === 'obese'
    ? getObeseBasalPatches(obeseAtelScore, expansion)
    : [];

  // Status text
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
              {/* Healthy: pink parenchyma with subtle vascularity */}
              <radialGradient id="lg-healthy" cx="50%" cy="35%" r="65%">
                <stop offset="0%" stopColor="#e8a8a8" />
                <stop offset="30%" stopColor="#d48088" />
                <stop offset="65%" stopColor="#c06068" />
                <stop offset="100%" stopColor="#984858" />
              </radialGradient>

              {/* ARDS: hepatised grey-purple, pinker when recruited */}
              <radialGradient id="lg-ards" cx="50%" cy="35%" r="65%">
                <stop offset="0%" stopColor={ardsColor(ardsRecruitment, 0)} />
                <stop offset="40%" stopColor={ardsColor(ardsRecruitment, 1)} />
                <stop offset="80%" stopColor={ardsColor(ardsRecruitment, 2)} />
                <stop offset="100%" stopColor={ardsColor(ardsRecruitment, 3)} />
              </radialGradient>

              {/* Bronchospasm: increasingly reddened/hyperaemic */}
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

              {/* Obese: slightly dusky pink, reduced volume */}
              <radialGradient id="lg-obese" cx="50%" cy="30%" r="65%">
                <stop offset="0%" stopColor="#d49898" />
                <stop offset="40%" stopColor="#b87878" />
                <stop offset="80%" stopColor="#a06565" />
                <stop offset="100%" stopColor="#885555" />
              </radialGradient>

              {/* Restrictive: pale fibrotic */}
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

              {/* ARDS consolidation fill — dark purple-grey */}
              <radialGradient id="consol-grad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#4a3050" />
                <stop offset="100%" stopColor="#2a1828" />
              </radialGradient>

              {/* Obesity basal atelectasis — grey-brown compression */}
              <radialGradient id="basal-atel" cx="50%" cy="30%" r="60%">
                <stop offset="0%" stopColor="#6a5048" />
                <stop offset="100%" stopColor="#3a2820" />
              </radialGradient>

              {/* ── Heart gradients ── */}
              {/* Myocardium */}
              <radialGradient id="heart-myo" cx="45%" cy="35%" r="60%">
                <stop offset="0%" stopColor="#c84848" />
                <stop offset="35%" stopColor="#a83838" />
                <stop offset="70%" stopColor="#882828" />
                <stop offset="100%" stopColor="#682020" />
              </radialGradient>
              {/* Right atrium / venous */}
              <radialGradient id="heart-ra" cx="50%" cy="40%" r="55%">
                <stop offset="0%" stopColor="#7848a0" />
                <stop offset="100%" stopColor="#583078" />
              </radialGradient>
              {/* Left atrium / arterial */}
              <radialGradient id="heart-la" cx="50%" cy="40%" r="55%">
                <stop offset="0%" stopColor="#c04040" />
                <stop offset="100%" stopColor="#982828" />
              </radialGradient>
              {/* Aorta */}
              <linearGradient id="aorta-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#d04848" />
                <stop offset="100%" stopColor="#a03030" />
              </linearGradient>
              {/* Great vessels */}
              <linearGradient id="vein-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6848a0" />
                <stop offset="100%" stopColor="#483878" />
              </linearGradient>
              {/* Epicardial highlight */}
              <radialGradient id="heart-sheen" cx="35%" cy="25%" r="65%">
                <stop offset="0%" stopColor="rgba(255,200,200,0.2)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0)" />
              </radialGradient>
              {/* tissue texture removed — was causing fog */}
              {/* Tachycardia glow */}
              <filter id="tachy-glow">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* ═══ TRACHEA ═══ */}
            <rect x="93" y="6" width="14" height="44" rx="6" fill="url(#aw-grad)" stroke="#a07070" strokeWidth="0.8" />
            {/* C-shaped cartilage rings */}
            {[12, 18, 24, 30, 36, 42].map(y => (
              <path key={y} d={`M93.5,${y} Q100,${y - 2} 106.5,${y}`} fill="none" stroke="#c49898" strokeWidth="1.1" opacity="0.55" />
            ))}
            {/* Posterior membrane (membranous part) */}
            <line x1="106.5" y1="8" x2="106.5" y2="48" stroke="#b08888" strokeWidth="0.4" opacity="0.4" />
            {/* Tracheal lumen */}
            <rect x="96" y="8" width="8" height="40" rx="3" fill="#1a0a12" opacity="0.35" />

            {/* ═══ CARINA ═══ */}
            <ellipse cx="100" cy="50" rx="5" ry="3" fill="#b08080" />
            <ellipse cx="100" cy="50" rx="3" ry="1.5" fill="#1a0a12" opacity="0.25" />

            {/* ═══ MAIN BRONCHI ═══ */}
            {/* Left main — longer, more horizontal (anatomical) */}
            <path
              d={`M100,50 C86,57 ${70 - (expansion - 1) * 4},62 ${60 - (expansion - 1) * 5},70`}
              fill="none" stroke="url(#aw-grad)" strokeWidth={airwayWidth} strokeLinecap="round"
            />
            {/* Right main — shorter, steeper (anatomical) */}
            <path
              d={`M100,50 C110,54 ${126 + (expansion - 1) * 4},57 ${138 + (expansion - 1) * 5},64`}
              fill="none" stroke="url(#aw-grad)" strokeWidth={airwayWidth} strokeLinecap="round"
            />

            {/* ═══ LEFT LOBAR BRONCHI ═══ */}
            {/* Upper lobe */}
            <path d={`M${60 - (expansion - 1) * 5},70 C52,74 44,72 ${38 - expansion * 1.5},76`} fill="none" stroke="#c09090" strokeWidth={subAirwayWidth} strokeLinecap="round" />
            {/* Lingula */}
            <path d={`M${60 - (expansion - 1) * 5},70 C54,80 48,88 ${44 - expansion},96`} fill="none" stroke="#c09090" strokeWidth={subAirwayWidth} strokeLinecap="round" />
            {/* Lower lobe */}
            <path d={`M${60 - (expansion - 1) * 5},70 C62,82 60,92 ${56},102`} fill="none" stroke="#c09090" strokeWidth={subAirwayWidth} strokeLinecap="round" />

            {/* ═══ RIGHT LOBAR BRONCHI ═══ */}
            {/* Upper lobe (eparterial) */}
            <path d={`M${132 + (expansion - 1) * 3},60 C140,58 150,56 ${156 + expansion},60`} fill="none" stroke="#c09090" strokeWidth={subAirwayWidth} strokeLinecap="round" />
            {/* Middle lobe */}
            <path d={`M${138 + (expansion - 1) * 5},64 C146,72 154,78 ${160 + expansion * 1.5},85`} fill="none" stroke="#c09090" strokeWidth={subAirwayWidth} strokeLinecap="round" />
            {/* Lower lobe */}
            <path d={`M${138 + (expansion - 1) * 5},64 C140,76 138,86 ${136},96`} fill="none" stroke="#c09090" strokeWidth={subAirwayWidth} strokeLinecap="round" />

            {/* ═══ SEGMENTAL AIRWAYS ═══ */}
            {/* Left upper segments */}
            <path d={`M${38 - expansion * 1.5},76 C32,80 26,86 ${22},92`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            <path d={`M${38 - expansion * 1.5},76 C36,84 30,90 ${28},98`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            {/* Left lingular segments */}
            <path d={`M${44 - expansion},96 C38,102 32,108 ${28},115`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            {/* Left lower segments */}
            <path d={`M${56},102 C52,110 46,118 ${42},126`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            <path d={`M${56},102 C60,112 58,122 ${54},130`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />

            {/* Right upper segments */}
            <path d={`M${156 + expansion},60 C162,64 168,68 ${172},74`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            <path d={`M${156 + expansion},60 C160,66 164,72 ${166},80`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            {/* Right middle segments */}
            <path d={`M${160 + expansion * 1.5},85 C166,90 172,96 ${176},102`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            {/* Right lower segments */}
            <path d={`M${136},96 C140,106 144,116 ${146},126`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            <path d={`M${136},96 C132,106 128,116 ${126},126`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />

            {/* ═══ LEFT LUNG PARENCHYMA ═══ */}
            <path
              d={leftLungPath(expansion)}
              fill={`url(#${lungFill})`}
              opacity={lungOpacity}
              stroke="#8a5560"
              strokeWidth="1.2"
              
            />
            <path d={leftLungPath(expansion)} fill="url(#pl-l)" opacity="0.45" />

            {/* Left oblique fissure */}
            <path d={leftFissure(expansion)} fill="none" stroke="#7a4a55" strokeWidth="0.7" strokeDasharray="4,2" opacity="0.45" />

            {/* ═══ RIGHT LUNG PARENCHYMA ═══ */}
            <path
              d={rightLungPath(expansion)}
              fill={`url(#${lungFill})`}
              opacity={lungOpacity}
              stroke="#8a5560"
              strokeWidth="1.2"
              
            />
            <path d={rightLungPath(expansion)} fill="url(#pl-r)" opacity="0.45" />

            {/* Right oblique fissure */}
            <path d={rightObliqueFissure(expansion)} fill="none" stroke="#7a4a55" strokeWidth="0.7" strokeDasharray="4,2" opacity="0.45" />
            {/* Right horizontal fissure */}
            <path d={rightHorizontalFissure(expansion)} fill="none" stroke="#7a4a55" strokeWidth="0.7" strokeDasharray="4,2" opacity="0.45" />

            {/* ═══ PULMONARY VASCULATURE — detailed vascular tree ═══ */}
            {/* Left pulmonary artery branches */}
            <path d="M98,52 C92,60 84,70 76,80" fill="none" stroke="#7a4060" strokeWidth="0.7" opacity="0.22" />
            <path d="M76,80 C68,90 56,104 44,120" fill="none" stroke="#7a4060" strokeWidth="0.5" opacity="0.18" />
            <path d="M76,80 C70,88 60,96 50,106" fill="none" stroke="#7a4060" strokeWidth="0.45" opacity="0.16" />
            <path d="M44,120 C38,128 32,138 28,148" fill="none" stroke="#7a4060" strokeWidth="0.35" opacity="0.12" />
            <path d="M50,106 C44,114 36,124 30,134" fill="none" stroke="#7a4060" strokeWidth="0.35" opacity="0.12" />
            {/* Left upper lobe arterioles */}
            <path d="M82,68 C74,64 64,66 56,72" fill="none" stroke="#7a4060" strokeWidth="0.35" opacity="0.14" />
            <path d="M56,72 C48,78 40,86 34,96" fill="none" stroke="#7a4060" strokeWidth="0.3" opacity="0.11" />
            <path d="M64,66 C56,60 48,62 40,68" fill="none" stroke="#7a4060" strokeWidth="0.25" opacity="0.10" />
            {/* Left lingular vessels */}
            <path d="M68,88 C58,96 50,108 44,118" fill="none" stroke="#7a4060" strokeWidth="0.3" opacity="0.12" />
            {/* Left pulmonary veins (slightly bluer) */}
            <path d="M86,72 C78,82 66,92 56,100" fill="none" stroke="#605080" strokeWidth="0.4" opacity="0.14" />
            <path d="M56,100 C46,110 38,122 32,136" fill="none" stroke="#605080" strokeWidth="0.3" opacity="0.11" />
            <path d="M72,78 C62,72 52,70 42,76" fill="none" stroke="#605080" strokeWidth="0.25" opacity="0.10" />

            {/* Right pulmonary artery branches */}
            <path d="M102,52 C108,58 118,66 128,74" fill="none" stroke="#7a4060" strokeWidth="0.7" opacity="0.22" />
            <path d="M128,74 C136,82 148,96 156,110" fill="none" stroke="#7a4060" strokeWidth="0.5" opacity="0.18" />
            <path d="M128,74 C134,82 142,92 150,102" fill="none" stroke="#7a4060" strokeWidth="0.45" opacity="0.16" />
            <path d="M156,110 C162,120 168,132 172,142" fill="none" stroke="#7a4060" strokeWidth="0.35" opacity="0.12" />
            <path d="M150,102 C156,112 164,124 170,134" fill="none" stroke="#7a4060" strokeWidth="0.35" opacity="0.12" />
            {/* Right upper lobe arterioles */}
            <path d="M120,62 C130,58 140,56 150,60" fill="none" stroke="#7a4060" strokeWidth="0.35" opacity="0.14" />
            <path d="M150,60 C158,64 166,72 172,82" fill="none" stroke="#7a4060" strokeWidth="0.3" opacity="0.11" />
            <path d="M136,56 C144,52 152,54 160,60" fill="none" stroke="#7a4060" strokeWidth="0.25" opacity="0.10" />
            {/* Right middle lobe vessels */}
            <path d="M140,82 C150,88 160,96 168,106" fill="none" stroke="#7a4060" strokeWidth="0.3" opacity="0.12" />
            {/* Right pulmonary veins */}
            <path d="M116,66 C126,76 138,86 148,94" fill="none" stroke="#605080" strokeWidth="0.4" opacity="0.14" />
            <path d="M148,94 C156,104 164,118 170,130" fill="none" stroke="#605080" strokeWidth="0.3" opacity="0.11" />
            <path d="M132,70 C142,66 152,64 162,68" fill="none" stroke="#605080" strokeWidth="0.25" opacity="0.10" />

            {/* Peripheral capillary blush — tiny scattered marks */}
            {/* Left lung */}
            <circle cx="38" cy="88" r="0.6" fill="#7a4060" opacity="0.08" />
            <circle cx="32" cy="110" r="0.5" fill="#7a4060" opacity="0.07" />
            <circle cx="46" cy="130" r="0.7" fill="#7a4060" opacity="0.06" />
            <circle cx="54" cy="116" r="0.5" fill="#7a4060" opacity="0.07" />
            <circle cx="42" cy="98" r="0.4" fill="#7a4060" opacity="0.08" />
            <circle cx="36" cy="124" r="0.6" fill="#7a4060" opacity="0.06" />
            {/* Right lung */}
            <circle cx="162" cy="86" r="0.6" fill="#7a4060" opacity="0.08" />
            <circle cx="170" cy="108" r="0.5" fill="#7a4060" opacity="0.07" />
            <circle cx="154" cy="126" r="0.7" fill="#7a4060" opacity="0.06" />
            <circle cx="146" cy="112" r="0.5" fill="#7a4060" opacity="0.07" />
            <circle cx="164" cy="96" r="0.4" fill="#7a4060" opacity="0.08" />
            <circle cx="168" cy="122" r="0.6" fill="#7a4060" opacity="0.06" />

            {/* ═══ HEART (mediastinal, between lungs) ═══ */}
            <g
              transform={`translate(${100 - 18 * heartCompression}, 72) scale(${heartCompression * heartBeat}, ${heartBeat})`}
              style={{ transformOrigin: '20px 35px', transition: 'transform 0.08s ease-out' }}
              filter={tachyIntensity > 0.3 ? 'url(#tachy-glow)' : undefined}
              opacity={1}
            >
              {/* Tachycardia flush overlay — reddens the entire heart */}
              {tachyIntensity > 0 && (
                <path
                  d="M18,0 C8,5 2,20 4,38 C6,52 14,62 22,68 C28,72 34,70 38,64 C44,54 42,38 40,24 C38,12 30,-2 18,0Z"
                  fill={`rgba(255, ${Math.round(60 - tachyIntensity * 40)}, ${Math.round(40 - tachyIntensity * 30)}, ${tachyIntensity * 0.25})`}
                />
              )}
              {/* Pericardium outline */}
              <path
                d="M18,0 C8,5 2,20 4,38 C6,52 14,62 22,68 C28,72 34,70 38,64 C44,54 42,38 40,24 C38,12 30,-2 18,0Z"
                fill="none" stroke="#a06060" strokeWidth="0.6" opacity="0.4"
              />

              {/* ── Right atrium (posterior-right, darker/venous) ── */}
              <g transform={`scale(${1 + cardiacPhase.atrial * 0.08}, ${1 + cardiacPhase.atrial * 0.06})`} style={{ transformOrigin: '34px 30px', transition: 'transform 0.06s ease-out' }}>
                <path
                  d="M30,12 C36,16 40,24 39,34 C38,42 34,48 28,50 C26,42 28,28 30,12Z"
                  fill="url(#heart-ra)" opacity={0.85 + cardiacPhase.atrial * 0.1} stroke="#5a2868" strokeWidth="0.5"
                />
              </g>
              {/* SVC entering RA */}
              <path d="M34,4 C36,8 36,12 34,16" fill="none" stroke="url(#vein-grad)" strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
              {/* IVC entering RA */}
              <path d="M35,50 C37,54 37,58 36,62" fill="none" stroke="url(#vein-grad)" strokeWidth="2.5" strokeLinecap="round" opacity="0.6" />

              {/* ── Right ventricle (anterior, facing sternum) ── */}
              <g transform={`scale(${1 + cardiacPhase.ventricular * 0.10}, ${1 + cardiacPhase.ventricular * 0.06})`} style={{ transformOrigin: '22px 38px', transition: 'transform 0.05s ease-out' }}>
                <path
                  d="M18,18 C22,16 28,18 30,24 C32,32 30,44 26,52 C22,58 16,56 14,48 C12,38 14,26 18,18Z"
                  fill="url(#heart-myo)" opacity={0.75 + cardiacPhase.ventricular * 0.15} stroke="#802020" strokeWidth="0.5"
                />
              </g>

              {/* ── Left atrium (posterior-left) ── */}
              <g transform={`scale(${1 + cardiacPhase.atrial * 0.08}, ${1 + cardiacPhase.atrial * 0.06})`} style={{ transformOrigin: '10px 28px', transition: 'transform 0.06s ease-out' }}>
                <path
                  d="M10,14 C6,18 4,26 6,34 C8,40 12,44 16,42 C14,34 12,24 10,14Z"
                  fill="url(#heart-la)" opacity={0.8 + cardiacPhase.atrial * 0.1} stroke="#802020" strokeWidth="0.4"
                />
              </g>
              {/* Pulmonary veins entering LA */}
              <path d="M4,20 C2,22 0,26 2,30" fill="none" stroke="#a04040" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
              <path d="M4,30 C2,34 0,38 2,42" fill="none" stroke="#a04040" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />

              {/* ── Left ventricle (dominant, thick-walled, forms apex) ── */}
              <g transform={`scale(${1 + cardiacPhase.ventricular * 0.12}, ${1 + cardiacPhase.ventricular * 0.08})`} style={{ transformOrigin: '15px 50px', transition: 'transform 0.05s ease-out' }}>
                <path
                  d="M8,30 C4,36 2,46 6,56 C10,64 18,70 24,66 C28,62 26,52 24,44 C22,38 16,32 8,30Z"
                  fill="url(#heart-myo)" opacity={0.9 + cardiacPhase.ventricular * 0.1} stroke="#802020" strokeWidth="0.6"
                />
              </g>
              {/* LV wall thickness indicator — septal line */}
              <path d="M16,28 C18,38 20,50 18,60" fill="none" stroke="#601818" strokeWidth="0.5" opacity="0.4" />

              {/* ── Interventricular septum ── */}
              <path d="M18,20 C20,30 22,44 20,56" fill="none" stroke="#6a2020" strokeWidth="0.8" opacity="0.35" />

              {/* ── Aortic arch ── */}
              <path d="M16,8 C14,2 16,-4 22,-6 C28,-6 34,-2 32,6" fill="none" stroke="url(#aorta-grad)" strokeWidth="3" strokeLinecap="round" opacity="0.8" />
              {/* Ascending aorta */}
              <path d="M18,18 C17,14 16,10 16,8" fill="none" stroke="url(#aorta-grad)" strokeWidth="2.8" strokeLinecap="round" opacity="0.75" />
              {/* Arch branches (brachiocephalic, L carotid, L subclavian) */}
              <path d="M24,-5 C26,-10 28,-14" fill="none" stroke="#c04040" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
              <path d="M22,-6 C22,-12 22,-16" fill="none" stroke="#c04040" strokeWidth="1" strokeLinecap="round" opacity="0.45" />
              <path d="M20,-5 C18,-10 16,-14" fill="none" stroke="#c04040" strokeWidth="1" strokeLinecap="round" opacity="0.45" />
              {/* Descending aorta */}
              <path d="M32,6 C34,16 34,30 32,44" fill="none" stroke="url(#aorta-grad)" strokeWidth="2.2" strokeLinecap="round" opacity="0.6" />

              {/* ── Pulmonary trunk ── */}
              <path d="M20,14 C18,8 14,4 10,6 C6,8 4,14 6,18" fill="none" stroke="#7050a0" strokeWidth="2.2" strokeLinecap="round" opacity="0.65" />
              {/* PA bifurcation */}
              <path d="M10,6 C6,2 2,2 0,6" fill="none" stroke="#7050a0" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
              <path d="M10,6 C14,2 18,0 20,2" fill="none" stroke="#7050a0" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />

              {/* ── Epicardial surface sheen ── */}
              <path
                d="M8,30 C4,36 2,46 6,56 C10,64 18,70 24,66 C28,62 26,52 24,44 C22,38 16,32 8,30Z"
                fill="url(#heart-sheen)" opacity="0.6"
              />

              {/* ── Coronary arteries ── */}
              {/* LAD */}
              <path d="M16,16 C14,24 12,34 14,48" fill="none" stroke="#d05050" strokeWidth="0.6" opacity="0.4" strokeDasharray="2,1" />
              {/* RCA */}
              <path d="M24,14 C28,20 30,30 28,42" fill="none" stroke="#d05050" strokeWidth="0.6" opacity="0.35" strokeDasharray="2,1" />
              {/* Circumflex */}
              <path d="M14,18 C8,24 6,32 8,42" fill="none" stroke="#d05050" strokeWidth="0.5" opacity="0.3" strokeDasharray="2,1" />

              {/* ── Apex indicator ── */}
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

            {/* ═══ ATELECTASIS / CONSOLIDATION PATCHES ═══ */}
            {atelPatches.map((p, i) => (
              <ellipse
                key={i} cx={p.x} cy={p.y}
                rx={p.rx} ry={p.ry}
                fill={p.fill || 'url(#consol-grad)'}
                opacity={p.opacity}
                transform={p.rotate ? `rotate(${p.rotate} ${p.x} ${p.y})` : undefined}
              />
            ))}

            {/* ═══ BRONCHOSPASM: airway inflammation ═══ */}
            {pathology === 'bronchospasm' && (
              <>
                <circle cx="53" cy="73" r="2" fill="#e8c040" opacity="0.45" />
                <circle cx="145" cy="67" r="2" fill="#e8c040" opacity="0.45" />
                <circle cx="40" cy="90" r="1.5" fill="#e8c040" opacity="0.35" />
                <circle cx="162" cy="83" r="1.5" fill="#e8c040" opacity="0.35" />
                <ellipse cx="46" cy="82" rx="2.5" ry="1" fill="#c8a830" opacity="0.35" />
                <ellipse cx="155" cy="76" rx="2.5" ry="1" fill="#c8a830" opacity="0.35" />
              </>
            )}

            {/* ═══ DIAPHRAGM (for obesity context) ═══ */}
            {pathology === 'obese' && (
              <path
                d={`M10,${158 - obeseAtelScore * 12} Q60,${170 - obeseAtelScore * 18} 100,${162 - obeseAtelScore * 15} Q140,${170 - obeseAtelScore * 18} 190,${158 - obeseAtelScore * 12}`}
                fill="none" stroke="#a08060" strokeWidth="1.5" strokeDasharray="5,3" opacity="0.5"
              />
            )}

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

/* ── Lung outline paths with anatomical detail ── */

function leftLungPath(exp: number): string {
  const w = 42 * exp;
  const h = 95 * exp;
  const cx = 58;
  const top = 60;
  // Left lung: narrower apex, lateral convexity, flat base, cardiac notch on medial surface
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
  const cx = 142;
  const top = 56;
  // Right lung: larger, 3 lobes, no cardiac notch, straighter medial border
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
  const cx = 58; const top = 60;
  return `M${cx - w * 0.05},${top + h * 0.28}
    C${cx - w * 0.3},${top + h * 0.5} ${cx - w * 0.55},${top + h * 0.7} ${cx - w * 0.75},${top + h * 0.88}`;
}

function rightObliqueFissure(exp: number): string {
  const w = 45 * exp; const h = 100 * exp;
  const cx = 142; const top = 56;
  return `M${cx + w * 0.08},${top + h * 0.22}
    C${cx + w * 0.35},${top + h * 0.48} ${cx + w * 0.55},${top + h * 0.68} ${cx + w * 0.78},${top + h * 0.88}`;
}

function rightHorizontalFissure(exp: number): string {
  const w = 45 * exp; const h = 100 * exp;
  const cx = 142; const top = 56;
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

/* ── ARDS colour helper ── */
function ardsColor(recruitment: number, stop: number): string {
  // 4 gradient stops: centre → edge
  // Low recruitment = grey-purple hepatised; high = pink aerated
  const presets = [
    // [r0, g0, b0] at recruitment=0, [r1, g1, b1] at recruitment=1
    [[100, 75, 95], [220, 160, 160]],   // stop 0 centre
    [[75, 55, 75], [200, 130, 135]],     // stop 1
    [[55, 40, 60], [175, 100, 110]],     // stop 2
    [[40, 28, 45], [150, 80, 90]],       // stop 3 edge
  ];
  const [low, high] = presets[stop];
  const r = Math.round(low[0] + (high[0] - low[0]) * recruitment);
  const g = Math.round(low[1] + (high[1] - low[1]) * recruitment);
  const b = Math.round(low[2] + (high[2] - low[2]) * recruitment);
  return `rgb(${r},${g},${b})`;
}

/* ── ARDS patchy atelectasis ── */
// In ARDS, atelectasis is characteristically PATCHY and heterogeneous:
// - Dependent regions (posterior/basal) affected first and worst
// - Non-dependent areas may remain aerated ("baby lung")
// - Scattered patches of consolidation interspersed with aerated lung
// - Recruitment improves dependent zones first (PEEP opens collapsed alveoli)

interface AtelPatch {
  x: number; y: number; rx: number; ry: number;
  opacity: number; fill?: string; rotate?: number;
}

function getArdsPatches(recruitment: number, expansion: number): AtelPatch[] {
  const severity = 1 - recruitment;
  if (severity < 0.08) return [];

  const consol = 'url(#consol-grad)';

  // Patches organised by zone: dependent (basal) → mid → non-dependent (apical)
  const allPatches: AtelPatch[] = [
    // ── DEPENDENT / BASAL (always affected first in ARDS) ──
    // Left lower lobe base
    { x: 34, y: 152, rx: 16 * expansion, ry: 8, opacity: severity * 0.85, fill: consol, rotate: -10 },
    { x: 26, y: 142, rx: 12 * expansion, ry: 7, opacity: severity * 0.75, fill: consol, rotate: -15 },
    { x: 44, y: 148, rx: 10 * expansion, ry: 5, opacity: severity * 0.7, fill: consol, rotate: 5 },
    // Right lower lobe base (slightly worse — gravity dependent in supine)
    { x: 162, y: 155, rx: 18 * expansion, ry: 9, opacity: severity * 0.88, fill: consol, rotate: 10 },
    { x: 172, y: 145, rx: 13 * expansion, ry: 7, opacity: severity * 0.78, fill: consol, rotate: 15 },
    { x: 150, y: 150, rx: 10 * expansion, ry: 5, opacity: severity * 0.65, fill: consol, rotate: -5 },

    // ── MID-ZONES (patchy, scattered — characteristic of ARDS) ──
    // Left mid
    { x: 30, y: 125, rx: 9 * expansion, ry: 5, opacity: severity > 0.3 ? (severity - 0.3) * 0.9 : 0, fill: consol, rotate: -8 },
    { x: 48, y: 118, rx: 7 * expansion, ry: 4, opacity: severity > 0.35 ? (severity - 0.35) * 0.8 : 0, fill: consol, rotate: 12 },
    { x: 38, y: 110, rx: 6 * expansion, ry: 3.5, opacity: severity > 0.4 ? (severity - 0.4) * 0.7 : 0, fill: consol, rotate: -20 },
    // Right mid (heterogeneous scatter)
    { x: 168, y: 120, rx: 10 * expansion, ry: 5, opacity: severity > 0.3 ? (severity - 0.3) * 0.85 : 0, fill: consol, rotate: 8 },
    { x: 148, y: 112, rx: 7 * expansion, ry: 4, opacity: severity > 0.35 ? (severity - 0.35) * 0.75 : 0, fill: consol, rotate: -12 },
    { x: 158, y: 105, rx: 5 * expansion, ry: 3, opacity: severity > 0.45 ? (severity - 0.45) * 0.7 : 0, fill: consol, rotate: 25 },

    // ── NON-DEPENDENT / UPPER (only in severe ARDS) ──
    // Left upper
    { x: 34, y: 90, rx: 6 * expansion, ry: 3, opacity: severity > 0.6 ? (severity - 0.6) * 0.8 : 0, fill: consol, rotate: -15 },
    { x: 42, y: 82, rx: 5 * expansion, ry: 2.5, opacity: severity > 0.7 ? (severity - 0.7) * 0.7 : 0, fill: consol, rotate: 10 },
    // Right upper
    { x: 165, y: 85, rx: 6 * expansion, ry: 3, opacity: severity > 0.6 ? (severity - 0.6) * 0.75 : 0, fill: consol, rotate: 18 },
    { x: 156, y: 78, rx: 5 * expansion, ry: 2.5, opacity: severity > 0.7 ? (severity - 0.7) * 0.65 : 0, fill: consol, rotate: -10 },

    // ── SCATTERED MICRO-PATCHES (ARDS heterogeneity) ──
    { x: 22, y: 132, rx: 4 * expansion, ry: 2, opacity: severity > 0.25 ? severity * 0.4 : 0, fill: consol, rotate: 30 },
    { x: 52, y: 135, rx: 5 * expansion, ry: 2.5, opacity: severity > 0.3 ? severity * 0.35 : 0, fill: consol, rotate: -25 },
    { x: 175, y: 130, rx: 4 * expansion, ry: 2, opacity: severity > 0.25 ? severity * 0.4 : 0, fill: consol, rotate: -30 },
    { x: 142, y: 128, rx: 5 * expansion, ry: 2.5, opacity: severity > 0.3 ? severity * 0.35 : 0, fill: consol, rotate: 22 },
  ];

  return allPatches.filter(p => p.opacity > 0.04);
}

/* ── Obesity basal atelectasis ── */
// In morbid obesity, atelectasis is PREDOMINANTLY BASAL:
// - Caused by diaphragmatic splinting from abdominal pressure
// - Bilateral but more uniform than ARDS (not patchy)
// - Worst at the very bases, forming crescentic bands
// - Usually improves with adequate PEEP (re-expands compressed lung)
// - Upper lobes remain well-aerated

function getObeseBasalPatches(score: number, expansion: number): AtelPatch[] {
  if (score < 0.05) return [];
  const fill = 'url(#basal-atel)';

  return [
    // ── CRESCENTIC BASAL BANDS — bilateral, confluent ──
    // Left base — broad crescentic atelectasis
    { x: 34, y: 155, rx: 22 * expansion, ry: 10, opacity: score * 0.85, fill, rotate: -5 },
    { x: 30, y: 145, rx: 18 * expansion, ry: 7, opacity: score * 0.7, fill, rotate: -3 },
    { x: 38, y: 138, rx: 14 * expansion, ry: 5, opacity: score > 0.3 ? (score - 0.2) * 0.6 : 0, fill, rotate: -2 },

    // Right base — slightly larger (more diaphragmatic surface area)
    { x: 160, y: 158, rx: 24 * expansion, ry: 11, opacity: score * 0.88, fill, rotate: 5 },
    { x: 164, y: 148, rx: 20 * expansion, ry: 8, opacity: score * 0.72, fill, rotate: 3 },
    { x: 156, y: 140, rx: 15 * expansion, ry: 5, opacity: score > 0.3 ? (score - 0.2) * 0.6 : 0, fill, rotate: 2 },

    // ── POSTERIOR DEPENDENT STRIP (supine compression) ──
    { x: 42, y: 132, rx: 10 * expansion, ry: 4, opacity: score > 0.5 ? (score - 0.4) * 0.5 : 0, fill, rotate: -8 },
    { x: 152, y: 134, rx: 11 * expansion, ry: 4, opacity: score > 0.5 ? (score - 0.4) * 0.5 : 0, fill, rotate: 8 },
  ].filter(p => p.opacity > 0.04);
}
