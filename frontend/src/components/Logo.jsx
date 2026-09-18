// EasyRide brand mark - a chevron-in-a-badge icon plus a two-tone "Easy
// Ride" wordmark. See "Easy Ride Logo.pdf" (style reference: primary
// #0EA5E9, accent #38BDF8 for dark backgrounds, ink #0B2942, Sora
// ExtraBold for the wordmark). Kept as inline SVG (not an <img>) so it
// stays crisp at every size. Mirrors public/favicon.svg; change both
// together. Pass `dark` when placed on a dark surface (e.g. the navbar) -
// swaps the badge to the lighter accent blue and "Easy" to white so it
// doesn't sit flat against a dark background.
export function LogoBadge({ size = 32, dark = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <rect width="64" height="64" rx="15" fill={dark ? '#38BDF8' : '#0EA5E9'} />
      <path d="M25 17 L40 32 L25 47" fill="none" stroke="#FFFFFF" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="18" y="48" width="26" height="5" rx="2.5" fill="#FFFFFF" fillOpacity="0.55" />
    </svg>
  );
}

const FONT_STACK = "'Sora', system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

export default function Logo({ size = 32, tagline = false, dark = false, gap }) {
  const easyColor = dark ? '#FFFFFF' : '#0B2942';
  const rideColor = dark ? '#38BDF8' : '#0EA5E9';
  const taglineColor = '#64748B';

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: gap ?? size * 0.34 }}>
      <LogoBadge size={size} dark={dark} />
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
        <span style={{ fontFamily: FONT_STACK, fontWeight: 800, fontSize: size * 0.62 }}>
          <span style={{ color: easyColor }}>Easy</span> <span style={{ color: rideColor }}>Ride</span>
        </span>
        {tagline && (
          <span style={{ fontWeight: 600, letterSpacing: size * 0.06, fontSize: size * 0.22, marginTop: size * 0.14, color: taglineColor }}>
            PREMIUM TRANSPORT · NEW ZEALAND
          </span>
        )}
      </span>
    </span>
  );
}
