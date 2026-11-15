// NZ GST-inclusive fare breakdown. Rate changes never add to the amount paid.
// IRD: charging-gst; QB 18/14 (card fees follow the underlying supply).
const DEFAULT_GST_RATE_PERCENT = 15;
const cents = (value) => Math.round(Number(value || 0) * 100);
function receiptAmounts(booking) {
  const fareCents = cents(booking.actualFare ?? booking.estimatedFare);
  const cardFeeCents = cents(booking.cardSurchargeAmount);
  const tipCents = cents(booking.tipAmount); // voluntary tips are not consideration for the ride
  const enabled = booking.receiptGstEnabled === true;
  const savedRate = booking.receiptGstRatePercent;
  // Legacy trips without an explicit GST snapshot do not claim GST was charged.
  // Enabled trips with a missing rate retain 15%, never a later admin setting.
  const rate = enabled ? (Number.isFinite(savedRate) && savedRate >= 0 && savedRate <= 100 ? savedRate : DEFAULT_GST_RATE_PERCENT) : 0;
  const taxableCents = fareCents + cardFeeCents;
  const gstCents = Math.round(taxableCents * rate / (100 + rate));
  const totalCents = taxableCents + tipCents;
  return { fare: fareCents / 100, cardFee: cardFeeCents / 100, tip: tipCents / 100,
    enabled, rate, gst: gstCents / 100, subtotal: (totalCents - gstCents) / 100, total: totalCents / 100 };
}
module.exports = { receiptAmounts, DEFAULT_GST_RATE_PERCENT };
