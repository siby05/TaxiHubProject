import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Public pages listed in sitemap.xml - keep in step with PAGES in
// src/components/RouteMeta.jsx (the indexable ones).
const SITEMAP_PATHS = ['/', '/about', '/register', '/login', '/terms'];

// Search-engine files and absolute-URL tags that need the site's real
// domain, which only the deployment knows: set VITE_SITE_URL (e.g.
// https://easyride.co.nz) in Vercel. Without it the build still works,
// just without canonical/og:url/og:image, the JSON-LD url and a sitemap.
function seo(siteUrl) {
  const site = (siteUrl || '').replace(/\/$/, '');
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TaxiService',
    name: 'EasyRide',
    description: 'Local taxi service in New Plymouth with upfront fares, vetted drivers, airport transfers and long-distance trips (pre-book 12 hours ahead).',
    areaServed: [
      { '@type': 'City', name: 'New Plymouth' },
      { '@type': 'AdministrativeArea', name: 'Taranaki' },
    ],
    provider: {
      '@type': 'LocalBusiness',
      name: 'Easy Ride NZ',
      email: 'easyridenz@gmail.com',
      address: { '@type': 'PostalAddress', addressLocality: 'New Plymouth', addressRegion: 'Taranaki', addressCountry: 'NZ' },
      ...(site && { url: `${site}/`, image: `${site}/images/byd-atto3.png` }),
    },
    ...(site && { url: `${site}/` }),
  };

  return {
    name: 'easyride-seo',
    transformIndexHtml() {
      const tags = [{ tag: 'script', attrs: { type: 'application/ld+json' }, children: JSON.stringify(jsonLd), injectTo: 'head' }];
      if (site) {
        tags.push(
          { tag: 'link', attrs: { rel: 'canonical', href: `${site}/` }, injectTo: 'head' },
          { tag: 'meta', attrs: { property: 'og:url', content: `${site}/` }, injectTo: 'head' },
          { tag: 'meta', attrs: { property: 'og:image', content: `${site}/images/byd-atto3.png` }, injectTo: 'head' },
        );
      }
      return tags;
    },
    generateBundle() {
      const robots = [
        'User-agent: *',
        'Allow: /',
        'Disallow: /passenger',
        'Disallow: /driver$',
        'Disallow: /driver/',
        'Disallow: /admin',
        'Disallow: /pay/',
        'Disallow: /book/',
        'Disallow: /reset-password/',
        ...(site ? ['', `Sitemap: ${site}/sitemap.xml`] : []),
      ].join('\n');
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `${robots}\n` });
      if (site) {
        const urls = SITEMAP_PATHS.map((p) => `  <url><loc>${site}${p}</loc><changefreq>${p === '/' ? 'weekly' : 'monthly'}</changefreq><priority>${p === '/' ? '1.0' : '0.6'}</priority></url>`).join('\n');
        this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n` });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), seo(env.VITE_SITE_URL)],
    server: { port: 5173 },
  };
});
