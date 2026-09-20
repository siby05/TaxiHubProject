const { createModel } = require('../lib/createModel');

// A true singleton - exactly one document ever exists. Backs
// config/platformSettings.js's in-memory cache so admin-configured
// settings (commission model, fare floors, toggles, admin contact info,
// backup schedule) survive a server restart under DB_MODE=mongo instead
// of silently resetting to defaults on every redeploy. See
// config/platformSettings.js loadSettings()/updateSettings().
const PlatformSettings = createModel('PlatformSettings');

module.exports = PlatformSettings;
