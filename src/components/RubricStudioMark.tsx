export function RubricStudioMark({
  size = 32,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="rubric-mark-bg" cx="50%" cy="45%" r="62%">
          <stop offset="0%" stopColor="#f9fff8" />
          <stop offset="62%" stopColor="#c8f7e4" />
          <stop offset="100%" stopColor="#0d2e35" />
        </radialGradient>
        <linearGradient id="rubric-mark-rule" x1="12" y1="14" x2="52" y2="50" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#34d9ff" />
          <stop offset="56%" stopColor="#18d6a3" />
          <stop offset="100%" stopColor="#f7c948" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="#071519" />
      <circle cx="32" cy="32" r="24" fill="url(#rubric-mark-bg)" opacity="0.98" />
      <path
        d="M21 21.5h22M21 31.5h22M21 41.5h22M21 21.5v20M32 21.5v20M43 21.5v20"
        fill="none"
        stroke="#082226"
        strokeOpacity="0.62"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M21 41.5c6.2-1.2 9.9-4.1 12.7-8.8 2.2-3.8 5.2-7.6 10.6-10.1"
        fill="none"
        stroke="url(#rubric-mark-rule)"
        strokeWidth="4.4"
        strokeLinecap="round"
      />
      <circle cx="21" cy="41.5" r="2.9" fill="#34d9ff" />
      <circle cx="34" cy="32" r="3.15" fill="#18d6a3" />
      <circle cx="44.5" cy="22.2" r="3" fill="#f7c948" />
    </svg>
  );
}
