// " · 10% off (was $700.00)" when a booking or quote carries a discount
// (see backend utils/discounts.js), else "". Appended after a fare.
export function discountNote(b) {
  if (!b?.discountPercent || !b.fareBeforeDiscount) return '';
  const kind = b.returnTripDiscountPercent >= b.discountPercent ? 'return-trip discount' : 'promotion';
  return ` · ${b.discountPercent}% off - ${kind} (was $${Number(b.fareBeforeDiscount).toFixed(2)})`;
}
