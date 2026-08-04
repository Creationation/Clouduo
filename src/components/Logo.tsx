/**
 * Logo BubuCloud, en SVG et non en emoji: ☁️ n'a pas le même dessin d'une
 * plateforme à l'autre et rend mal sous Windows. Même tracé que favicon.svg,
 * donc l'icône de l'app, l'onglet du navigateur et l'écran de connexion
 * montrent exactement la même chose.
 */
export default function Logo({
  size = 64,
  className = '',
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
      role="img"
      aria-label="BubuCloud"
    >
      <defs>
        <linearGradient id="clouduo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7aa3ff" />
          <stop offset="55%" stopColor="#3b6ef6" />
          <stop offset="100%" stopColor="#2f5ae0" />
        </linearGradient>
        <linearGradient id="clouduo-sheen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.45" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#clouduo-bg)" />
      <rect width="512" height="512" rx="112" fill="url(#clouduo-sheen)" />
      <path
        d="M352 356H168a70 70 0 0 1-10-139 100 100 0 0 1 188-26 62 62 0 0 1 6 165z"
        fill="#ffffff"
      />
      <circle cx="214" cy="272" r="14" fill="#3b6ef6" opacity="0.5" />
      <circle cx="298" cy="272" r="14" fill="#3b6ef6" opacity="0.5" />
    </svg>
  )
}
