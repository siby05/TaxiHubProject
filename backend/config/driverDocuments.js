/**
 * The compliance documents every driver must supply, and the shape of the
 * per-document review record an admin produces. One place so signup upload,
 * admin review, driver re-upload and the approval gate all agree on the
 * same keys and statuses.
 *
 * Each entry on Driver.documents looks like:
 *   { url, status: 'pending'|'verified'|'rejected', rejectionReason,
 *     uploadedAt, reviewedAt }
 *
 * A driver can only be approved once every document is 'verified' (see
 * routes/admin.js PUT /drivers/:id/approve). Rejecting one sends it back to
 * the driver with a reason; their re-upload resets it to 'pending'.
 */
const DRIVER_DOCUMENTS = [
  { key: 'license', field: 'licenseDoc', label: 'Driver licence' },
  { key: 'tsl', field: 'tslDoc', label: 'Transport Service Licence (TSL)' },
  { key: 'cof', field: 'cofDoc', label: 'Certificate of Fitness (CoF)' },
  { key: 'rego', field: 'regoDoc', label: 'Vehicle registration' },
];

const DOCUMENT_KEYS = DRIVER_DOCUMENTS.map((d) => d.key);

function isValidDocumentKey(key) {
  return DOCUMENT_KEYS.includes(key);
}

function documentLabel(key) {
  return DRIVER_DOCUMENTS.find((d) => d.key === key)?.label || key;
}

// True only when all four are present and verified - the gate on approving
// a driver and on letting them go online.
function allDocumentsVerified(driver) {
  const docs = driver?.documents || {};
  return DOCUMENT_KEYS.every((k) => docs[k]?.status === 'verified');
}

// Human-readable list of what still blocks approval, for admin-facing errors.
function outstandingDocuments(driver) {
  const docs = driver?.documents || {};
  return DRIVER_DOCUMENTS
    .filter((d) => docs[d.key]?.status !== 'verified')
    .map((d) => `${d.label} (${docs[d.key]?.status || 'not supplied'})`);
}

module.exports = {
  DRIVER_DOCUMENTS,
  DOCUMENT_KEYS,
  isValidDocumentKey,
  documentLabel,
  allDocumentsVerified,
  outstandingDocuments,
};
