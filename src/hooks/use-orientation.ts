import { useState, useEffect } from 'react';

export function useIsLandscape() {
  const [isLandscape, setIsLandscape] = useState(
    () => typeof window !== 'undefined' && window.innerWidth > window.innerHeight
  );

  useEffect(() => {
    const check = () => setIsLandscape(window.innerWidth > window.innerHeight);
    const mql = window.matchMedia('(orientation: landscape)');
    mql.addEventListener('change', check);
    window.addEventListener('resize', check);
    return () => {
      mql.removeEventListener('change', check);
      window.removeEventListener('resize', check);
    };
  }, []);

  return isLandscape;
}
