const { createModel } = require('../lib/createModel');

// What's left of completed trips after utils/retention.js deletes them to
// free database space - just enough for earnings, commission and tax
// reports to keep adding up. Two kinds of row:
//
// kind 'driver': one per driver per NZ day (and per billing week, since a
//   NZ Monday morning falls in the previous UTC week - see
//   utils/billing.js getWeekStart). Fields: driverId, nzDate
//   ("YYYY-MM-DD"), weekStart (ISO), completedAt (a real completion time
//   from that group, so code that derives the day/week from it lands in
//   the same bucket), tripCount, actualFare (the group's total fares).
// kind 'passenger': one per passenger. Fields: passengerId, tripCount,
//   actualFare (total spent).
//
// See utils/earnings.js, which merges these with live trips.
const EarningsArchive = createModel('EarningsArchive');

module.exports = EarningsArchive;
