import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { scanRelease } from './scan-release.mjs';

const root = resolve('../..');
const args = process.argv.slice(2);
// The user's Desktop packages must carry this repository's existing license.
if (args.length !== 1 || args[0].startsWith('--'))
  throw new Error('Pass an external output directory.');
const output = resolve(args[0]);
if (!output || !isAbsolute(relative(root, output)) && !relative(root, output).startsWith('..'))
  throw new Error('Pass a release output directory outside the source repository.');
await mkdir(output, { recursive: true });
const stage = await mkdtemp(join(tmpdir(), 'space-plugin-release-'));
try {
  const source = JSON.parse(await readFile('package.json', 'utf8'));
  const { name, version, type, description, main, exports: exported, dsh, dependencies, engines, license } = source;
  await writeFile(join(stage, 'package.json'), JSON.stringify({
    name, version, type, description, main, exports: exported, dsh, dependencies, engines, license,
    files: ['lib', 'cordis.patch.yml', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.txt', 'npm-shrinkwrap.json'],
  }, null, 2) + '\n');
  for (const file of ['lib', 'cordis.patch.yml']) await cp(file, join(stage, file), { recursive: true });
  // Always refresh from the repository; never inherit a stale packaged value.
  await rm(join(stage, 'lib/runtime-license.json'), { force: true });
  const licenseSource = await readFile('../../apps/workspace/web/src/features/editor/features/license.ts', 'utf8');
  const match = licenseSource.match(/export const UNIVER_LICENSE\s*=\s*(["'])([^"']+)\1/);
  if (!match) throw new Error('Workspace application development license not found.');
  const value = match[2];
  if (typeof value !== 'string' || !value.trim()) throw new Error('Workspace application development license is empty.');
  await writeFile(join(stage, 'lib/runtime-license.json'), JSON.stringify({ scope: 'internal-desktop-test', license: value }) + '\n');
  const readme = await readFile('README.md', 'utf8');
  const instructions = readme.split('## Release candidate\n')[1];
  if (!instructions) throw new Error('Missing customer installation instructions.');
  const licensing = 'Internal Desktop test package: includes the existing Workspace application development license as a Host-only fallback. A nonempty UNIVER_LICENSE overrides it. This does not extend its validity or authorized scope.';
  await writeFile(join(stage, 'README.md'), `# Space Plugin ${version} release candidate\n\n${licensing}\n\n` + instructions.trim() + '\n');
  await cp('../../LICENSE', join(stage, 'LICENSE'));
  const notices = ['Space Plugin third-party notices', '', 'DSH and React are provided by the official Host.', licensing, ''];
  for (const name of Object.keys({ ...source.devDependencies, ...dependencies }).filter(name => /^@univer|^lucide|^rxjs|^zustand|^immer/.test(name)).sort()) {
    const pkg = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'));
    notices.push(`${name}@${pkg.version} — ${pkg.license ?? 'See upstream package license'} — ${typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? pkg.homepage ?? ''}`);
  }
  await writeFile(join(stage, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n') + '\n');
  // Freeze the audited production closure; packaging must not resolve new
  // transitive versions. DSH's manager still owns its separate profile lock.
  const sourceLock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  const lock = { ...sourceLock, packages: Object.fromEntries(Object.entries(sourceLock.packages).filter(([path, entry]) => path && !entry.dev)) };
  lock.packages[''] = { name, version, license, dependencies, engines };
  const entries = value => JSON.stringify(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  if (sourceLock.name !== name || sourceLock.version !== version || entries(sourceLock.packages?.['']?.dependencies) !== entries(dependencies))
    throw new Error('Update package-lock.json for the changed release manifest before packaging.');
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (entry.link || entry.resolved?.startsWith('file:') || path.includes('@deepseek-ai/'))
      throw new Error('Production lock must not contain local dependencies or a second DSH cohort.');
  }
  await writeFile(join(stage, 'npm-shrinkwrap.json'), JSON.stringify(lock, null, 2) + '\n');
  execFileSync('npm', ['pack', '--pack-destination', stage], { cwd: stage, stdio: 'inherit' });
  const stagedPackage = join(stage, `${name}-${version}.tgz`);
  const scan = await scanRelease(stagedPackage);
  const destination = join(output, `${name}-${version}.tgz`);
  try { await copyFile(stagedPackage, destination, constants.COPYFILE_EXCL); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!(await readFile(stagedPackage)).equals(await readFile(destination)))
      throw new Error('Refusing to overwrite a different release artifact; use a fresh output directory.');
  }
  console.log(`Release resource scan passed: ${scan.files.length} files; SHA256 ${scan.sha256}`);
  await writeFile(join(output, 'package-inventory.json'), JSON.stringify(scan, null, 2) + '\n');
} finally {
  await rm(stage, { recursive: true, force: true });
}
