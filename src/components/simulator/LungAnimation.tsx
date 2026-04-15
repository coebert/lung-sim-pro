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

    // Bradycardia: weaken contraction force
    const bradyScale = vitals.hr < 50 ? Math.max(0.4, vitals.hr / 50) : 1;
    const tachyScale = vitals.hr > 100 ? 1 + (Math.min(vitals.hr, 180) - 100) / 200 : 1;
    const hrScale = bradyScale * tachyScale;

    return {
      atrial: atrialDist * hrScale,
      ventricular: ventricularPhase * hrScale,
    };
  }, [buffers.ecg, vitals.hr]);

  // Overall heart scale for the whole organ (ventricular dominant)
  const heartBeat = 1 + cardiacPhase.ventricular * 0.10;

  // Tachycardia visual intensity (0 = normal, 1 = severe tachy ≥150)
  const tachyIntensity = Math.max(0, Math.min(1, (vitals.hr - 100) / 60));

  // Bradycardia visual intensity (0 = normal, 1 = severe brady ≤30)
  const bradyIntensity = Math.max(0, Math.min(1, (50 - vitals.hr) / 20));

  // Bradycardia slows transitions and adds dusky colour shift
  const heartTransition = bradyIntensity > 0 ? `transform ${0.08 + bradyIntensity * 0.3}s ease-out` : 'transform 0.08s ease-out';
  const chamberTransitionSlow = bradyIntensity > 0 ? `transform ${0.06 + bradyIntensity * 0.2}s ease-out` : undefined;

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
              {/* Rib bone gradient */}
              <linearGradient id="rib-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#c0b8b0" />
                <stop offset="50%" stopColor="#a89888" />
                <stop offset="100%" stopColor="#908070" />
              </linearGradient>
            </defs>

            {/* ═══ RIB CAGE — behind all soft tissue ═══ */}
            <g opacity="0.18">
              {/* Sternum — central vertical bone */}
              <rect x="96" y="48" width="8" height="80" rx="3" fill="#a89888" opacity="0.3" />
              <line x1="100" y1="48" x2="100" y2="128" stroke="#b0a090" strokeWidth="0.4" opacity="0.25" />

              {/* Ribs 1-10 — curved arcs from sternum laterally */}
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
                  {/* Left rib arc */}
                  <path
                    d={`M97,${rib.y} Q${60},${rib.y + rib.curve} ${rib.lx},${rib.y + rib.curve * 0.6}`}
                    fill="none" stroke="url(#rib-grad)" strokeWidth="1.8" strokeLinecap="round"
                  />
                  {/* Right rib arc */}
                  <path
                    d={`M103,${rib.y} Q${140},${rib.y + rib.curve} ${rib.rx},${rib.y + rib.curve * 0.6}`}
                    fill="none" stroke="url(#rib-grad)" strokeWidth="1.8" strokeLinecap="round"
                  />
                </g>
              ))}

              {/* Costal cartilage — connects anterior ribs to sternum (slightly different tone) */}
              {[52, 62, 74, 86, 98, 110, 122].map((y, i) => (
                <g key={`cart-${i}`}>
                  <path d={`M97,${y} Q92,${y + 1} 88,${y + 2}`} fill="none" stroke="#b0a898" strokeWidth="1" opacity="0.4" />
                  <path d={`M103,${y} Q108,${y + 1} 112,${y + 2}`} fill="none" stroke="#b0a898" strokeWidth="1" opacity="0.4" />
                </g>
              ))}

              {/* Intercostal muscle markings — subtle lines between ribs */}
              {[57, 68, 80, 92, 104, 116, 128, 139, 149].map((y, i) => (
                <g key={`ic-${i}`} opacity="0.35">
                  {/* Left intercostal */}
                  <path
                    d={`M92,${y} Q${58},${y + 3} ${20 + i * 3},${y + 2}`}
                    fill="none" stroke="#786860" strokeWidth="0.3" strokeDasharray="3,2"
                  />
                  {/* Right intercostal */}
                  <path
                    d={`M108,${y} Q${142},${y + 3} ${180 - i * 3},${y + 2}`}
                    fill="none" stroke="#786860" strokeWidth="0.3" strokeDasharray="3,2"
                  />
                </g>
              ))}

              {/* Spine — posterior vertebral bodies (faintly visible) */}
              {[50, 60, 72, 84, 96, 108, 120, 132, 144].map((y, i) => (
                <rect key={`vert-${i}`} x="97" y={y} width="6" height="8" rx="1.5" fill="#908070" opacity="0.15" />
              ))}
            </g>

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
              d={`M100,50 C90,56 ${82 - (expansion - 1) * 3},61 ${75 - (expansion - 1) * 4},68`}
              fill="none" stroke="url(#aw-grad)" strokeWidth={airwayWidth} strokeLinecap="round"
            />
            {/* Right main — shorter, steeper (anatomical) */}
            <path
              d={`M100,50 C108,54 ${118 + (expansion - 1) * 3},57 ${125 + (expansion - 1) * 4},62`}
              fill="none" stroke="url(#aw-grad)" strokeWidth={airwayWidth} strokeLinecap="round"
            />

            {/* ═══ LEFT LOBAR BRONCHI ═══ */}
            {/* Upper lobe */}
            <path d={`M${75 - (expansion - 1) * 4},68 C67,72 59,70 ${53 - expansion * 1.5},74`} fill="none" stroke="#c09090" strokeWidth={subAirwayWidth} strokeLinecap="round" />
            {/* Lingula */}
            <path d={`M${75 - (expansion - 1) * 4},68 C69,78 63,86 ${59 - expansion},94`} fill="none" stroke="#c09090" strokeWidth={subAirwayWidth} strokeLinecap="round" />
            {/* Lower lobe */}
            <path d={`M${75 - (expansion - 1) * 4},68 C77,80 75,90 ${71},100`} fill="none" stroke="#c09090" strokeWidth={subAirwayWidth} strokeLinecap="round" />

            {/* ═══ RIGHT LOBAR BRONCHI ═══ */}
            {/* Upper lobe (eparterial) */}
            <path d={`M${120 + (expansion - 1) * 3},58 C128,56 138,54 ${144 + expansion},58`} fill="none" stroke="#c09090" strokeWidth={subAirwayWidth} strokeLinecap="round" />
            {/* Middle lobe */}
            <path d={`M${125 + (expansion - 1) * 4},62 C133,70 141,76 ${147 + expansion * 1.5},83`} fill="none" stroke="#c09090" strokeWidth={subAirwayWidth} strokeLinecap="round" />
            {/* Lower lobe */}
            <path d={`M${125 + (expansion - 1) * 4},62 C127,74 125,84 ${123},94`} fill="none" stroke="#c09090" strokeWidth={subAirwayWidth} strokeLinecap="round" />

            {/* ═══ SEGMENTAL AIRWAYS ═══ */}
            {/* Left upper segments */}
            <path d={`M${53 - expansion * 1.5},74 C47,78 41,84 ${37},90`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            <path d={`M${53 - expansion * 1.5},74 C51,82 45,88 ${43},96`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            {/* Left lingular segments */}
            <path d={`M${59 - expansion},94 C53,100 47,106 ${43},113`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            {/* Left lower segments */}
            <path d={`M${71},100 C67,108 61,116 ${57},124`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            <path d={`M${71},100 C75,110 73,120 ${69},128`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />

            {/* Right upper segments */}
            <path d={`M${144 + expansion},58 C150,62 156,66 ${160},72`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            <path d={`M${144 + expansion},58 C148,64 152,70 ${154},78`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            {/* Right middle segments */}
            <path d={`M${147 + expansion * 1.5},83 C153,88 159,94 ${163},100`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            {/* Right lower segments */}
            <path d={`M${123},94 C127,104 131,114 ${133},124`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />
            <path d={`M${123},94 C119,104 115,114 ${113},124`} fill="none" stroke="#b08080" strokeWidth={tertiaryWidth} strokeLinecap="round" opacity="0.5" />

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
            <path d="M98,52 C94,58 88,68 82,78" fill="none" stroke="#7a4060" strokeWidth="0.7" opacity="0.22" />
            <path d="M82,78 C74,88 62,102 50,118" fill="none" stroke="#7a4060" strokeWidth="0.5" opacity="0.18" />
            <path d="M82,78 C76,86 66,94 56,104" fill="none" stroke="#7a4060" strokeWidth="0.45" opacity="0.16" />
            <path d="M50,118 C44,126 38,136 34,146" fill="none" stroke="#7a4060" strokeWidth="0.35" opacity="0.12" />
            <path d="M56,104 C50,112 42,122 36,132" fill="none" stroke="#7a4060" strokeWidth="0.35" opacity="0.12" />
            {/* Left upper lobe arterioles */}
            <path d="M88,66 C80,62 70,64 62,70" fill="none" stroke="#7a4060" strokeWidth="0.35" opacity="0.14" />
            <path d="M62,70 C54,76 46,84 40,94" fill="none" stroke="#7a4060" strokeWidth="0.3" opacity="0.11" />
            <path d="M70,64 C62,58 54,60 46,66" fill="none" stroke="#7a4060" strokeWidth="0.25" opacity="0.10" />
            {/* Left lingular vessels */}
            <path d="M74,86 C64,94 56,106 50,116" fill="none" stroke="#7a4060" strokeWidth="0.3" opacity="0.12" />
            {/* Left pulmonary veins (slightly bluer) */}
            <path d="M92,70 C84,80 72,90 62,98" fill="none" stroke="#605080" strokeWidth="0.4" opacity="0.14" />
            <path d="M62,98 C52,108 44,120 38,134" fill="none" stroke="#605080" strokeWidth="0.3" opacity="0.11" />
            <path d="M78,76 C68,70 58,68 48,74" fill="none" stroke="#605080" strokeWidth="0.25" opacity="0.10" />

            {/* Right pulmonary artery branches */}
            <path d="M102,52 C106,58 114,66 122,74" fill="none" stroke="#7a4060" strokeWidth="0.7" opacity="0.22" />
            <path d="M122,74 C130,82 142,96 150,110" fill="none" stroke="#7a4060" strokeWidth="0.5" opacity="0.18" />
            <path d="M122,74 C128,82 136,92 144,102" fill="none" stroke="#7a4060" strokeWidth="0.45" opacity="0.16" />
            <path d="M150,110 C156,120 162,132 166,142" fill="none" stroke="#7a4060" strokeWidth="0.35" opacity="0.12" />
            <path d="M144,102 C150,112 158,124 164,134" fill="none" stroke="#7a4060" strokeWidth="0.35" opacity="0.12" />
            {/* Right upper lobe arterioles */}
            <path d="M114,60 C124,56 134,54 144,58" fill="none" stroke="#7a4060" strokeWidth="0.35" opacity="0.14" />
            <path d="M144,58 C152,62 160,70 166,80" fill="none" stroke="#7a4060" strokeWidth="0.3" opacity="0.11" />
            <path d="M130,54 C138,50 146,52 154,58" fill="none" stroke="#7a4060" strokeWidth="0.25" opacity="0.10" />
            {/* Right middle lobe vessels */}
            <path d="M134,80 C144,86 154,94 162,104" fill="none" stroke="#7a4060" strokeWidth="0.3" opacity="0.12" />
            {/* Right pulmonary veins */}
            <path d="M110,64 C120,74 132,84 142,92" fill="none" stroke="#605080" strokeWidth="0.4" opacity="0.14" />
            <path d="M142,92 C150,102 158,116 164,128" fill="none" stroke="#605080" strokeWidth="0.3" opacity="0.11" />
            <path d="M126,68 C136,64 146,62 156,66" fill="none" stroke="#605080" strokeWidth="0.25" opacity="0.10" />

            {/* Peripheral capillary blush — tiny scattered marks */}
            {/* Left lung */}
            <circle cx="44" cy="86" r="0.6" fill="#7a4060" opacity="0.08" />
            <circle cx="38" cy="108" r="0.5" fill="#7a4060" opacity="0.07" />
            <circle cx="52" cy="128" r="0.7" fill="#7a4060" opacity="0.06" />
            <circle cx="60" cy="114" r="0.5" fill="#7a4060" opacity="0.07" />
            <circle cx="48" cy="96" r="0.4" fill="#7a4060" opacity="0.08" />
            <circle cx="42" cy="122" r="0.6" fill="#7a4060" opacity="0.06" />
            {/* Right lung */}
            <circle cx="156" cy="84" r="0.6" fill="#7a4060" opacity="0.08" />
            <circle cx="164" cy="106" r="0.5" fill="#7a4060" opacity="0.07" />
            <circle cx="148" cy="124" r="0.7" fill="#7a4060" opacity="0.06" />
            <circle cx="140" cy="110" r="0.5" fill="#7a4060" opacity="0.07" />
            <circle cx="158" cy="94" r="0.4" fill="#7a4060" opacity="0.08" />
            <circle cx="162" cy="120" r="0.6" fill="#7a4060" opacity="0.06" />

            {/* ═══ HEART (mediastinal, between lungs) ═══ */}
            <g
              transform={`translate(${100 - 18 * heartCompression}, 72) scale(${heartCompression * heartBeat}, ${heartBeat})`}
              style={{ transformOrigin: '20px 35px', transition: heartTransition }}
              filter={tachyIntensity > 0.3 ? 'url(#tachy-glow)' : undefined}
              opacity={bradyIntensity > 0 ? 1 - bradyIntensity * 0.15 : 1}
            >
              {/* Tachycardia flush overlay — reddens the entire heart */}
              {tachyIntensity > 0 && (
                <path
                  d="M18,0 C8,5 2,20 4,38 C6,52 14,62 22,68 C28,72 34,70 38,64 C44,54 42,38 40,24 C38,12 30,-2 18,0Z"
                  fill={`rgba(255, ${Math.round(60 - tachyIntensity * 40)}, ${Math.round(40 - tachyIntensity * 30)}, ${tachyIntensity * 0.25})`}
                />
              )}
              {/* Bradycardia dusky overlay — cyanotic blue-purple */}
              {bradyIntensity > 0 && (
                <path
                  d="M18,0 C8,5 2,20 4,38 C6,52 14,62 22,68 C28,72 34,70 38,64 C44,54 42,38 40,24 C38,12 30,-2 18,0Z"
                  fill={`rgba(${Math.round(60 + bradyIntensity * 20)}, ${Math.round(40 + bradyIntensity * 30)}, ${Math.round(100 + bradyIntensity * 55)}, ${bradyIntensity * 0.35})`}
                />
              )}
              {/* Pericardium outline */}
              <path
                d="M18,0 C8,5 2,20 4,38 C6,52 14,62 22,68 C28,72 34,70 38,64 C44,54 42,38 40,24 C38,12 30,-2 18,0Z"
                fill="none" stroke={bradyIntensity > 0 ? `rgba(${100 - bradyIntensity * 20}, ${80 - bradyIntensity * 20}, ${100 + bradyIntensity * 40}, 0.5)` : '#a06060'} strokeWidth="0.6" opacity="0.4"
              />

              {/* ── Right atrium (posterior-right, darker/venous) ── */}
              <g transform={`scale(${1 + cardiacPhase.atrial * 0.08}, ${1 + cardiacPhase.atrial * 0.06})`} style={{ transformOrigin: '34px 30px', transition: chamberTransitionSlow || 'transform 0.06s ease-out' }}>
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
              <g transform={`scale(${1 + cardiacPhase.ventricular * 0.10}, ${1 + cardiacPhase.ventricular * 0.06})`} style={{ transformOrigin: '22px 38px', transition: chamberTransitionSlow || 'transform 0.05s ease-out' }}>
                <path
                  d="M18,18 C22,16 28,18 30,24 C32,32 30,44 26,52 C22,58 16,56 14,48 C12,38 14,26 18,18Z"
                  fill="url(#heart-myo)" opacity={0.75 + cardiacPhase.ventricular * 0.15} stroke="#802020" strokeWidth="0.5"
                />
              </g>

              {/* ── Left atrium (posterior-left) ── */}
              <g transform={`scale(${1 + cardiacPhase.atrial * 0.08}, ${1 + cardiacPhase.atrial * 0.06})`} style={{ transformOrigin: '10px 28px', transition: chamberTransitionSlow || 'transform 0.06s ease-out' }}>
                <path
                  d="M10,14 C6,18 4,26 6,34 C8,40 12,44 16,42 C14,34 12,24 10,14Z"
                  fill="url(#heart-la)" opacity={0.8 + cardiacPhase.atrial * 0.1} stroke="#802020" strokeWidth="0.4"
                />
              </g>
              {/* Pulmonary veins entering LA */}
              <path d="M4,20 C2,22 0,26 2,30" fill="none" stroke="#a04040" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
              <path d="M4,30 C2,34 0,38 2,42" fill="none" stroke="#a04040" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />

              {/* ── Left ventricle (dominant, thick-walled, forms apex) ── */}
              <g transform={`scale(${1 + cardiacPhase.ventricular * 0.12}, ${1 + cardiacPhase.ventricular * 0.08})`} style={{ transformOrigin: '15px 50px', transition: chamberTransitionSlow || 'transform 0.05s ease-out' }}>
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
                <circle cx="65" cy="71" r="2" fill="#e8c040" opacity="0.45" />
                <circle cx="133" cy="65" r="2" fill="#e8c040" opacity="0.45" />
                <circle cx="52" cy="88" r="1.5" fill="#e8c040" opacity="0.35" />
                <circle cx="150" cy="81" r="1.5" fill="#e8c040" opacity="0.35" />
                <ellipse cx="58" cy="80" rx="2.5" ry="1" fill="#c8a830" opacity="0.35" />
                <ellipse cx="143" cy="74" rx="2.5" ry="1" fill="#c8a830" opacity="0.35" />
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
  const cx = 70;
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
  const cx = 130;
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
    { x: 46, y: 152, rx: 16 * expansion, ry: 8, opacity: severity * 0.85, fill: consol, rotate: -10 },
    { x: 38, y: 142, rx: 12 * expansion, ry: 7, opacity: severity * 0.75, fill: consol, rotate: -15 },
    { x: 56, y: 148, rx: 10 * expansion, ry: 5, opacity: severity * 0.7, fill: consol, rotate: 5 },
    // Right lower lobe base (slightly worse — gravity dependent in supine)
    { x: 150, y: 155, rx: 18 * expansion, ry: 9, opacity: severity * 0.88, fill: consol, rotate: 10 },
    { x: 160, y: 145, rx: 13 * expansion, ry: 7, opacity: severity * 0.78, fill: consol, rotate: 15 },
    { x: 138, y: 150, rx: 10 * expansion, ry: 5, opacity: severity * 0.65, fill: consol, rotate: -5 },

    // ── MID-ZONES (patchy, scattered — characteristic of ARDS) ──
    // Left mid
    { x: 42, y: 125, rx: 9 * expansion, ry: 5, opacity: severity > 0.3 ? (severity - 0.3) * 0.9 : 0, fill: consol, rotate: -8 },
    { x: 60, y: 118, rx: 7 * expansion, ry: 4, opacity: severity > 0.35 ? (severity - 0.35) * 0.8 : 0, fill: consol, rotate: 12 },
    { x: 50, y: 110, rx: 6 * expansion, ry: 3.5, opacity: severity > 0.4 ? (severity - 0.4) * 0.7 : 0, fill: consol, rotate: -20 },
    // Right mid (heterogeneous scatter)
    { x: 156, y: 120, rx: 10 * expansion, ry: 5, opacity: severity > 0.3 ? (severity - 0.3) * 0.85 : 0, fill: consol, rotate: 8 },
    { x: 136, y: 112, rx: 7 * expansion, ry: 4, opacity: severity > 0.35 ? (severity - 0.35) * 0.75 : 0, fill: consol, rotate: -12 },
    { x: 146, y: 105, rx: 5 * expansion, ry: 3, opacity: severity > 0.45 ? (severity - 0.45) * 0.7 : 0, fill: consol, rotate: 25 },

    // ── NON-DEPENDENT / UPPER (only in severe ARDS) ──
    // Left upper
    { x: 46, y: 90, rx: 6 * expansion, ry: 3, opacity: severity > 0.6 ? (severity - 0.6) * 0.8 : 0, fill: consol, rotate: -15 },
    { x: 54, y: 82, rx: 5 * expansion, ry: 2.5, opacity: severity > 0.7 ? (severity - 0.7) * 0.7 : 0, fill: consol, rotate: 10 },
    // Right upper
    { x: 153, y: 85, rx: 6 * expansion, ry: 3, opacity: severity > 0.6 ? (severity - 0.6) * 0.75 : 0, fill: consol, rotate: 18 },
    { x: 144, y: 78, rx: 5 * expansion, ry: 2.5, opacity: severity > 0.7 ? (severity - 0.7) * 0.65 : 0, fill: consol, rotate: -10 },

    // ── SCATTERED MICRO-PATCHES (ARDS heterogeneity) ──
    { x: 34, y: 132, rx: 4 * expansion, ry: 2, opacity: severity > 0.25 ? severity * 0.4 : 0, fill: consol, rotate: 30 },
    { x: 64, y: 135, rx: 5 * expansion, ry: 2.5, opacity: severity > 0.3 ? severity * 0.35 : 0, fill: consol, rotate: -25 },
    { x: 163, y: 130, rx: 4 * expansion, ry: 2, opacity: severity > 0.25 ? severity * 0.4 : 0, fill: consol, rotate: -30 },
    { x: 130, y: 128, rx: 5 * expansion, ry: 2.5, opacity: severity > 0.3 ? severity * 0.35 : 0, fill: consol, rotate: 22 },
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
    { x: 46, y: 155, rx: 22 * expansion, ry: 10, opacity: score * 0.85, fill, rotate: -5 },
    { x: 42, y: 145, rx: 18 * expansion, ry: 7, opacity: score * 0.7, fill, rotate: -3 },
    { x: 50, y: 138, rx: 14 * expansion, ry: 5, opacity: score > 0.3 ? (score - 0.2) * 0.6 : 0, fill, rotate: -2 },

    // Right base — slightly larger (more diaphragmatic surface area)
    { x: 148, y: 158, rx: 24 * expansion, ry: 11, opacity: score * 0.88, fill, rotate: 5 },
    { x: 152, y: 148, rx: 20 * expansion, ry: 8, opacity: score * 0.72, fill, rotate: 3 },
    { x: 144, y: 140, rx: 15 * expansion, ry: 5, opacity: score > 0.3 ? (score - 0.2) * 0.6 : 0, fill, rotate: 2 },

    // ── POSTERIOR DEPENDENT STRIP (supine compression) ──
    { x: 54, y: 132, rx: 10 * expansion, ry: 4, opacity: score > 0.5 ? (score - 0.4) * 0.5 : 0, fill, rotate: -8 },
    { x: 140, y: 134, rx: 11 * expansion, ry: 4, opacity: score > 0.5 ? (score - 0.4) * 0.5 : 0, fill, rotate: 8 },
  ].filter(p => p.opacity > 0.04);
}
