"use client";

import { useEffect, useState } from 'react';

// Alinhado com o breakpoint `md` do Tailwind (768px): abaixo disso a sidebar
// desktop some e o app está em modo mobile. SSR-safe: começa como desktop e
// corrige no mount — evita hydration mismatch.
const MOBILE_QUERY = '(max-width: 767px)';

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  return isMobile;
}
