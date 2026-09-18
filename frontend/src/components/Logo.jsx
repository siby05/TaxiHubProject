// TaxiHub "road badge" mark - a road receding to the horizon inside a
// rounded badge. Kept as inline SVG (not an <img>) so it stays crisp at
// every size and can be recoloured for print. Mirrors public/favicon.svg;
// change both together.
export function LogoBadge({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <rect width="64" height="64" rx="16" fill="#F2C53D" />
      <circle cx="32" cy="19" r="5.5" fill="#151C24" />
      <path d="M29 28h6l5 23H24z" fill="#151C24" />
      <rect x="31" y="31" width="2" height="3.5" fill="#F2C53D" />
      <rect x="30.8" y="38" width="2.4" height="4" fill="#F2C53D" />
      <rect x="30.6" y="45.5" width="2.8" height="4.5" fill="#F2C53D" />
    </svg>
  );
}

export default function Logo({ size = 32, tagline = false, color }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.34 }}>
      <LogoBadge size={size} />
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
        <span style={{ fontWeight: 800, letterSpacing: size * 0.02, fontSize: size * 0.62, color }}>TAXIHUB</span>
        {tagline && (
          <span style={{ fontWeight: 600, letterSpacing: size * 0.09, fontSize: size * 0.25, marginTop: size * 0.14, opacity: 0.65, color }}>
            TAXI HIRE · 24/7
          </span>
        )}
      </span>
    </span>
  );
}
