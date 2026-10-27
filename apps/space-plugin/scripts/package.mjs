import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { scanRelease } from './scan-release.mjs';

const root = resolve('../..');
const output = process.argv[2] && resolve(process.argv[2]);
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
  const readme = await readFile('README.md', 'utf8');
  const instructions = readme.split('## TASK-010 release candidate\n')[1];
  if (!instructions) throw new Error('Missing customer installation instructions.');
  await writeFile(join(stage, 'README.md'), '# Space Plugin 0.17.3 release candidate\n\n' + instructions.trim() + '\n');
  await cp('../../LICENSE', join(stage, 'LICENSE'));
  const notices = ['Space Plugin third-party notices', '', 'DSH and React are provided by the official Host. Univer Pro features require the operator\'s valid runtime license. No runtime license is included.', ''];
  for (const name of Object.keys({ ...source.devDependencies, ...dependencies }).filter(name => /^@univer|^lucide|^rxjs|^zustand|^immer/.test(name)).sort()) {
    const pkg = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'));
    notices.push(`${name}@${pkg.version} — ${pkg.license ?? 'See upstream package license'} — ${typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? pkg.homepage ?? ''}`);
  }
  await writeFile(join(stage, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n') + '\n');
  // Freeze the audited production closure; packaging must not resolve new
  // transitive versions. DSH's manager still owns its separate profile lock.
  const runtimeLock = await readFile('runtime-lock.json', 'utf8');
  const lock = JSON.parse(runtimeLock);
  const entries = value => JSON.stringify(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  if (lock.name !== name || lock.version !== version || entries(lock.packages?.['']?.dependencies) !== entries(dependencies))
    throw new Error('Update and audit runtime-lock.json for the changed release manifest before packaging.');
  await writeFile(join(stage, 'npm-shrinkwrap.json'), runtimeLock);
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
} finally {
  await rm(stage, { recursive: true, force: true });
}
