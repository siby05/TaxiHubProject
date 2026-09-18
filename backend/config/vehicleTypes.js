/**
 * The vehicle classes a driver's car can belong to, and that a passenger
 * can ask for when booking. Kept in one place so the admin/driver-signup
 * forms, the passenger's booking filter, and validation can't drift apart -
 * served to the frontend via GET /api/booking/vehicle-types.
 */
const VEHICLE_TYPES = [
  { value: 'Economy', label: 'Economy', description: 'Standard petrol/diesel car - lowest fare' },
  { value: 'Comfort', label: 'Comfort', description: 'Newer, roomier car with extra legroom' },
  { value: 'Comfort Electric', label: 'Comfort Electric', description: 'Roomier EV - quiet ride, zero tailpipe emissions' },
  { value: 'Electric', label: 'Electric', description: 'Standard EV - zero tailpipe emissions' },
  { value: 'Premium', label: 'Premium', description: 'Executive vehicle for business travel' },
  { value: 'Wheelchair Accessible', label: 'Wheelchair Accessible', description: 'Van with a ramp or hoist and wheelchair restraints' },
];

const VEHICLE_TYPE_VALUES = VEHICLE_TYPES.map((t) => t.value);

function isValidVehicleType(value) {
  return VEHICLE_TYPE_VALUES.includes(value);
}

module.exports = { VEHICLE_TYPES, VEHICLE_TYPE_VALUES, isValidVehicleType };
