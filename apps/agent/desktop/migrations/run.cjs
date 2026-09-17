const { mkdir, readFile, writeFile, rename, rm, stat } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { parseArgs } = require('node:util');

// Explicit ordering, independent of directory enumeration or application imports.
const steps = [
  require('./001-stage-shipped-home.cjs'),
  require('./002-preserve-authored-presets.cjs'),
];

async function exists(path) {
  try { await stat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function recoverActivation(home, journal) {
  let pending;
  try { pending = JSON.parse(await readFile(journal, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (pending.version !== 1 || !/^\d+-[a-f0-9-]{36}$/.test(pending.backup)) {
    throw new Error(`Invalid runtime home migration journal: ${journal}`);
  }
  // A crash between the two renames must not turn the next start into a fresh
  // installation. Restore the exact recorded home before deciding what to run.
  if (!(await exists(home))) await rename(`${home}.previous-${pending.backup}`, home);
  await rm(journal);
}

async function migrateRuntimeHome(resources, home) {
  resources = resolve(resources);
  home = resolve(home);
  const journal = `${home}.upgrade.json`;
  await recoverActivation(home, journal);
  const identity = createHash('sha256')
    .update(resources).update('\0')
    .update(await readFile(join(resources, 'integrity.json'))).digest('hex');
  try {
    // Preserve compatibility with homes created before the migration runner.
    if (await readFile(join(home, '.desktop-complete'), 'utf8') === identity) return home;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }

  const staging = `${home}.staging`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  const completed = [];
  for (const step of steps) {
    try { await step.run({ resources, home, staging }); }
    catch (cause) {
      throw new Error(`Runtime home migration ${step.id} failed; existing home retained at ${home}`, { cause });
    }
    completed.push(step.id);
  }
  await writeFile(join(staging, '.desktop-migrations.json'), JSON.stringify({ version: 1, identity, completed }, null, 2) + '\n');
  await writeFile(join(staging, '.desktop-complete'), identity);

  const backup = `${Date.now()}-${randomUUID()}`;
  const previous = `${home}.previous-${backup}`;
  const backedUp = await exists(home);
  if (backedUp) {
    // Publish a complete journal before moving any user data. A leftover .tmp
    // only means preparation was interrupted; it has no activation authority.
    await writeFile(`${journal}.tmp`, JSON.stringify({ version: 1, backup }) + '\n');
    await rename(`${journal}.tmp`, journal);
    await rename(home, previous);
  }
  try { await rename(staging, home); }
  catch (error) {
    if (backedUp) {
      await rename(previous, home);
      await rm(journal);
    }
    throw error;
  }
  if (backedUp) await rm(journal);
  return home;
}

module.exports = { migrateRuntimeHome };

if (require.main === module) {
  (async () => {
    const { values } = parseArgs({ options: { resources: { type: 'string' }, home: { type: 'string' } } });
    if (!values.resources || !values.home) throw new Error('Usage: node migrations/run.cjs --resources <runtime> --home <DSH_HOME> (quit Agent first)');
    process.stdout.write(await migrateRuntimeHome(values.resources, values.home) + '\n');
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
