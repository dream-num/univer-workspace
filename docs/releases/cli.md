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

## Promote one insider package to public npm

Run **Promote insider package to public npm (manual)** (`promote-cli-public.yml`)
on the repository's default branch. Choose `package` from the dropdown (currently
`univer-workspace-cli`), enter its exact version, choose `latest`, and keep
`dry_run=true` for validation. Both validation and publication require the default
branch before any insider credential is made available.

The workflow and `scripts/release/promote-cli-public.mjs` can be copied together to
another repository without changing the script: only edit the workflow's package
option list. The script accepts unscoped and scoped npm package names, encodes them
for registry requests, and verifies the running repository and default-branch
workflow context dynamically. It has no Workspace application dependencies.

Validation calls the insider Promotion API with exactly one `{name, version}` and
`dryRun=true`, requires a completed matching plan, then downloads and verifies the
original tarball, manifest identity, and SHA-512 integrity. The API performs source
version policy and public dependency checks; it has no destination-tag or `latest`
request parameter. Its source-tag checks apply even when `latest=false`. The workflow
never requests non-dry-run server-side Promotion, which would write through insider
and retire the source. This workflow retains the source and publishes directly using
npm OIDC. It neither rebuilds/repackages artifacts nor promotes dependencies.

Insider metadata is read from the complete package packument's `versions[version]`;
its `/package/version` route redirects to public npm and is not an insider version
lookup. Original tarballs may redirect from insider to the deployment's public
OSS origin `https://insider-npm.oss-cn-shenzhen.aliyuncs.com`. These two HTTPS
origins form an explicit allowlist, not an assumed destination: each target comes
from the actual `Location` header, without rewriting or assuming a storage path.
Downloads are credential-free, HTTPS-only,
limited to three redirects, and reject loops, userinfo, queries and other origins.
The original SHA-512 and package manifest are verified after download. A storage
origin change requires code review; metadata and authenticated dry-run requests
still reject redirects. Diagnostics report the failing stage and safe transport
code, without printing credentials or arbitrary server/error bodies.

`latest` defaults to **true** and has these explicit semantics:

- **false, new public version:** publish with `--tag=promoted`, including the first
  version of a package. Verify `promoted` and unchanged `latest` in the separate read-only operation.
- **false, existing public version:** verify identical original-package integrity,
  reuse it, and leave dist-tags unchanged. This does not remove an existing `latest`.
- **true:** require a stable `X.Y.Z` equal to insider's current `latest`, so an
  rc/beta source cannot bypass the source latest-policy check. Publish a missing
  version with `--tag=latest`. For an identical existing version whose public
  `latest` differs, actually run `npm dist-tag add <name>@<version> latest` then separately verify
  `latest`; if it already matches, no write is needed. A failed write fails submission; public version, integrity and tag verification is separate.

The validation step uses the existing insider `NPM_TOKEN` repository secret only
for the insider dry-run request. After separately authorizing a public release,
select the default branch and explicitly set `dry_run=false`. The GitHub-hosted
Node 24 runner uses pinned **npm 11.21.0** for both publishing and dist-tag changes.
The public subprocess receives OIDC context, no npm token or user/checkout npm
configuration, and executes no artifact lifecycle scripts. Explicit flags override
an original insider `publishConfig.registry` or `publishConfig.tag` without changing
its bytes. CI artifacts bind package, exact version, latest intent, repository,
workflow, commit, run/attempt, and original tarball hash, and record verified results.

Each selected npm package needs its own externally configured Trusted Publisher for
the destination repository and filename `promote-cli-public.yml`. Public publication
requires direct-publish permission; updating `latest` on an existing version also
requires the separate **Allow npm dist-tag** permission. This workflow changes
neither npm nor GitHub permissions. See [npm's dist-tag/OIDC requirements](https://docs.npmjs.com/adding-dist-tags-to-packages/).
Validation-only runs do **not** verify either public write permission or clear npm's
pending validation. A no-write reuse also does not verify OIDC write authority.
OIDC authentication is independent of provenance. New public versions explicitly
request provenance and require a public publishing repository matching the original
package's `repository` metadata. The subprocess retains `RUNNER_ENVIRONMENT` for
npm's builder identity. This attests the promotion workflow/commit and tarball hash,
not the full earlier insider build; it neither rebuilds nor modifies the tarball.
Existing versions are reused without republishing or retroactively adding provenance.
The local loopback test disables signing only in its fixture; actual Sigstore/OIDC
acceptance must be verified on a separately authorized new-version publication.

The isolated release-script tests (including a loopback-only npm upload) run in
`test-cli-promotion.yml`, separately from the manual release workflow, on pull
requests touching the promotion workflows or release scripts and on matching main
pushes. They use no registry credentials or public writes:

```bash
node --test scripts/release/*.test.mjs
```

The test workflow uses `pull_request.paths` for isolated policy tests when release
code changes. The release workflow has only `workflow_dispatch` and no test job. Path-filtered workflows
should not be required universally for merging, since unrelated changes skip them.
These in-workflow guards prevent accidental invocation, not a repository writer
from changing the workflow itself. Required reviews/checks and protected deployment
environments are separate repository policies; this workflow does not configure them.

## Submission and public verification are separate

A successful npm upload command returns `submitted`, not proof of public availability.
The promotion run saves `submission.json` with the original hash, requested tag and
previous latest value, then ends without a post-upload registry read. An existing
identical version returns `reused`; `tagUpdated` records any requested latest command.
Neither result claims `publicRegistryWriteVerified` or `latestVerified`.

Public visibility is a separate read-only follow-up, outside the promotion command
and workflow. An npm upload failure may have an unknown outcome. There is no
cross-run duplicate-submission gate; do not resubmit to resolve pending review.
Inspect npm status separately. No poller or notification service is added.
