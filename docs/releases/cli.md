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

## Promote an Insider package to public npm

Run **Promote insider package to public npm (manual)** (`promote-cli-public.yml`)
on the default branch. Select `univer-workspace-cli` in **package**, enter an
exact **version**, and leave **dry_run** enabled for read-only validation. Keep
**latest** enabled for a stable public `latest`; disable it to use `promoted`
for a new version. Validation and submission use the same inputs.

Use the already-published exact Insider version. This caller permits only
`univer-workspace-cli`; repositories with authority for other packages can reuse
the same shared actions and pass multiple entries. Keep this workflow filename
and repository unchanged for the existing npm Trusted Publisher identity.

[release-actions](https://github.com/dream-num/release-actions) owns the promotion
implementation. The first step reads exact Insider version metadata and passes its expected
SHA-512 to `promote-npm` without downloading a package. The promotion Action
validates the Insider cohort plan, downloads each original archive once, and
checks the bytes and embedded package identity against those expected values. In submit mode it uploads those same bytes, without another download,
rebuild or repack. No one copies a plan or hash between workflow runs. Archive
downloads do not receive the Insider credential. This checks the package being
promoted, not independent historical build provenance.

For `latest`, the exact stable version must match the current Insider `latest`.
A missing public version is submitted with the requested tag; an existing
version is only reused if its bytes match. For the `latest` target, an identical
existing version can have its public `latest` moved, which also requires
[OIDC dist-tag permission](https://docs.npmjs.com/adding-dist-tags-to-packages/).
Reuse with other tags does not move those tags. Submit mode requires a separately
authorized public release. Run the same input with `dry_run=false` to submit.
The GitHub-hosted workflow
pins npm and uses OIDC; only the Insider policy dry-run uses the Insider token.
The public subprocess does not inherit that token. New public versions request
provenance covering the submitted tarball and promotion workflow, not the earlier
build. Reuse cannot add provenance to an existing version.

## Submission and public verification are separate

The workflow uploads `batch-result.json` with the checked digest, not the original tarballs. Submission
records per-package results and does not claim public visibility. Verify the exact
public version, tag, integrity and provenance independently. An upload error may
have an unknown outcome; check npm instead of blindly retrying. There is no
automatic retirement of the Insider artifact.

Workspace's standard `test-cli` CI job checks the manual dispatch, default-branch
guard, shared Action wiring, and Insider build/publisher scripts. The shared Action
repository owns the no-write test that assembles and validates two synthetic
packages and rejects a same-version change in the Insider tarball.
