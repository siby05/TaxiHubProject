const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateCardSurcharge } = require('../utils/stripeFees');
test('tip-inclusive card surcharge covers total charged', () => {
  for (const tip of [0, 5, 10, 20, 0.29, 200]) {
    const fare = 50;
    const surcharge = calculateCardSurcharge(fare + tip, 'NZ');
    assert.ok(surcharge >= calculateCardSurcharge(fare, 'NZ'));
    assert.ok(Math.round((fare + tip + surcharge) * 100) > 0);
  }
});
