// EasyRide brand mark - a single raster image (public/logo.png, also used
// as the favicon/PWA icon - see index.html and manifest.json) rather than
// the previous inline SVG badge + separately-styled wordmark, since the
// image already bakes the chevron badge and "Easy Ride" wordmark together
// into one circular mark. `size` controls the rendered footprint; the old
// `dark` recolor prop is gone - the image carries its own fixed navy/cyan/
// white palette, which reads fine on both light and dark surfaces (that
// was the whole point of the old light/dark swap in the first place).
export function LogoBadge({ size = 32 }) {
  return (
    <img
      src="/logo.png"
      width={size}
      height={size}
      alt="EasyRide"
      style={{ display: 'block', flexShrink: 0, borderRadius: '50%', objectFit: 'cover' }}
    />
  );
}

export default function Logo({ size = 32, tagline = false, gap }) {
  // The wordmark lives inside the image's lower portion now, not rendered
  // as separate text - scale the image up enough that the baked-in text
  // stays legible (empirically ~2.6x the old icon-only `size`, which
  // matched the previous combined badge+text row's height).
  const markSize = Math.round(size * 2.6);

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: gap ?? size * 0.2 }}>
      <LogoBadge size={markSize} />
      {tagline && (
        <span style={{ fontWeight: 600, letterSpacing: size * 0.06, fontSize: size * 0.22, color: '#64748B' }}>
          PREMIUM TRANSPORT · NEW PLYMOUTH, NZ
        </span>
      )}
    </span>
  );
}
