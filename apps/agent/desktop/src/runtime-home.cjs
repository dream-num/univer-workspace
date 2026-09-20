// Startup owns when to migrate; the standalone migration package owns how.
const { migrateRuntimeHome } = require('../migrations/run.cjs');

module.exports = { prepareRuntimeHome: migrateRuntimeHome };
