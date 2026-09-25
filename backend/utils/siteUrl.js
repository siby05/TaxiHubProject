// The public website address printed on receipts/invoices. Defaults to the
// real site (easyridenz.com); SITE_URL overrides it (e.g. for a staging
// deployment). Deliberately not FRONTEND_URL, which can be a hosting
// provider's own domain rather than the address customers should see.
const DEFAULT_SITE_URL = 'https://easyridenz.com';

function siteUrl() {
  return (process.env.SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, '');
}

// "https://easyridenz.com" -> "easyridenz.com", for display.
function siteLabel(url = siteUrl()) {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '');
}

module.exports = { siteUrl, siteLabel };
