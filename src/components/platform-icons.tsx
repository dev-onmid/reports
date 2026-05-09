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

function PlatformLogo({ src, alt }: { src: string; alt: string }) {
  return (
    <span className="inline-flex h-full w-full items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="max-h-full max-w-full object-contain" />
    </span>
  );
}

function IconGoogle() {
  return (
    <PlatformLogo src="/brand/google-ads-logo.png" alt="Google Ads" />
  );
}

function IconMeta() {
  return (
    <PlatformLogo src="/brand/meta-ads-logo.webp" alt="Meta Ads" />
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
  const isBrandLogo = platform === 'google_ads' || platform === 'meta_ads';
  const dim = size === 'sm' ? 'w-6 h-6' : 'w-7 h-7';
  const logoDim = size === 'sm' ? 'w-8 h-6' : 'w-9 h-7';
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={`${isBrandLogo ? logoDim : dim} ${isBrandLogo ? 'rounded-md bg-transparent p-0.5' : 'rounded-full'} flex items-center justify-center transition-all hover:scale-110 hover:shadow-md active:scale-95 shadow-sm shrink-0`}
      style={isBrandLogo ? undefined : { backgroundColor: bg }}
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
