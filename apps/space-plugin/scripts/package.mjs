import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, relative, isAbsolute } from 'node:path';

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
  for (const file of ['lib', 'cordis.patch.yml', 'README.md']) await cp(file, join(stage, file), { recursive: true });
  await cp('../../LICENSE', join(stage, 'LICENSE'));
  const notices = ['Space Plugin third-party notices', '', 'DSH and React are provided by the official Host. Univer Pro features require the operator\'s valid runtime license. No runtime license is included.', ''];
  for (const name of Object.keys({ ...source.devDependencies, ...dependencies }).filter(name => /^@univer|^lucide|^rxjs|^zustand|^immer/.test(name)).sort()) {
    const pkg = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'));
    notices.push(`${name}@${pkg.version} — ${pkg.license ?? 'See upstream package license'} — ${typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? pkg.homepage ?? ''}`);
  }
  await writeFile(join(stage, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n') + '\n');
  // npm consumers get the complete runtime closure. DSH's pnpm manager owns
  // its profile lock; its actual installation is verified separately.
  execFileSync('npm', ['install', '--package-lock-only', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit' });
  const lock = JSON.parse(await readFile(join(stage, 'package-lock.json'), 'utf8'));
  await writeFile(join(stage, 'npm-shrinkwrap.json'), JSON.stringify(lock, null, 2) + '\n');
  execFileSync('npm', ['pack', '--pack-destination', output], { cwd: stage, stdio: 'inherit' });
} finally {
  await rm(stage, { recursive: true, force: true });
}
