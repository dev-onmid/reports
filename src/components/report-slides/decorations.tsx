export function SlideDecorations({ variant = 'default' }: { variant?: 'default' | 'light' }) {
  void variant;
  return (
    <>
      {/* Purple swooping blob — top right */}
      <svg
        className="absolute top-0 right-0 pointer-events-none"
        width="420" height="420"
        viewBox="0 0 420 420"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M420 0 L420 420 L300 420 Q160 380 190 220 Q220 60 420 0Z"
          fill="#7B21D0"
          opacity="0.92"
        />
        <path
          d="M420 0 L420 200 Q370 80 420 0Z"
          fill="#6418B0"
          opacity="0.5"
        />
      </svg>

      {/* Green shape — bottom right */}
      <svg
        className="absolute bottom-0 right-0 pointer-events-none"
        width="280" height="200"
        viewBox="0 0 280 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect x="40" y="40" width="280" height="200" rx="40" fill="#44DD2E" />
      </svg>

      {/* Green diagonal strip — right middle */}
      <svg
        className="absolute pointer-events-none"
        style={{ top: '30%', right: 0 }}
        width="60" height="200"
        viewBox="0 0 60 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect x="10" y="-20" width="80" height="240" rx="12" fill="#44DD2E" transform="rotate(-15 40 100)" />
      </svg>

      {/* Crosshair + — top right area */}
      <svg
        className="absolute pointer-events-none"
        style={{ top: '6%', right: '26%' }}
        width="28" height="28"
        viewBox="0 0 28 28"
      >
        <line x1="14" y1="0" x2="14" y2="28" stroke="#7B21D0" strokeWidth="1.5" />
        <line x1="0" y1="14" x2="28" y2="14" stroke="#7B21D0" strokeWidth="1.5" />
      </svg>

      {/* Dot grid — top right corner inside purple */}
      <svg
        className="absolute pointer-events-none"
        style={{ top: '4%', right: '4%' }}
        width="80" height="60"
        viewBox="0 0 80 60"
      >
        {[0, 16, 32, 48, 64].flatMap((x) =>
          [0, 16, 32].map((y) => (
            <circle key={`${x}-${y}`} cx={x + 8} cy={y + 8} r="2" fill="white" opacity="0.5" />
          ))
        )}
      </svg>

      {/* Small decorative circle — bottom area */}
      <svg
        className="absolute pointer-events-none"
        style={{ bottom: '16%', right: '22%' }}
        width="32" height="32"
        viewBox="0 0 32 32"
      >
        <circle cx="16" cy="16" r="14" stroke="#7B21D0" strokeWidth="1.5" fill="none" />
      </svg>

      {/* Diagonal lines decoration — bottom left area */}
      <svg
        className="absolute pointer-events-none"
        style={{ bottom: '8%', left: '38%' }}
        width="70" height="40"
        viewBox="0 0 70 40"
      >
        {[0, 10, 20, 30, 40, 50, 60].map((x) => (
          <line key={x} x1={x} y1="40" x2={x + 10} y2="0" stroke="#7B21D0" strokeWidth="1" opacity="0.4" />
        ))}
      </svg>
    </>
  );
}

export function SlideBase({
  children,
  pageNumber,
  totalPages,
  bgClass = 'bg-white',
}: {
  children: React.ReactNode;
  pageNumber: number;
  totalPages: number;
  bgClass?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden ${bgClass}`}
      style={{ width: '100%', aspectRatio: '16/9' }}
    >
      <SlideDecorations />

      {/* onmid logo */}
      <div className="absolute top-5 left-6 flex items-center gap-2 z-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/onmid-favicon.svg" alt="onmid" className="h-5 w-auto" />
        <span className="font-black text-sm tracking-tight" style={{ color: '#1a1a1a' }}>onmid</span>
        <div
          className="w-8 h-4 rounded-full flex items-center justify-end pr-0.5"
          style={{ background: '#44DD2E' }}
        >
          <div className="w-3 h-3 rounded-full bg-white" />
        </div>
        <span className="text-[9px] font-bold align-top" style={{ color: '#1a1a1a' }}>®</span>
      </div>

      {/* Page number */}
      <div className="absolute bottom-4 left-6 z-10 flex items-center gap-1.5">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <rect x="1" y="1" width="16" height="16" rx="3" stroke="#7B21D0" strokeWidth="1.5" />
          <line x1="4" y1="6" x2="14" y2="6" stroke="#7B21D0" strokeWidth="1" />
          <line x1="4" y1="9" x2="14" y2="9" stroke="#7B21D0" strokeWidth="1" />
          <line x1="4" y1="12" x2="10" y2="12" stroke="#7B21D0" strokeWidth="1" />
        </svg>
        <span className="text-xs font-bold" style={{ color: '#7B21D0' }}>
          {String(pageNumber).padStart(2, '0')}
        </span>
        <span className="text-xs text-gray-400">/ {String(totalPages).padStart(2, '0')}</span>
      </div>

      {/* Slide content */}
      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
}
