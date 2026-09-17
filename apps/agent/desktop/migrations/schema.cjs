const { readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');

const CURRENT_SCHEMA_VERSION = 1;
const STATE_FILE = '.desktop-data-version.json';
const migrations = [require('./v0-to-v1.cjs')];
const validVersion = value => Number.isSafeInteger(value) && value >= 0;

async function readDataVersion(home) {
  let state;
  try { state = JSON.parse(await readFile(join(home, STATE_FILE), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return { formatVersion: 1, schemaVersion: 0, appliedMigrations: [] };
    throw error;
  }
  if (state?.formatVersion !== 1 || !validVersion(state.schemaVersion)
    || !Array.isArray(state.appliedMigrations)
    || state.appliedMigrations.some(id => typeof id !== 'string' || !id)
    || new Set(state.appliedMigrations).size !== state.appliedMigrations.length) {
    throw new Error(`Invalid Desktop data version: ${join(home, STATE_FILE)}`);
  }
  return state;
}

function planMigrations(fromVersion, targetVersion, registry) {
  if (!validVersion(fromVersion) || !validVersion(targetVersion)) throw new Error('Invalid Desktop schema version');
  if (fromVersion > targetVersion) {
    throw new Error(`Desktop data version ${fromVersion} is newer than supported version ${targetVersion}. Use a newer Agent; data downgrade is not supported.`);
  }
  const byVersion = new Map();
  const ids = new Set();
  for (const step of registry) {
    if (!validVersion(step.fromVersion) || !validVersion(step.toVersion) || step.toVersion !== step.fromVersion + 1
      || typeof step.id !== 'string' || !step.id || typeof step.run !== 'function'
      || byVersion.has(step.fromVersion) || ids.has(step.id)) {
      throw new Error('Invalid Desktop migration registry');
    }
    byVersion.set(step.fromVersion, step);
    ids.add(step.id);
  }
  const plan = [];
  for (let version = fromVersion; version < targetVersion; version++) {
    const step = byVersion.get(version);
    if (!step) throw new Error(`Missing Desktop data migration ${version} -> ${version + 1}`);
    plan.push(step);
  }
  return plan;
}

async function migrateData(context, state, plan) {
  const next = { ...state, appliedMigrations: [...state.appliedMigrations] };
  for (const step of plan) {
    if (next.appliedMigrations.includes(step.id)) throw new Error(`Inconsistent Desktop migration history: ${step.id}`);
    try { await step.run(context); }
    catch (cause) { throw new Error(`Desktop data migration ${step.id} failed; existing home retained at ${context.home}`, { cause }); }
    next.schemaVersion = step.toVersion;
    next.appliedMigrations.push(step.id);
  }
  // This marker belongs to the candidate. It becomes authoritative only when
  // the whole home is activated; failed steps never advance the live version.
  await writeFile(join(context.staging, STATE_FILE), JSON.stringify(next, null, 2) + '\n');
}

module.exports = { CURRENT_SCHEMA_VERSION, migrations, readDataVersion, planMigrations, migrateData };
