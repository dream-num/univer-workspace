# CLI release operations

This document is for release maintainers. Installation and usage belong in the
[CLI user guide](../../apps/cli/README.md). Run all commands below from the repository root.

## Build and release to insider-npm


Creating or pushing a tag never starts CI or publishes a package. In GitHub
Actions, manually run **Build and release CLI (manual)**:

- Stable: select the existing `vX.Y.Z` tag as the workflow ref
  and enter the matching `X.Y.Z` version. The commit must be contained in `main`.
- Insiders: select `main` and enter `X.Y.Z-insider.<suffix>`.

The old `release-cli.yml` workflow is disabled in repository Actions settings;
keep it disabled so historical tags cannot reactivate its tag-push release path.
The replacement workflow is `release-cli-manual.yml`.

The channel is derived from the version; there is no channel input.
`dry_run` defaults to true. Explicitly set `dry_run=false` to publish the
verified tarball to insider-npm. The source manifest remains `0.0.0`; public npm promotion
and Workspace deployment are separate operations.

## Promote an existing stable CLI to public npm

Run **Promote CLI to public npm (manual)** (`promote-cli-public.yml`) with the exact
stable `X.Y.Z` already present on insider-npm. `publish` defaults to **false**:
validation calls the insider Promotion API with `dryRun=true`, checks the completed
CLI-only plan (including version policy and public dependency availability), then
downloads the original tarball and verifies its integrity and package identity.
Any rejection stops the run. It neither rebuilds the CLI nor promotes dependencies.

The validation step uses the existing insider `NPM_TOKEN` repository secret only
for the insider dry-run request. It is not passed to the public npm subprocess.
After reviewing validation evidence, an explicitly authorized public release can
select the default branch and set `publish=true`. A GitHub-hosted Node 24 runner
publishes that exact tarball using npm Trusted Publishing/OIDC, with no npm token
or lifecycle scripts. Explicit npm flags override the original tarball's insider
`publishConfig.registry` without changing its bytes. The publisher checks the public
exact version and integrity; an identical existing version is reused without a write.
The internal version is retained. CI artifacts and the job summary record the result.

Configure npm's Trusted Publisher for organization `dream-num`, repository
`univer-workspace`, and filename `promote-cli-public.yml`. Validation-only runs do
**not** verify public write authority or clear npm's pending validation: that requires
a separately authorized successful real publish. OIDC authentication is independent
of provenance; this original-artifact promotion explicitly disables provenance and
does not require changing repository visibility.

The isolated release tests (including a loopback-only npm upload) run on pull
requests touching the promotion workflow or release scripts, without registry
credentials or public writes:

```bash
node --test scripts/release/*.test.mjs
```
