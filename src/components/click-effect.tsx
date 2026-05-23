'use client';
import { useEffect } from 'react';

const INTERACTIVE = 'a, button, [role="button"], label, .cursor-pointer, input[type="checkbox"], input[type="radio"], select';

export function ClickEffect() {
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = (e.target as Element).closest(INTERACTIVE);
      if (!target) return;
      target.classList.remove('neon-clicked');
      void (target as HTMLElement).offsetWidth; // força reinício da animação
      target.classList.add('neon-clicked');
      target.addEventListener(
        'animationend',
        () => target.classList.remove('neon-clicked'),
        { once: true },
      );
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);
  return null;
}
