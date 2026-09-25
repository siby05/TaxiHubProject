import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { PAGES, DEFAULT_META, siteUrlFrom, structuredData } from './src/seo/site.js';

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// JSON inside <script> - only "<" needs escaping (stops a "</script>" in text closing the tag early).
const jsonLdTags = (site, pathname) => structuredData(site, pathname)
  .map((block) => `<script type="application/ld+json">${JSON.stringify(block).replace(/</g, '\u003c')}</script>`)
  .join('\n    ');

// Rewrites the built index.html's page-specific head tags and crawler
// fallback text for one public page. The markers it matches are the ones
// index.html and transformIndexHtml below put there.
function renderPage(html, site, pathname, page) {
  const url = `${site}${pathname === '/' ? '/' : pathname}`;
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.description);
  return html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${description}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${description}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
    .replace(/<!-- seo:jsonld -->[\s\S]*?<!-- \/seo:jsonld -->/, `<!-- seo:jsonld -->\n    ${jsonLdTags(site, pathname)}\n    <!-- /seo:jsonld -->`)
    .replace(/<noscript>[\s\S]*?<\/noscript>/, `<noscript>\n      <h1>${escapeHtml(page.heading || page.title)}</h1>\n      <p>${escapeHtml(page.summary || page.description)}</p>\n      <p>Please enable JavaScript to book.</p>\n    </noscript>`);
}

// Search-engine files and per-page static HTML. The canonical domain
// defaults to easyridenz.com (src/seo/site.js); VITE_SITE_URL overrides it
// for a staging deployment.
function seo(siteUrl) {
  const site = siteUrlFrom(siteUrl);
  let outDir = 'dist';

  return {
    name: 'easyride-seo',
    configResolved(config) { outDir = path.resolve(config.root, config.build.outDir); },
    transformIndexHtml(html) {
      return html
        .replace('</title>', `</title>\n    <link rel="canonical" href="${site}/" />`)
        .replace('<meta property="og:type"', `<meta property="og:url" content="${site}/" />\n    <meta property="og:image" content="${site}/images/byd-atto3.png" />\n    <meta name="twitter:image" content="${site}/images/byd-atto3.png" />\n    <meta property="og:type"`)
        .replace('</head>', `    <!-- seo:jsonld -->\n    ${jsonLdTags(site, '/')}\n    <!-- /seo:jsonld -->\n  </head>`);
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
        '',
        `Sitemap: ${site}/sitemap.xml`,
      ].join('\n');
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `${robots}\n` });

      const today = new Date().toISOString().slice(0, 10);
      const urls = Object.entries(PAGES).filter(([, page]) => page.sitemap).map(([p, page]) => (
        `  <url><loc>${site}${p}</loc><lastmod>${today}</lastmod><changefreq>${page.sitemap.changefreq}</changefreq><priority>${page.sitemap.priority}</priority></url>`
      )).join('\n');
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n` });
    },
    // After index.html is on disk: one copy per public page with that
    // page's own head tags, served by vercel.json's per-page rewrites.
    writeBundle() {
      const indexPath = path.join(outDir, 'index.html');
      const html = fs.readFileSync(indexPath, 'utf8');
      fs.writeFileSync(indexPath, renderPage(html, site, '/', PAGES['/'] || DEFAULT_META));
      for (const [pathname, page] of Object.entries(PAGES)) {
        if (pathname === '/') continue;
        const dir = path.join(outDir, pathname.slice(1));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'index.html'), renderPage(html, site, pathname, page));
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
