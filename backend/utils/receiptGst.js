// NZ GST-inclusive fare breakdown. Rate changes never add to the amount paid.
// IRD: charging-gst; QB 18/14 (card fees follow the underlying supply).
const DEFAULT_GST_RATE_PERCENT = 15;
const cents = (value) => Math.round(Number(value || 0) * 100);
function receiptAmounts(booking) {
  const fareCents = cents(booking.actualFare ?? booking.estimatedFare);
  const cardFeeCents = cents(booking.cardSurchargeAmount);
  const tipCents = cents(booking.tipAmount); // voluntary tips are not consideration for the ride
  const savedRate = booking.receiptGstRatePercent;
  // Legacy trips retain the existing NZ standard rate, never a later setting.
  const rate = Number.isFinite(savedRate) && savedRate >= 0 && savedRate <= 100 ? savedRate : DEFAULT_GST_RATE_PERCENT;
  const taxableCents = fareCents + cardFeeCents;
  const gstCents = Math.round(taxableCents * rate / (100 + rate));
  const totalCents = taxableCents + tipCents;
  return { fare: fareCents / 100, cardFee: cardFeeCents / 100, tip: tipCents / 100,
    rate, gst: gstCents / 100, subtotal: (totalCents - gstCents) / 100, total: totalCents / 100 };
}
module.exports = { receiptAmounts, DEFAULT_GST_RATE_PERCENT };
