import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function scanRelease(file) {
  const source = await readFile('../../apps/workspace/web/src/features/editor/features/license.ts', 'utf8');
  const licenseMatch = source.match(/export const UNIVER_LICENSE\s*=\s*(["'])([^"']+)\1/);
  if (!licenseMatch) throw new Error('Workspace application development license not found.');
  const credential = licenseMatch[2];
  const env = { ...process.env, LC_ALL: 'C' };
  const names = execFileSync('tar', ['-tzf', file], { encoding: 'utf8', env }).trim().split('\n');
  const findings = [], files = [], upstreamStrings = [];
  let packagedLicense = false;
  for (const name of names) {
    if (name.split('/').some(part => part === '..') || !/^package\/(?:lib\/.+|package\.json|README\.md|LICENSE|THIRD_PARTY_NOTICES\.txt|cordis\.patch\.yml|npm-shrinkwrap\.json)$/.test(name)) {
      findings.push({ file: name, kind: 'unexpected-resource' }); continue;
    }
    const data = execFileSync('tar', ['-xOf', file, name], { maxBuffer: 100 * 1024 * 1024, env });
    if (name === 'package/lib/runtime-license.json') {
      let config;
      try { config = JSON.parse(data); } catch { /* Report no credential text. */ }
      if (config?.scope !== 'internal-desktop-test' || config?.license !== credential)
        findings.push({ file: name, kind: 'unexpected-packaged-license' });
      else packagedLicense = true;
    }
    for (const [kind, value] of [
      ['development-license', credential], ['absolute-local-path', '/Users/'],
      ['checkout-path', resolve('../..')], ['github-runner-path', '/home/runner/work/'],
      ['github-container-path', '/github/workspace/'],
      ['private-test-path', '/private/tmp/task'], ['test-path', '/tmp/task'],
      ['debug-service', 'ws://127.0.0.1:8000/'], ['temporary-instrumentation', 'TASK010_PREVIEW_'],
    ]) if (data.includes(value)) {
      if (kind === 'development-license' && name === 'package/lib/runtime-license.json') continue;
      if (kind === 'debug-service' && name.startsWith('package/lib/render-runtime/assets/')) {
        upstreamStrings.push({ file: name, kind: 'unchanged-upstream-render-development-endpoint' });
        continue;
      }
      findings.push({ file: name, kind });
    }
    if (name === 'package/package.json') {
      const manifest = JSON.parse(data);
      if (manifest.devDependencies || manifest.scripts || Object.values(manifest.dependencies).some(value => value.startsWith('file:')))
        findings.push({ file: name, kind: 'development-manifest' });
    }
    files.push({ path: name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
  }
  if (!packagedLicense) findings.push({ kind: 'missing-desktop-test-license' });
  if (findings.length) throw new Error('Release scan failed: ' + JSON.stringify(findings));
  const data = await readFile(file);
  return { artifact: file.split('/').at(-1), bytes: (await stat(file)).size, sha256: createHash('sha256').update(data).digest('hex'), files, findings, upstreamStrings, licensing: 'internal-desktop-test',
    notes: ['No credential value is printed.', 'Core SDK localhost:5173 is a URL-validator special case, not a service destination.'] };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Pass the release tarball path.');
  console.log(JSON.stringify(await scanRelease(resolve(process.argv[2])), null, 2));
}
