"use client";

import { usePathname } from 'next/navigation';

export function MainWrapper({
  children,
  mobileNavButton,
}: {
  children: React.ReactNode;
  mobileNavButton?: React.ReactNode;
}) {
  const pathname = usePathname();
  const isDashboard = pathname === '/dashboard';

  return (
    // overflow-hidden here so pages that use h-full internally (e.g. CRM chat)
    // are bounded by the viewport. Pages with long content scroll via the inner div.
    <main className={isDashboard
      ? 'min-w-0 flex-1 overflow-hidden flex flex-col px-3 pb-3 pt-3 sm:px-6 sm:pb-6 sm:pt-6'
      : 'min-w-0 flex-1 overflow-hidden flex flex-col p-3 sm:p-6'
    }>
      {isDashboard && mobileNavButton ? (
        <div className="mb-3 flex h-10 items-center justify-between md:hidden">
          {mobileNavButton}
          <img src="/brand/onmid-logo-white.png" alt="Onmid" className="h-7 w-auto object-contain" />
        </div>
      ) : null}
      {/* flex-1 + overflow-y-auto: this div is the actual scroll container.
          h-full children of the page can now resolve against this div's height. */}
      <div className="flex-1 min-h-0 w-full min-w-0 max-w-full overflow-y-auto">
        {children}
      </div>
    </main>
  );
}
