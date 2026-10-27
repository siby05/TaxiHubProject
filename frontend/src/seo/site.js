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
  legalName: 'EasyRide NZ',
  email: 'easyridenz@gmail.com',
  city: 'New Plymouth',
  region: 'Taranaki',
  // How people actually type the name into Google - listed as schema.org
  // alternateName so a search for any of them matches the business.
  alternateNames: ['Easy Ride', 'Easy Ride New Plymouth', 'EasyRide New Plymouth', 'Easy Ride NZ', 'Easy Ride Private Passenger Service'],
};

// Home page - targets "Easy Ride New Plymouth" (the brand, written the way
// people search it) and "private taxi in New Plymouth".
export const DEFAULT_META = {
  title: 'Easy Ride New Plymouth · Private Passenger Service & Airport Transfers',
  description: 'Book private taxi rides and airport transfers in New Plymouth with EasyRide. Request a local driver, see estimated fares, and receive confirmation once a driver accepts. Cash or card.',
  heading: 'Easy Ride New Plymouth - Private Passenger Service & Airport Transfers',
  summary: 'Easy Ride (EasyRide) is a private passenger service in New Plymouth, Taranaki: book a vetted local driver with an upfront fare, pay by cash or card, and follow your trip live. We also do New Plymouth Airport transfers and long-distance trips to Auckland, Wellington and across Taranaki.',
};

// "New Plymouth to Auckland" landing page. Figures are deliberately
// approximate - the exact fare is always the upfront quote at booking.
export const AUCKLAND_FAQ = [
  {
    q: 'How far is New Plymouth to Auckland by car?',
    a: 'About 350-360 km, usually around 4.5 to 5 hours\' driving via State Highway 3, depending on traffic and stops. Your driver takes you door to door, so there are no bus or flight connections to worry about.',
  },
  {
    q: 'How much is a private transfer from New Plymouth to Auckland?',
    a: 'You get a fixed, upfront fare for the whole trip before you book - worked out from the route distance, with no surge pricing and no meter running. Enter your pickup and Auckland address when booking to see the exact price.',
  },
  {
    q: 'Can you take me to Auckland Airport?',
    a: 'You can request an Auckland Airport transfer for your travel date. We will confirm driver availability after you submit the request.',
  },
  {
    q: 'How far in advance do I need to book?',
    a: 'Long-distance trips like New Plymouth to Auckland need at least 12 hours\' notice, so a driver can commit to your date and time. Booking a day or more ahead is best.',
  },
  {
    q: 'Can I stop on the way?',
    a: 'Yes - add stops when you book (for example Waitara, Mōkau, Te Kūiti or Hamilton) and they are included in your upfront fare.',
  },
  {
    q: 'Do you also go from Auckland to New Plymouth?',
    a: 'Yes. Pre-book a pickup in Auckland or at Auckland Airport back to New Plymouth, with the same upfront fare and confirmed driver.',
  },
];

