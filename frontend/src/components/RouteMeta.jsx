import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { PAGES, DEFAULT_META, siteUrlFrom, structuredData } from '../seo/site';

// Per-page <title>, meta description, canonical link, social tags and
// robots rule on client-side navigation. The page list lives in
// seo/site.js, which the build also uses to write each public page's own
// static HTML (see vite.config.js). Signed-in areas and one-off links (QR
// landing, pay, reset) are kept out of the index - they're either behind a
// login or specific to one person.
const SITE = siteUrlFrom(import.meta.env.VITE_SITE_URL);

function setHeadTag(tag, keyAttr, key, valueAttr, value) {
  let el = document.head.querySelector(`${tag}[${keyAttr}="${key}"]`);
  if (!el) {
    el = document.createElement(tag);
    el.setAttribute(keyAttr, key);
    document.head.appendChild(el);
  }
  el.setAttribute(valueAttr, value);
}

export default function RouteMeta() {
  const { pathname } = useLocation();

  useEffect(() => {
    const page = PAGES[pathname];
    const meta = page || DEFAULT_META;
    const url = `${SITE}${pathname}`;
    document.title = meta.title;
    setHeadTag('meta', 'name', 'description', 'content', meta.description);
    setHeadTag('meta', 'name', 'robots', 'content', page ? 'index, follow' : 'noindex, nofollow');
    setHeadTag('link', 'rel', 'canonical', 'href', url);
    setHeadTag('meta', 'property', 'og:url', 'content', url);
    setHeadTag('meta', 'property', 'og:title', 'content', meta.title);
    setHeadTag('meta', 'property', 'og:description', 'content', meta.description);

    // Swap in this page's structured data (e.g. the airport FAQ).
    document.head.querySelectorAll('script[type="application/ld+json"]').forEach((el) => el.remove());
    if (page) {
      structuredData(SITE, pathname).forEach((block) => {
        const el = document.createElement('script');
        el.type = 'application/ld+json';
        el.textContent = JSON.stringify(block);
        document.head.appendChild(el);
      });
    }
  }, [pathname]);

  return null;
}
