"use client";

export type PlatformId =
  | 'google_ads'
  | 'meta_ads'
  | 'facebook'
  | 'instagram'
  | 'google_business'
  | 'google_sheets';

export const PLATFORM_INFO: Record<PlatformId, { label: string; bg: string }> = {
  google_ads:      { label: 'Google Ads',            bg: '#4285F4' },
  meta_ads:        { label: 'Meta Ads',               bg: '#0B84FF' },
  facebook:        { label: 'Facebook Insights',      bg: '#1877F2' },
  instagram:       { label: 'Instagram Insights',     bg: '#C13584' },
  google_business: { label: 'Google Meu Negócio',     bg: '#EA4335' },
  google_sheets:   { label: 'Google Sheets',          bg: '#0F9D58' },
};

function IconGoogle() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="w-3.5 h-3.5">
      <path fill="white" d="M17.6 10.2c0-.6-.1-1.1-.2-1.7H10v3.2h4.3c-.2 1-.8 1.8-1.7 2.4v2h2.7c1.6-1.5 2.3-3.6 2.3-5.9z"/>
      <path fill="white" d="M10 18c2.2 0 4-.7 5.3-2L12.6 14c-.7.5-1.6.8-2.6.8-2 0-3.7-1.3-4.3-3.2H3v2.1C4.3 16.5 7 18 10 18z"/>
      <path fill="white" d="M5.7 11.6c-.2-.5-.2-1-.2-1.6s.1-1.1.2-1.6V6.3H3C2.4 7.4 2 8.7 2 10s.4 2.6 1 3.7l2.7-2.1z"/>
      <path fill="white" d="M10 5.2c1.1 0 2.1.4 2.9 1.1l2.1-2.1C13.7 3 12 2.2 10 2.2 7 2.2 4.3 3.7 3 6.3l2.7 2.1C6.3 6.6 8 5.2 10 5.2z"/>
    </svg>
  );
}

function IconMeta() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="w-3.5 h-3.5">
      <path
        d="M2.5 12.5C2.5 9.5 4 7 6 7c1.3 0 2.4 1.1 4 3.8C11.6 8.1 12.7 7 14 7c2 0 3.5 2.5 3.5 5.5"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconFacebook() {
  return (
    <svg viewBox="0 0 20 20" className="w-3.5 h-3.5">
      <path
        d="M11 5H9.5C8.7 5 8 5.7 8 6.5V8H6v2.5h2V17h3v-6.5h2.5L14 8h-3V6.5c0-.3.2-.5.5-.5H14V5h-3z"
        fill="white"
      />
    </svg>
  );
}

function IconInstagram() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="w-3.5 h-3.5">
      <rect x="3" y="3" width="14" height="14" rx="4" stroke="white" strokeWidth="1.6" />
      <circle cx="10" cy="10" r="2.8" stroke="white" strokeWidth="1.4" />
      <circle cx="14.5" cy="5.5" r="0.9" fill="white" />
    </svg>
  );
}

function IconGoogleBusiness() {
  return (
    <svg viewBox="0 0 20 20" className="w-3.5 h-3.5">
      <path
        d="M10 2C7.24 2 5 4.24 5 7c0 4.25 5 11 5 11s5-6.75 5-11c0-2.76-2.24-5-5-5zm0 7.5c-1.38 0-2.5-1.12-2.5-2.5S8.62 4.5 10 4.5s2.5 1.12 2.5 2.5S11.38 9.5 10 9.5z"
        fill="white"
      />
    </svg>
  );
}

function IconSheets() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="w-3.5 h-3.5">
      <rect x="3" y="3" width="14" height="14" rx="2" stroke="white" strokeWidth="1.5" />
      <line x1="3" y1="7.5" x2="17" y2="7.5" stroke="white" strokeWidth="1" />
      <line x1="3" y1="12" x2="17" y2="12" stroke="white" strokeWidth="1" />
      <line x1="8" y1="3" x2="8" y2="17" stroke="white" strokeWidth="1" />
      <line x1="12.5" y1="3" x2="12.5" y2="17" stroke="white" strokeWidth="1" />
    </svg>
  );
}

const ICONS: Record<PlatformId, React.ReactNode> = {
  google_ads:      <IconGoogle />,
  meta_ads:        <IconMeta />,
  facebook:        <IconFacebook />,
  instagram:       <IconInstagram />,
  google_business: <IconGoogleBusiness />,
  google_sheets:   <IconSheets />,
};

export function PlatformIconButton({
  platform,
  size = 'md',
  onClick,
}: {
  platform: PlatformId;
  size?: 'sm' | 'md';
  onClick: (e: React.MouseEvent) => void;
}) {
  const { label, bg } = PLATFORM_INFO[platform];
  const dim = size === 'sm' ? 'w-6 h-6' : 'w-7 h-7';
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={`${dim} rounded-full flex items-center justify-center transition-all hover:scale-110 hover:shadow-md active:scale-95 shadow-sm shrink-0`}
      style={{ backgroundColor: bg }}
    >
      {ICONS[platform]}
    </button>
  );
}

export const ALL_PLATFORMS: PlatformId[] = [
  'google_ads',
  'meta_ads',
  'facebook',
  'instagram',
  'google_business',
  'google_sheets',
];
