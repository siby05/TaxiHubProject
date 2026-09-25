// Single source of truth for search-engine metadata, shared by
// components/RouteMeta.jsx (updates <head> on client-side navigation) and
// the seo plugin in vite.config.js (writes a real HTML file per public
// page at build time, so crawlers and link previews - WhatsApp, Facebook,
// iMessage, which don't run JS - see the right title/description/canonical
// without waiting for the app to render). Plain JS, no JSX/browser APIs,
// so the Vite config can import it too.

// The public domain. Canonical links always point here, even when the app
// is being served from a hosting provider's own domain, so search engines
// never split ranking between two copies of the site.
export const DEFAULT_SITE_URL = 'https://easyridenz.com';

export function siteUrlFrom(value) {
  return (value || DEFAULT_SITE_URL).replace(/\/$/, '');
}

export const BUSINESS = {
  name: 'EasyRide',
  legalName: 'Easy Ride NZ',
  email: 'easyridenz@gmail.com',
  city: 'New Plymouth',
  region: 'Taranaki',
};

export const DEFAULT_META = {
  title: 'EasyRide · Taxi & Airport Transfers in New Plymouth, NZ',
  description: 'Book a local taxi in New Plymouth with upfront fares, vetted drivers and live trip updates. Airport drop-offs and long-distance trips - pre-book 12 hours ahead. Cash or card.',
  heading: 'EasyRide - Taxi & Airport Transfers in New Plymouth, New Zealand',
};

// Airport page FAQ - rendered on the page and emitted as FAQPage
// structured data (eligible for Google's expandable FAQ results).
export const AIRPORT_FAQ = [
  {
    q: 'How do I book a taxi to New Plymouth Airport?',
    a: 'Create a free EasyRide account, enter your pickup address and "New Plymouth Airport" as the drop-off, then choose "Schedule for later" and pick a time that gets you there comfortably before your flight. You see the fare before you confirm.',
  },
  {
    q: 'How far ahead do I need to book an airport transfer?',
    a: 'Airport and long-distance trips need at least 12 hours\' notice, so a driver can commit to your time. Booking the day before your flight is ideal.',
  },
  {
    q: 'How much is a taxi from New Plymouth to the airport?',
    a: 'Fares are a base fare plus a per-kilometre rate for the actual route - no surge pricing. The exact price is shown upfront when you enter your pickup and drop-off, before you book.',
  },
  {
    q: 'Can I get picked up from New Plymouth Airport?',
    a: 'Yes. Book a pickup from New Plymouth Airport (NPL) to your address in advance and your driver will be confirmed before you land.',
  },
  {
    q: 'Can I pay by card?',
    a: 'Yes - pay online by card or pay the driver in cash, whichever suits you. Every trip comes with an emailed or WhatsApp receipt.',
  },
  {
    q: 'Do you go further than New Plymouth?',
    a: 'Yes. We do long-distance trips across Taranaki and beyond - Stratford, Inglewood, Waitara, Hāwera, Ōakura, Whanganui and more - with one upfront fare and stops along the way if you need them.',
  },
];

// Public, indexable pages. `heading`/`summary` are the crawler-visible
// fallback text written into each page's static HTML (inside <noscript>).
// `sitemap` pages are listed in sitemap.xml. Anything not listed here
// (signed-in areas, one-off links like QR landing, pay, reset) gets
// noindex from RouteMeta.
export const PAGES = {
  '/': { ...DEFAULT_META, sitemap: { changefreq: 'weekly', priority: '1.0' } },
  '/airport-transfers': {
    title: 'New Plymouth Airport Taxi & Transfers · EasyRide',
    description: 'Pre-book a taxi to or from New Plymouth Airport (NPL). Upfront fares, confirmed local driver, cash or card. Book 12 hours ahead for airport and long-distance trips across Taranaki.',
    heading: 'New Plymouth Airport Taxi & Transfers',
    summary: 'Pre-book a confirmed local driver to or from New Plymouth Airport (NPL), with an upfront fare and cash or card payment. Airport and long-distance trips need 12 hours\' notice.',
    sitemap: { changefreq: 'monthly', priority: '0.9' },
  },
  '/about': {
    title: 'About EasyRide · Local Taxi Service in New Plymouth, Taranaki',
    description: 'EasyRide is a New Plymouth taxi service with admin-approved, NZTA-licensed drivers, upfront fares and no surge pricing. Learn how it works.',
    heading: 'About EasyRide - local taxi service in New Plymouth, Taranaki',
    sitemap: { changefreq: 'monthly', priority: '0.7' },
  },
  '/driver-signup': {
    title: 'Drive with EasyRide · Taxi Driver Jobs in New Plymouth',
    description: 'Apply to drive with EasyRide in New Plymouth. Set your own rate and schedule - bring your licence, TSL, CoF and registration.',
    heading: 'Drive with EasyRide in New Plymouth',
    sitemap: { changefreq: 'monthly', priority: '0.6' },
  },
  '/register': {
    title: 'Sign Up to Book a Taxi · EasyRide New Plymouth',
    description: 'Create a free EasyRide account to book taxis, airport transfers and long-distance trips in New Plymouth. Already had a ride booked for you? Set a password on it here.',
    heading: 'Sign up to book a taxi in New Plymouth',
    sitemap: { changefreq: 'monthly', priority: '0.6' },
  },
  '/login': {
    title: 'Log In · EasyRide',
    description: 'Log in to EasyRide to book a ride, track your driver and see your trip receipts.',
    heading: 'Log in to EasyRide',
    sitemap: { changefreq: 'yearly', priority: '0.3' },
  },
  '/terms': {
    title: 'Terms & Conditions · EasyRide',
    description: 'The terms that apply to booking and riding with EasyRide, and to driving on the platform.',
    heading: 'EasyRide Terms & Conditions',
    sitemap: { changefreq: 'yearly', priority: '0.3' },
  },
};

// schema.org structured data for a page: the business itself on every
// page, plus the FAQ on the airport page.
export function structuredData(site, pathname) {
  const business = {
    '@context': 'https://schema.org',
    '@type': 'TaxiService',
    name: BUSINESS.name,
    url: `${site}/`,
    image: `${site}/images/byd-atto3.png`,
    description: DEFAULT_META.description,
    areaServed: [
      { '@type': 'City', name: 'New Plymouth' },
      { '@type': 'AdministrativeArea', name: 'Taranaki' },
    ],
    provider: {
      '@type': 'LocalBusiness',
      name: BUSINESS.legalName,
      url: `${site}/`,
      email: BUSINESS.email,
      image: `${site}/images/byd-atto3.png`,
      address: { '@type': 'PostalAddress', addressLocality: BUSINESS.city, addressRegion: BUSINESS.region, addressCountry: 'NZ' },
    },
  };
  const blocks = [business];
  if (pathname === '/airport-transfers') {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: AIRPORT_FAQ.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    });
  }
  return blocks;
}
