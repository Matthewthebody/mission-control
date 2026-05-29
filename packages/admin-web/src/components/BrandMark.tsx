type Props = {
  size?: "sm" | "lg";
};

export function BrandMark({ size = "sm" }: Props) {
  return (
    <div className={`brand-mark brand-mark--${size}`} aria-hidden="true">
      <svg viewBox="0 0 120 120" role="presentation">
        <defs>
          <linearGradient id="brandMarkBlue" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8cb3d9" />
            <stop offset="100%" stopColor="#2f5b8f" />
          </linearGradient>
          <linearGradient id="brandMarkWarm" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#d7b07a" />
            <stop offset="100%" stopColor="#b2864f" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r="50" fill="rgba(7, 21, 35, 0.86)" stroke="url(#brandMarkBlue)" strokeWidth="3" />
        <circle cx="60" cy="60" r="28" fill="none" stroke="rgba(214, 227, 240, 0.55)" strokeWidth="2" />
        <circle cx="60" cy="60" r="12" fill="url(#brandMarkBlue)" opacity="0.88" />
        <path d="M60 18 L79 43 L60 52 L41 43 Z" fill="#14314e" stroke="rgba(214, 227, 240, 0.18)" strokeWidth="1.5" />
        <path d="M102 60 L77 79 L68 60 L77 41 Z" fill="#173957" stroke="rgba(214, 227, 240, 0.18)" strokeWidth="1.5" />
        <path d="M60 102 L41 77 L60 68 L79 77 Z" fill="#12304c" stroke="rgba(214, 227, 240, 0.18)" strokeWidth="1.5" />
        <path d="M18 60 L43 41 L52 60 L43 79 Z" fill="#10273f" stroke="rgba(214, 227, 240, 0.18)" strokeWidth="1.5" />
        <circle cx="90" cy="88" r="6" fill="url(#brandMarkWarm)" />
        <circle cx="82" cy="78" r="4.2" fill="url(#brandMarkWarm)" />
        <circle cx="92" cy="74" r="4.2" fill="url(#brandMarkWarm)" />
        <circle cx="101" cy="80" r="4.2" fill="url(#brandMarkWarm)" />
      </svg>
    </div>
  );
}
