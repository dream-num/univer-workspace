import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(import.meta.url), '../../../..');
const releaseWorkflow = readFileSync(join(repositoryRoot, '.github/workflows/space-plugin-release.yml'), 'utf8');
const buildWorkflow = readFileSync(join(repositoryRoot, '.github/workflows/space-plugin-build.yml'), 'utf8');

const fixtureDirectories = [];

after(() => {
  for (const directory of fixtureDirectories) rmSync(directory, { recursive: true, force: true });
});

/**
 * Extract the bash block of the `validate` step so the test exercises exactly
 * the script the workflow runs, without a second copy that can drift.
 */
function extractValidateScript() {
  const lines = releaseWorkflow.split('\n');
  const idIndex = lines.findIndex((line) => /^\s*id:\s*validate\s*$/.test(line));
  assert.ok(idIndex >= 0, 'validate step id not found');
  const runIndex = lines.findIndex((line, index) => index > idIndex && /^\s*run:\s*\|\s*$/.test(line));
  assert.ok(runIndex >= 0, 'validate run block not found');
  const body = [];
  let indent = null;
  for (const line of lines.slice(runIndex + 1)) {
    if (line.trim() === '') {
      body.push('');
      continue;
    }
    const current = line.match(/^\s*/)[0].length;
    if (indent === null) indent = current;
    if (current < indent) break;
    body.push(line.slice(indent));
  }
  assert.ok(body.length > 0, 'validate run block is empty');
  return body.join('\n');
}

const validateScript = extractValidateScript();

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Release Gate',
      GIT_AUTHOR_EMAIL: 'release-gate@example.invalid',
      GIT_COMMITTER_NAME: 'Release Gate',
      GIT_COMMITTER_EMAIL: 'release-gate@example.invalid',
    },
  }).trim();
}

/**
 * Build a throwaway repository that mirrors the release preconditions:
 * a tagged commit, an `origin/main` remote-tracking ref and a package manifest.
 */
function createFixture({ version = '0.18.4-preview.1', tag = 'space-plugin-v0.18.4-preview.1' } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'space-release-gate-'));
  fixtureDirectories.push(directory);
  git(directory, ['init', '--quiet', '--initial-branch=main']);
  mkdirSync(join(directory, 'apps/space-plugin'), { recursive: true });
  writeFileSync(join(directory, 'apps/space-plugin/package.json'), `${JSON.stringify({ name: 'dsh-space-plugin', version }, null, 2)}\n`);
  git(directory, ['add', '.']);
  git(directory, ['commit', '--quiet', '-m', 'release candidate']);
  const head = git(directory, ['rev-parse', 'HEAD']);
  git(directory, ['update-ref', 'refs/remotes/origin/main', head]);
  if (tag) git(directory, ['tag', tag, head]);
  return { directory, head, tag };
}

