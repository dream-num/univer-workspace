import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** Derive the packaged production closure from the same audited npm install lock. */
export function productionLock(source, sourceLock) {
  const { name, version, license, dependencies, engines } = source;
  const lock = { ...sourceLock, packages: Object.fromEntries(Object.entries(sourceLock.packages).filter(([path, entry]) => path && !entry.dev)) };
  lock.packages[''] = { name, version, license, dependencies, engines };
  return lock;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = JSON.parse(await readFile('package.json', 'utf8'));
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  await writeFile('runtime-lock.json', JSON.stringify(productionLock(source, lock), null, 2) + '\n');
}
