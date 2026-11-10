import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildPackageReadme } from '../scripts/package-readme.mjs';

const licensing = 'Internal Desktop test package: includes the existing Workspace application development license as a Host-only fallback. A nonempty UNIVER_LICENSE overrides it. This does not extend its validity or authorized scope.';

const minimal = [
  '## Install',
  '',
  'Install the tarball in Plugins, then cold-restart DSH.',
  '',
  '## Update',
  '',
  'Remove the bundle, install the new tarball, cold-restart.',
  '',
  '## Uninstall',
  '',
  'Remove the bundle and restart.',
].join('\n');

// The shipped document must keep these sections and must not carry
// development commands. These are document rules, not packaging guards.
const REQUIRED_INSTALLATION_SECTIONS = [
  '## Install',
  '## Update',
  '## Uninstall',
];

const FORBIDDEN_PACKAGE_MARKERS = [
  'npm ci',
  'npm run build',
  'pnpm --filter',
  'package-lock.json',
  'node test/live',
];

function linkTargets(markdown) {
  return [...markdown.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
}

test('the package README is generated from the installation document', () => {
  const readme = buildPackageReadme({ version: '0.18.4-preview.1', instructions: minimal, licensing });
  assert.match(readme, /^# Space Plugin 0\.18\.4-preview\.1/);
  assert.ok(readme.includes(licensing));
  assert.ok(readme.includes('proof-of-concept package'));
});

test('missing or empty inputs fail loudly', () => {
  assert.throws(
    () => buildPackageReadme({ version: '0.18.4-preview.1', instructions: '', licensing }),
    /Missing in-package installation document/,
  );
  assert.throws(
    () => buildPackageReadme({ version: '0.18.4-preview.1', instructions: '   \n\t\n', licensing }),
    /Missing in-package installation document/,
  );
  assert.throws(
    () => buildPackageReadme({ version: '', instructions: minimal, licensing }),
    /Package version is required/,
  );
  assert.throws(
    () => buildPackageReadme({ version: '0.18.4-preview.1', instructions: minimal, licensing: '' }),
    /Package licensing note is required/,
  );
});

test('the packaged README keeps a single top-level heading', () => {
  const readme = buildPackageReadme({
    version: '0.18.4-preview.1',
    instructions: '# Space Plugin installation\n\n## Install\n\nInstall it.\n',
    licensing,
  });
  const headings = readme.split('\n').filter((line) => /^#{1,6}\s/.test(line));
  assert.equal(headings.filter((line) => /^#\s/.test(line)).length, 1);
  assert.ok(headings.includes('## Space Plugin installation'));
});

test('the shipped installation document keeps the required sections', async () => {
  const instructions = await readFile(new URL('../docs/installation.md', import.meta.url), 'utf8');
  for (const section of REQUIRED_INSTALLATION_SECTIONS) assert.ok(instructions.includes(section));
});

test('the shipped installation document carries no development commands', async () => {
  const instructions = await readFile(new URL('../docs/installation.md', import.meta.url), 'utf8');
  for (const marker of FORBIDDEN_PACKAGE_MARKERS) {
    assert.ok(!instructions.includes(marker), `installation document must not contain ${marker}`);
  }
});

test('the shipped installation document only links absolute public or official URLs', async () => {
  const instructions = await readFile(new URL('../docs/installation.md', import.meta.url), 'utf8');
  for (const target of linkTargets(instructions)) {
    assert.ok(
      target.startsWith('https://') || target.startsWith('http://') || target.startsWith('#'),
      `installation document must not use a local relative path: ${target}`,
    );
  }
});

test('the packager reads docs/installation.md instead of slicing a README heading', async () => {
  const source = await readFile(new URL('../scripts/package.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes('docs/installation.md'), 'the packager must read docs/installation.md');
  assert.ok(source.includes('buildPackageReadme'), 'the packager must generate the README');
  assert.ok(
    !source.includes("split('## Release candidate"),
    'the packager must not slice the README by heading',
  );
  assert.ok(
    !source.includes('## Release candidate'),
    'the packager must not depend on a Release candidate heading',
  );
});
