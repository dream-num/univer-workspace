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
on the default branch. Enter `selection` as JSON and leave `dry_run=true`
to validate without publishing:

```json
{"batchId":"workspace-cli-0.7.1","packages":[{"name":"univer-workspace-cli","version":"0.7.1","tag":"latest"}]}
```

Use the already-published exact Insider version. This caller permits only
`univer-workspace-cli`; repositories with authority for other packages can reuse
the same shared actions and pass multiple entries. Keep this workflow filename
and repository unchanged for the existing npm Trusted Publisher identity.

[release-actions](https://github.com/dream-num/release-actions) owns the promotion
implementation. Its read-only `assemble-npm-batch` action downloads the exact
Insider archives, checks SHA-512 and package name/version, and pins the result
in a manifest. This does not independently verify historical build provenance.
`promote-npm` receives the same manifest, runs the Insider dependency/policy
dry-run for the full selection, and verifies all archives against the pinned
digests before any submission. It never rebuilds the package or retires the
Insider version. Archive downloads do not receive the Insider credential.

For `latest`, the exact stable version must match the current Insider `latest`.
A missing public version is submitted with the requested tag; an existing
version is only reused if its bytes match. For the `latest` target, an identical
existing version can have its public `latest` moved, which also requires
[OIDC dist-tag permission](https://docs.npmjs.com/adding-dist-tags-to-packages/).
Reuse with other tags does not move those tags. Submit mode requires a separately
authorized public release and explicit `dry_run=false`. The GitHub-hosted workflow
pins npm and uses OIDC; only the Insider policy dry-run uses the Insider token.
The public subprocess does not inherit that token. New public versions request
provenance covering the submitted tarball and promotion workflow, not the earlier
build. Reuse cannot add provenance to an existing version.

## Submission and public verification are separate

The workflow uploads `batch-result.json` (not the original tarballs). Submission
records per-package results and does not claim public visibility. Verify the exact
public version, tag, integrity and provenance independently. An upload error may
have an unknown outcome; check npm instead of blindly retrying. There is no
automatic retirement of the Insider artifact.

The tests in `test-cli-promotion.yml` verify the Workspace-specific manual dispatch
and default-branch guard and exercise the actual shared action references with
two synthetic packages, including an Insider digest change. They do not use live
credentials or write to registries. Generic promotion-engine tests live in
`release-actions`; Workspace retains its Insider build and publisher tests.
