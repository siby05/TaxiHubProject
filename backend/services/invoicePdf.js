const path = require('path');
const PDFDocument = require('pdfkit');
const { getSettings } = require('../config/platformSettings');
const { formatNzDate } = require('../utils/nzTime');
const { siteUrl, siteLabel } = require('../utils/siteUrl');

// DejaVu rather than PDFKit's built-in Helvetica: the standard PDF fonts
// only cover WinAnsi, so Māori macrons in Taranaki place names (Ōakura,
// Pātea...) coming back from the geocoder would print as garbage.
const FONT_DIR = path.dirname(require.resolve('dejavu-fonts-ttf/package.json'));
const REGULAR = path.join(FONT_DIR, 'ttf', 'DejaVuSans.ttf');
const BOLD = path.join(FONT_DIR, 'ttf', 'DejaVuSans-Bold.ttf');

const NAVY = '#0B2942';
const ACCENT = '#38BDF8';
const PRIMARY = '#0EA5E9';
const INK = '#0f172a';
const MUTED = '#64748b';
const BORDER = '#e2e8f0';

// Same document as emailService.js's buildInvoiceHtml(), as a real PDF -
// for the "Download PDF" button on the receipt page and as the invoice
// email's attachment. A generated file, rather than the browser's own
// print-to-PDF, because window.print() is a no-op on most phones (and
// always inside the installed PWA), which is where receipts actually get
// requested.
function buildInvoicePdf(booking, passenger, driver, driverName) {
  return new Promise((resolve, reject) => {
    const settings = getSettings();
    const fare = booking.actualFare ?? booking.estimatedFare;
    const total = fare + (booking.cardSurchargeAmount || 0);
    const vehicleMake = [driver?.vehicleBrand, driver?.vehicleModel].filter(Boolean).join(' ');
    const vehicleType = vehicleMake ? `${vehicleMake} (${driver.vehicleType})` : driver?.vehicleType;
    const vehicleLabel = [vehicleType, driver?.vehicleNumber].filter(Boolean).join(' · ');

    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `EasyRide invoice ${booking.bookingId}`, Author: 'EasyRide' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('Regular', REGULAR).registerFont('Bold', BOLD);

    const pageW = doc.page.width;
    const left = 48;
    const right = pageW - 48;
    const width = right - left;

    // Header band
    doc.rect(0, 0, pageW, 96).fill(NAVY);
    // The car badge and gold wordmark match the approved website mark.
    doc.lineWidth(2).strokeColor('#ffffff').roundedRect(left + 2, 40, 34, 16, 4).stroke();
    doc.moveTo(left + 7, 40).lineTo(left + 13, 31).lineTo(left + 27, 31).lineTo(left + 34, 40).stroke();
    doc.circle(left + 10, 58, 3).fill('#ffffff');
    doc.circle(left + 28, 58, 3).fill('#ffffff');
    doc.fontSize(22).fillColor('#ffffff').text('Easy', left + 44, 32, { continued: true }).fillColor('#FFCA28').text('Ride');
    doc.font('Regular').fontSize(8.5).fillColor('#94a3b8').text('TAXI & PRIVATE TRANSFERS', left + 44, 62, { characterSpacing: 1 });

    // Title row
    let y = 130;
    doc.font('Bold').fontSize(20).fillColor(INK).text('Invoice', left, y);
    doc.font('Regular').fontSize(10.5).fillColor(MUTED).text(formatNzDate(booking.completedAt || booking.requestedAt), left, y + 6, { width, align: 'right' });
    y += 28;
    doc.fontSize(10.5).fillColor(MUTED).text(booking.bookingId, left, y);
    y += 30;

    if (passenger?.name) {
      doc.fontSize(8.5).fillColor(MUTED).text('BILLED TO', left, y, { characterSpacing: 0.5 });
      y += 14;
      doc.font('Bold').fontSize(11.5).fillColor(INK).text(passenger.name, left, y);
      y += 16;
      if (passenger.address) {
        doc.font('Regular').fontSize(10.5).fillColor(MUTED).text(passenger.address, left, y, { width });
        y += doc.heightOfString(passenger.address, { width }) + 2;
      }
      y += 14;
    }

    const labelW = 140;
    const valueW = width - labelW;
    function row(label, value) {
      if (!value) return;
      const text = String(value);
      doc.font('Regular').fontSize(10.5);
      const h = Math.max(doc.heightOfString(text, { width: valueW }), 14);
      doc.fillColor(MUTED).text(label, left, y + 8, { width: labelW });
      doc.fillColor(INK).text(text, left + labelW, y + 8, { width: valueW, align: 'right' });
      y += h + 16;
      doc.moveTo(left, y).lineTo(right, y).lineWidth(0.75).strokeColor(BORDER).stroke();
    }

    row('Pickup', booking.pickupAddress);
    (booking.stops || []).forEach((s, i) => row(`Stop ${i + 1}`, s.address));
    row('Drop-off', booking.dropAddress);
    row('Distance', `${booking.distanceKm} km`);
    row('Driver', driverName);
    row('Vehicle', vehicleLabel);
    row('Payment method', booking.paidVia === 'card-in-person' ? 'Card (EFTPOS / in person)' : booking.paymentMethod === 'card' ? 'Card (online)' : 'Cash');
    row('Payment status', booking.paymentStatus === 'paid' ? 'Paid' : 'Unpaid');

    // Totals
    y += 24;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(2).strokeColor(NAVY).stroke();
    y += 14;
    function amount(label, value, { bold = false, size = 10.5, color = INK } = {}) {
      doc.font(bold ? 'Bold' : 'Regular').fontSize(size);
      doc.fillColor(bold ? INK : MUTED).text(label, left, y, { width: labelW });
      doc.fillColor(color).text(`$${value.toFixed(2)}`, left + labelW, y, { width: valueW, align: 'right' });
      y += size + 10;
    }
    amount('Fare', fare);
    if (booking.cardSurchargeAmount > 0) amount('Card fee', booking.cardSurchargeAmount);
    y += 6;
    amount('Total', total, { bold: true, size: 15, color: PRIMARY });

    // Footer
    y += 28;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.75).strokeColor(BORDER).stroke();
    y += 18;
    doc.font('Bold').fontSize(10.5).fillColor(INK).text('EasyRide', left, y);
    y += 16;
    doc.font('Regular').fontSize(9.5).fillColor(MUTED);
    if (settings.adminEmail) { doc.text(`Email: ${settings.adminEmail}`, left, y); y += 14; }
    if (settings.adminMobile) { doc.text(`Phone: ${settings.adminMobile}`, left, y); y += 14; }
    const site = siteUrl();
    if (site) { doc.text(`Website: ${siteLabel(site)}`, left, y, { link: site }); y += 14; }
    y += 6;
    doc.text('Thanks for riding with EasyRide.', left, y);

    doc.end();
  });
}

module.exports = { buildInvoicePdf };
