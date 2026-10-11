import { useEffect, useRef, useState } from 'react';
import { Alarm, AlarmSeverity, startAlarmSound, stopAlarmSound } from '@/lib/simulation/alarms';
import { AlertTriangle, Volume2, VolumeX } from 'lucide-react';

interface AlarmBannerProps {
  alarms: Alarm[];
}

export function AlarmBanner({ alarms }: AlarmBannerProps) {
  const activeAlarms = alarms.filter(a => a.active);
  const [muted, setMuted] = useState(false);
  const [flash, setFlash] = useState(false);
  const prevActiveRef = useRef(false);

  const hasActive = activeAlarms.length > 0;
  const highestSeverity: AlarmSeverity | null = hasActive
    ? activeAlarms.some(a => a.severity === 'high') ? 'high' : 'medium'
    : null;

  // Flash animation
  useEffect(() => {
    if (!hasActive) { setFlash(false); return; }
    const id = setInterval(() => setFlash(f => !f), 500);
    return () => clearInterval(id);
  }, [hasActive]);

  // Audio
  useEffect(() => {
    if (hasActive && !muted && highestSeverity) {
      startAlarmSound(highestSeverity);
    } else {
      stopAlarmSound();
    }
    return () => stopAlarmSound();
  }, [hasActive, muted, highestSeverity]);

  // Re-sound when a NEW alarm appears or severity escalates; silence lasts max 2 min.
  const activeKey = activeAlarms.map(a => a.id).sort().join('|');
  const prevIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ids = new Set(activeKey ? activeKey.split('|') : []);
    const hasNew = [...ids].some(id => !prevIdsRef.current.has(id));
    if (hasNew) setMuted(false);
    prevIdsRef.current = ids;
    prevActiveRef.current = hasActive;
  }, [activeKey, hasActive]);
  useEffect(() => {
    if (!muted) return;
    const id = window.setTimeout(() => setMuted(false), 120_000);
    return () => clearTimeout(id);
  }, [muted]);

  if (!hasActive) return null;

  const bgColor = highestSeverity === 'high'
    ? (flash ? 'bg-destructive' : 'bg-destructive/70')
    : (flash ? 'bg-yellow-600' : 'bg-yellow-700');

  return (
    <div className={`${bgColor} text-white px-3 py-1 flex items-center gap-2 shrink-0 transition-colors duration-200`}>
      <span className="text-xs font-bold tracking-wider uppercase animate-pulse flex items-center gap-1">
        <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
        Alarm
      </span>
      <span className="flex-1 text-xs truncate">
        {activeAlarms.map(a => a.label).join(' | ')}
      </span>
      <button
        onClick={() => setMuted(m => !m)}
        className="p-1 rounded hover:bg-white/20 transition-colors"
        title={muted ? 'Unmute alarms' : 'Silence alarms'}
      >
        {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}
