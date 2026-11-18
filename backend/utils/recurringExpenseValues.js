// The original expense is a posted record, not a mutable recurring template.
const RECURRING_VALUE_FIELDS = ['category', 'amount', 'gstIncluded', 'supplier', 'notes'];
function recurringValuesFor(expense, date) {
  const latest = (expense.repeatValueVersions || []).reduce((selected, version) =>
    version.effectiveFrom <= date && (!selected || version.effectiveFrom >= selected.effectiveFrom) ? version : selected, null);
  return Object.fromEntries(RECURRING_VALUE_FIELDS.map((key) => [key, latest && Object.hasOwn(latest, key) ? latest[key] : expense[key]]));
}
module.exports = { RECURRING_VALUE_FIELDS, recurringValuesFor };
