import { useState, useEffect } from 'react';

export type LayoutMode = 'desktop' | 'mobile-portrait' | 'mobile-landscape';

/**
 * Determines layout mode based on viewport dimensions.
 * Mobile landscape: width > height AND height < 500px (phone rotated)
 * Mobile portrait: width < 768px AND not mobile-landscape
 * Desktop: everything else (tablets in landscape, actual desktops)
 */
export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(() => {
    if (typeof window === 'undefined') return 'desktop';
    return computeMode(window.innerWidth, window.innerHeight);
  });

  useEffect(() => {
    const update = () => {
      setMode(computeMode(window.innerWidth, window.innerHeight));
    };
    window.addEventListener('resize', update);
    const mql = window.matchMedia('(orientation: landscape)');
    mql.addEventListener('change', update);
    return () => {
      window.removeEventListener('resize', update);
      mql.removeEventListener('change', update);
    };
  }, []);

  return mode;
}

function computeMode(w: number, h: number): LayoutMode {
  // Phone in landscape: wide but very short
  if (w > h && h < 500) return 'mobile-landscape';
  // Phone in portrait: narrow
  if (w < 768) return 'mobile-portrait';
  // Everything else: desktop/tablet
  return 'desktop';
}