// Airport page FAQ - rendered on the page and emitted as FAQPage
// structured data (eligible for Google's expandable FAQ results).
export const AIRPORT_FAQ = [
  {
    q: 'How do I book a ride to New Plymouth Airport?',
    a: 'Create a free EasyRide account, enter your pickup address and "New Plymouth Airport" as the drop-off, then choose "Schedule for later" and pick a time that gets you there comfortably before your flight. You see the fare before you confirm.',
  },
  {
    q: 'How far ahead do I need to book an airport transfer?',
    a: 'Airport and long-distance trips need at least 12 hours\' notice, so a driver can commit to your time. Booking the day before your flight is ideal.',
  },
  {
    q: 'How much is a ride from New Plymouth to the airport?',
    a: 'Fares are a base fare plus a per-kilometre rate for the actual route - no surge pricing. The exact price is shown upfront when you enter your pickup and drop-off, before you book.',
  },
  {
    q: 'Can I get picked up from New Plymouth Airport?',
    a: 'Yes. Book a pickup from New Plymouth Airport (NPL) to your address in advance and your driver will be confirmed before you land.',
  },
  {
    q: 'Can I pay by card?',
    a: 'You can choose available cash or card options. Receipts are provided after a completed trip has been paid.',
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
    title: 'New Plymouth Airport Transfers · Easy Ride Private Passenger Service',
    description: 'Request New Plymouth Airport transfers with EasyRide. View an estimated fare, book ahead, and receive a driver confirmation once availability is arranged. Cash or card.',
    heading: 'New Plymouth Airport Transfers',
    summary: 'Request a private airport transfer to or from New Plymouth Airport (NPL). View the fare estimate before submitting; driver availability is confirmed separately.',
    sitemap: { changefreq: 'monthly', priority: '0.9' },
    faq: AIRPORT_FAQ,
  },
  '/new-plymouth-to-auckland': {
    title: 'New Plymouth to Auckland Private Transfers · Easy Ride',
    description: 'Private door-to-door transfer from New Plymouth to Auckland or Auckland Airport. Fixed upfront fare, vetted local driver, stops on the way. Pre-book 12 hours ahead.',
    heading: 'New Plymouth to Auckland - private passenger transfers',
    summary: 'Easy Ride runs private door-to-door trips from New Plymouth to Auckland and Auckland Airport (about 350-360 km, 4.5-5 hours) with a fixed upfront fare and a confirmed local driver. Pre-book at least 12 hours ahead.',
    sitemap: { changefreq: 'monthly', priority: '0.9' },
    faq: AUCKLAND_FAQ,
  },
  '/about': {
    title: 'About Easy Ride · Private Passenger Service in New Plymouth, Taranaki',
    description: 'Easy Ride is a New Plymouth private passenger service with admin-approved, NZTA-licensed drivers, upfront fares and no surge pricing. Learn how it works.',
    heading: 'About Easy Ride - private passenger service in New Plymouth, Taranaki',
    sitemap: { changefreq: 'monthly', priority: '0.7' },
  },
  '/driver-signup': {
    title: 'Drive with Easy Ride · Private Passenger Service Driver Jobs in New Plymouth',
    description: 'Apply to drive with EasyRide in New Plymouth. Set your own rate and schedule - bring your licence, TSL, CoF and registration.',
    heading: 'Drive with EasyRide in New Plymouth',
    sitemap: { changefreq: 'monthly', priority: '0.6' },
  },
  '/register': {
    title: 'Sign Up to Book a Ride · Easy Ride New Plymouth',
    description: 'Create a free Easy Ride account to book private rides, airport transfers and long-distance trips in New Plymouth. Already had a ride booked for you? Set a password on it here.',
    heading: 'Sign up to book a private ride in New Plymouth',
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
// page, plus the page's FAQ where it has one.
export function structuredData(site, pathname) {
  const business = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: BUSINESS.name,
    alternateName: BUSINESS.alternateNames,
    url: `${site}/`,
    image: `${site}/images/byd-atto3.png`,
    description: DEFAULT_META.description,
    serviceType: ['Private passenger service', 'Airport transfer', 'Long-distance transfer'],
    areaServed: [
      { '@type': 'City', name: 'New Plymouth' },
      { '@type': 'AdministrativeArea', name: 'Taranaki' },
      { '@type': 'City', name: 'Auckland' },
    ],
    provider: {
      '@type': 'LocalBusiness',
      name: BUSINESS.legalName,
      alternateName: BUSINESS.alternateNames,
      url: `${site}/`,
      email: BUSINESS.email,
      image: `${site}/images/byd-atto3.png`,
      logo: `${site}/icon-512x512.png`,
      address: { '@type': 'PostalAddress', addressLocality: BUSINESS.city, addressRegion: BUSINESS.region, addressCountry: 'NZ' },
    },
  };
  const blocks = [business];
  const faq = PAGES[pathname]?.faq;
  if (faq) {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    });
  }
  return blocks;
}