function runValidate({ directory, head, tag, refType = 'tag', refName = tag, sha = head, defaultBranch = 'main' }) {
  const scriptPath = join(directory, 'validate.sh');
  writeFileSync(scriptPath, validateScript);
  const outputPath = join(directory, 'github-output.txt');
  writeFileSync(outputPath, '');
  const result = spawnSync('bash', [scriptPath], {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_REF_NAME: refName,
      GITHUB_REF_TYPE: refType,
      GITHUB_SHA: sha,
      GITHUB_OUTPUT: outputPath,
      DEFAULT_BRANCH: defaultBranch,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    outputs: readFileSync(outputPath, 'utf8'),
  };
}

test('the release workflow validates an existing preview tag on the default branch', () => {
  const fixture = createFixture();
  const result = runValidate(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.outputs, /^version=0\.18\.4-preview\.1$/m);
  assert.match(result.outputs, /^tag=space-plugin-v0\.18\.4-preview\.1$/m);
  assert.match(result.outputs, new RegExp(`^commit=${fixture.head}$`, 'm'));
});

test('the release workflow rejects a branch ref', () => {
  const fixture = createFixture();
  const result = runValidate({ ...fixture, refType: 'branch', refName: 'main' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must run from an existing space-plugin-vX\.Y\.Z-preview\.N tag/);
});

test('the release workflow rejects a tag without the space-plugin prefix', () => {
  const fixture = createFixture({ tag: 'v0.18.4-preview.1' });
  const result = runValidate(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unexpected tag name/);
});

test('the release workflow rejects a stable tag without the preview suffix', () => {
  const fixture = createFixture({ tag: 'space-plugin-v0.18.4' });
  const result = runValidate(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unexpected tag name/);
});

test('the release workflow rejects a tag whose version differs from the package', () => {
  const fixture = createFixture();
  const result = runValidate({ ...fixture, refName: 'space-plugin-v0.18.5-preview.1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match the Space Plugin package version/);
});

test('the release workflow rejects a commit that is not contained in the default branch', () => {
  const fixture = createFixture();
  git(fixture.directory, ['checkout', '--quiet', '-b', 'feature']);
  writeFileSync(join(fixture.directory, 'apps/space-plugin/extra.txt'), 'unmerged\n');
  git(fixture.directory, ['add', '.']);
  git(fixture.directory, ['commit', '--quiet', '-m', 'unmerged change']);
  const head = git(fixture.directory, ['rev-parse', 'HEAD']);
  git(fixture.directory, ['tag', '--force', fixture.tag, head]);
  const result = runValidate({ ...fixture, head, sha: head });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not contained in the default branch/);
});

test('the release workflow rejects a workflow commit that is not the checkout', () => {
  const fixture = createFixture();
  const result = runValidate({ ...fixture, sha: '0'.repeat(40) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checkout does not match the workflow commit/);
});

test('the publish job owns the only write permission and refuses to clobber releases', () => {
  assert.match(releaseWorkflow, /^permissions:\n  contents: read$/m);
  const writePermissions = releaseWorkflow.match(/contents: write/g) ?? [];
  assert.equal(writePermissions.length, 1);
  assert.match(releaseWorkflow, /publish:\n(?:.*\n)*?    if: \$\{\{ !inputs\.dry_run \}\}/);
  assert.match(releaseWorkflow, /gh release create "\$TAG_NAME" \\\n\s+--verify-tag \\\n\s+--draft \\\n\s+--prerelease \\\n\s+--latest=false/);
  assert.match(releaseWorkflow, /gh release edit "\$TAG_NAME" --draft=false --prerelease --latest=false/);
  assert.doesNotMatch(releaseWorkflow, /--clobber/);
  assert.doesNotMatch(releaseWorkflow, /git tag /);
  assert.match(releaseWorkflow, /public preview/);
  assert.doesNotMatch(releaseWorkflow, /internal evaluation/);
});

test('the verify job always runs with read permissions and gates the publish job', () => {
  const verifyJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf('\n  verify:\n'),
    releaseWorkflow.indexOf('\n  publish:\n'),
  );
  assert.ok(verifyJob.length > 0, 'verify job not found');
  assert.match(verifyJob, /needs:\n\s+- validate\n\s+- build/);
  assert.doesNotMatch(verifyJob, /if:/);
  assert.doesNotMatch(verifyJob, /dry_run/);
  assert.match(verifyJob, /permissions:\n\s+contents: read/);
  assert.doesNotMatch(verifyJob, /contents: write/);
  assert.match(verifyJob, /actions\/download-artifact@v4/);
  assert.match(verifyJob, /sha256sum -c SHA256SUMS/);
  assert.match(verifyJob, /build-info\.json matches the reviewed build outputs/);

  const publishJob = releaseWorkflow.slice(releaseWorkflow.indexOf('\n  publish:\n'));
  assert.match(publishJob, /needs:\n\s+- validate\n\s+- build\n\s+- verify/);
  assert.match(publishJob, /if: \$\{\{ !inputs\.dry_run \}\}/);
  assert.match(publishJob, /permissions:\n\s+contents: write/);
});

test('the workflow states that a failed publish can leave a draft behind', () => {
  const comments = releaseWorkflow
    .split('\n')
    .filter((line) => /^\s*#/.test(line))
    .map((line) => line.replace(/^\s*#\s?/, ''))
    .join(' ');
  assert.match(comments, /a failure after the draft is created can leave that draft behind/);
  assert.match(comments, /an operator must inspect the existing draft and decide what to do with it/);
  assert.match(comments, /never deletes or overwrites a release/);
  assert.doesNotMatch(releaseWorkflow, /gh release delete/);
});

test('the build workflow exposes the reviewed artifact through workflow_call', () => {
  assert.match(buildWorkflow, /workflow_call:/);
  for (const output of ['artifact_name', 'filename', 'version', 'sha256']) {
    assert.match(
      buildWorkflow,
      new RegExp(`${output}:\\n\\s+description: [^\\n]+\\n\\s+value: \\$\\{\\{ jobs\\.build\\.outputs\\.${output} \\}\\}`),
    );
    assert.match(buildWorkflow, new RegExp(`\\$\\{\\{ steps\\.package\\.outputs\\.${output} \\}\\}`));
  }
  assert.match(releaseWorkflow, /uses: \.\/\.github\/workflows\/space-plugin-build\.yml/);
});
