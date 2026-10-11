import { useEffect } from 'react';
import { simulationStore } from '@/lib/simulation/simulationStore';
import { patients } from '@/lib/simulation/patients';

interface Options {
  onToggleTutorial: () => void;
}

/**
 * Global keyboard shortcuts:
 *   Space    – freeze/unfreeze waveforms
 *   P        – toggle prone
 *   T        – toggle tutorial
 *   1 … 6    – select patient
 * Ignored while the user is typing in an input/textarea/select or contenteditable.
 */
export function useGlobalShortcuts({ onToggleTutorial }: Options) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
        // Let focused buttons, links, menus and dialogs keep their own keys (Space activates buttons).
        if (target.closest('button, a, [role="button"], [role="menu"], [role="menuitem"], [role="dialog"], [role="listbox"], [role="slider"]')) return;
      }

      switch (e.key) {
        case ' ':
        case 'Spacebar':
          e.preventDefault();
          simulationStore.toggleFrozen();
          break;
        case 'p':
        case 'P':
          simulationStore.toggleProne();
          break;
        case 't':
        case 'T':
          onToggleTutorial();
          break;
        default: {
          const n = Number(e.key);
          if (Number.isInteger(n) && n >= 1 && n <= patients.length) {
            simulationStore.setPatient(patients[n - 1]);
          }
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onToggleTutorial]);
}
