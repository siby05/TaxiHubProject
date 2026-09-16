/**
 * Modelled on Waka Kotahi NZTA's Small Passenger Service Vehicle (SPSV)
 * rules as generally understood - NOT verified legal advice. Two relevant
 * SPSV categories: "Taxi" (must run an approved in-vehicle security
 * camera, use a taxi meter, display roof sign) and "Private Hire Service"
 * (no camera/meter/roof-sign requirement, but still needs a driver
 * Passenger (P) endorsement and a vehicle Certificate of Fitness, same as
 * Taxi). Since this operator has no security camera, driver.serviceCategory
 * defaults to 'private-hire' - confirm current requirements with NZTA
 * directly before relying on this for compliance.
 */
function checkDriverCompliance(driver) {
  const issues = [];
  const now = new Date();

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
