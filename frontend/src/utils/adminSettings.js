export const ADMIN_SETTINGS_SECTIONS = [
  { id: 'pricing', label: 'Ride pricing', description: 'Minimum fare, per-kilometre rates and distance bands.', fields: ['minimumFare', 'globalRatePerKm', 'fareRanges', 'longDistanceThresholdKm', 'longDistanceRatePerKm'] },
  { id: 'discounts', label: 'Discounts', description: 'Date promotions, return trips and route offers.', fields: ['promoDiscount', 'returnTripDiscount', 'routeDiscounts'] },
  { id: 'fees', label: 'Driver fees', description: 'Commission, weekly fees and outstanding balances.', fields: ['commissionType', 'commissionPercent', 'weeklyFlatFee', 'outstandingFeeLimit'] },
  { id: 'bookings', label: 'Booking options', description: 'Driver applications and passenger vehicle choices.', fields: ['driverSignupEnabled', 'vehicleSelectionEnabled'] },
  { id: 'gst', label: 'GST & receipts', description: 'Optional GST, tax rate and supplier registration number.', fields: ['receiptGstEnabled', 'receiptGstRatePercent', 'gstNumber'] },
  { id: 'contact', label: 'Contact & backups', description: 'Public contact details and data backup schedule.', fields: ['adminEmail', 'adminMobile', 'backupFrequency'] },
  { id: 'storage', label: 'Data storage', description: 'Storage capacity and trip history retention.', fields: ['dbStorageLimitMb'] },
  { id: 'account', label: 'Account & security', description: 'Your admin login and temporary password visibility.', fields: ['tempPasswordVisible'] },
];
export function adminSettingsPatch(settings, sectionId) {
  const section = ADMIN_SETTINGS_SECTIONS.find((s) => s.id === sectionId);
  if (!section) throw new Error('Unknown settings section');
  return Object.fromEntries(section.fields.filter((key) => settings[key] !== undefined).map((key) => [key, settings[key]]));
}
