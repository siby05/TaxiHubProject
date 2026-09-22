const crypto = require('crypto');

// Every User needs a unique email (it's the login identifier), but
// passengers registered on someone's behalf - by a driver at the kerb, by
// the guest QR flow, or by an admin - often don't have one. They get a
// generated placeholder on this reserved domain instead, which nothing
// should ever actually try to deliver to. An admin can replace it with a
// real address later (PUT /api/admin/passengers/:id).
const PLACEHOLDER_DOMAIN = 'no-email.easyride.local';

function placeholderEmail(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}@${PLACEHOLDER_DOMAIN}`;
}

function hasRealEmail(user) {
  return !!user?.email && !user.email.endsWith(`@${PLACEHOLDER_DOMAIN}`);
}

module.exports = { placeholderEmail, hasRealEmail };
