/**
 * Modelled on Waka Kotahi NZTA's Small Passenger Service (SPSV) rules,
 * researched from nzta.govt.nz - summarized for this app, NOT verified
 * legal advice; confirm current requirements with NZTA directly:
 *   https://www.nzta.govt.nz/commercial-driving/transport-service-licences/small-passenger-service
 *   https://www.nzta.govt.nz/driver-licences/getting-an-endorsement/getting-an-endorsement-pv/applying-for-a-passenger-p-endorsement
 *
 * Every paid small passenger service driver needs: a Transport Service
 * Licence (TSL, ~$98.87/yr per vehicle via rego) covering the vehicle, a
 * passenger (P) endorsement on their licence (full Class 1 held 2+ years,
 * medical check, police vet), and the vehicle needs a current Certificate
 * of Fitness (CoF), not just a WoF. Separately, some regions require an
 * approved in-vehicle security camera UNLESS the service only carries
 * registered/pre-booked passengers - since every TaxiHub trip requires a
 * signed-in passenger account, driver.serviceCategory defaults to
 * 'private-hire' (no camera) on that basis.
 */
function checkDriverCompliance(driver) {
  const issues = [];
  const now = new Date();

  if (!driver.tslNumber) {
    issues.push('Missing Transport Service Licence (TSL) number');
  }

  if (!driver.passengerEndorsementNumber) {
    issues.push('Missing driver passenger (P) endorsement number');
  } else if (driver.passengerEndorsementExpiry && new Date(driver.passengerEndorsementExpiry) < now) {
    issues.push('Passenger (P) endorsement has expired');
  }

  if (!driver.vehicleCofExpiry) {
    issues.push('Missing vehicle Certificate of Fitness (CoF) expiry date');
  } else if (new Date(driver.vehicleCofExpiry) < now) {
    issues.push('Vehicle Certificate of Fitness (CoF) has expired');
  }

  if (driver.serviceCategory === 'taxi' && !driver.hasSecurityCamera) {
    issues.push('NZTA requires an approved in-vehicle security camera for the Taxi service category');
  }

  return { compliant: issues.length === 0, issues };
}

module.exports = { checkDriverCompliance };
