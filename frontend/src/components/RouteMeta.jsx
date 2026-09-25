import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// Per-page <title>, meta description, canonical link and robots rule for
// search engines (Google runs the JS, so setting these on navigation is
// enough; the static defaults and social-preview tags live in index.html).
// Signed-in areas and one-off links (QR landing, pay, reset) are kept out
// of the index - they're either behind a login or specific to one person.
const DEFAULT = {
  title: 'EasyRide · Taxi & Airport Transfers in New Plymouth, NZ',
  description: 'Book a local taxi in New Plymouth with upfront fares, vetted drivers and live trip updates. Airport drop-offs and long-distance trips - pre-book 24 hours ahead. Cash or card.',
};

const PAGES = {
  '/': DEFAULT,
  '/about': {
    title: 'About EasyRide · Local Taxi Service in New Plymouth, Taranaki',
    description: 'EasyRide is a New Plymouth taxi service with admin-approved, NZTA-licensed drivers, upfront fares and no surge pricing. Learn how it works.',
  },
  '/terms': {
    title: 'Terms & Conditions · EasyRide',
    description: 'The terms that apply to booking and riding with EasyRide, and to driving on the platform.',
  },
  '/register': {
    title: 'Sign Up to Book a Taxi · EasyRide New Plymouth',
    description: 'Create a free EasyRide account to book taxis, airport transfers and long-distance trips in New Plymouth. Already had a ride booked for you? Set a password on it here.',
  },
  '/login': {
    title: 'Log In · EasyRide',
    description: 'Log in to EasyRide to book a ride, track your driver and see your trip receipts.',
  },
  '/driver-signup': {
    title: 'Drive with EasyRide · Taxi Driver Jobs in New Plymouth',
    description: 'Apply to drive with EasyRide in New Plymouth. Set your own rate and weekly schedule - bring your licence, TSL, CoF and registration.',
  },
};

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
    document.title = (page || DEFAULT).title;
    setHeadTag('meta', 'name', 'description', 'content', (page || DEFAULT).description);
    setHeadTag('meta', 'name', 'robots', 'content', page ? 'index, follow' : 'noindex, nofollow');
    setHeadTag('link', 'rel', 'canonical', 'href', `${window.location.origin}${pathname}`);
  }, [pathname]);

  return null;
}
