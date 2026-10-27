import { spawnSync } from 'node:child_process';
import { globSync, realpathSync } from 'node:fs';
let failed = false;
const covered = new Set();
for (const target of ['host', 'client']) {
  const files = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', `tsconfig.${target}.json`, '--listFilesOnly'], { encoding: 'utf8' });
  if (files.status !== 0) throw new Error(`Cannot enumerate ${target} typecheck inputs.`);
  for (const path of files.stdout.trim().split('\n')) covered.add(realpathSync(path));
  console.log(`Strict TypeScript: ${target}`);
  const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', `tsconfig.${target}.json`, '--pretty', 'false'], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}
for (const path of globSync('src/**/*.{ts,tsx}')) {
  if (!covered.has(realpathSync(path))) throw new Error(`Source excluded from strict checking: ${path}`);
}
console.log('All application TypeScript sources covered by Host / client programs.');
process.exitCode = failed ? 1 : 0;
