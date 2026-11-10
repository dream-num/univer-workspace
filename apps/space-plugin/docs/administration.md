# Space Plugin administration guide

This guide covers the operator duties behind the Space plugin: the Server it expects,
the OAuth registration it needs, the data you must back up, and how the runtime license
is configured. Installation steps live in [installation.md](installation.md); technical
behavior and tests live in [development.md](development.md).

Space is a proof-of-concept preview for evaluation, not a production release. The target
Host version is official DSH 0.2.2-rc.1. The navigation adapter recognizes the published
Web build 0.2.2-rc.1 / c59d10a. Desktop 0.2.2-rc.1 installation and native return-flow
acceptance remain pending.

## Server

The Server must run the matching release commit (including the Review/Apply fixes), as
one writer process against persistent product SQLite, collaboration SQLite and Blob
storage. Back up those stores together. Stop the old writer before upgrading; never
reset the database. Remote services require HTTPS/WSS, the registered public OAuth
client `univer-workspace-harness` with consent and `identity session` scopes, and
reverse-proxy support for /api, /universer-api and collaboration WebSocket upgrade. The
plugin expects a service origin, not an API path. Multi-Unit SDK merges are per-Unit,
not a cross-Unit transaction; Space's current-document Agent edit targets one Doc or
Sheet.

The plugin ships no local Workspace Server and no second DSH runtime. All document data
stays on the Server you connect it to.

## OAuth registration

The existing cloud registration accepts the exact loopback return
`http://127.0.0.1:3101/auth/oauth/callback`. The plugin binds only IPv4 loopback for the
pending authorization and closes it on completion, cancellation or timeout. Keep that
port free; a conflicting listener produces a retryable sign-in error, never a fallback
credential form. Custom Server administrators must register the same exact callback.

The authenticated public DSH Connection starts/cancels requests; the loopback listener
accepts only bounded, state-matched OAuth callbacks. Native Desktop external-browser
forwarding and the return link require separate acceptance on 0.2.2-rc.1. An
OS/browser confirmation may appear for the return link. No `univer-workspace://` scheme
or DSH account grant is used.

Register the public OAuth client `univer-workspace-harness` with the `consent` and
`identity session` scopes, and register the exact loopback callback above. The plugin
expects a service origin, not an API path.

## Accounts and sessions

First use: select Space and choose Sign in to Univer. Sign in and authorize in the
system browser; successful authorization loads Space Home. DSH Settings → Workspace
manages the current account and server, Switch Account, Sign Out and Custom Workspace
URL. Session reuse uses the official Host credential provider's isolated
`dsh-space-plugin/workspace` grant record. Only that record is changed; DSH model
credentials and native Sessions remain owned by DSH. A denied, cancelled or expired
request can be retried. Switching accounts uses the browser's Workspace account; sign
out or choose the desired account there before authorizing.

## Backup and upgrade

Back up the product SQLite, collaboration SQLite and Blob storage together; they are
one consistent set. Stop the old writer process before upgrading, then start the new one
against the same stores. Never reset the database as an upgrade or recovery step.

## License configuration

Desktop test packages include the repository's existing Workspace application license
in Host-only `lib/runtime-license.json`, so a normal Desktop launch does not need
terminal environment variables. A nonempty UNIVER_LICENSE can override the packaged
value. The existing authenticated owner-only runtime config route supplies it to the
official LicensePlugin; it is not saved in client preferences or included in Agent
context. Packaging does not extend its scope or expiry.

The packager reads the license from the repository source and the matching Exchange
verification key, and writes both into the Host-only packaged runtime configuration.
Packaging and the resource scan fail if that file is missing or differs from the current
source. No license value is written to build logs or committed generated files.

The license's existing scope and expiry still apply; the SDK remains responsible for
validation.

## Dependency trust

On a fresh profile pnpm blocks the transitive protobufjs@7.6.6 postinstall until
explicitly approved. In the official installer, verify that this is the listed package
and choose Allow these scripts and retry. This is the normal dependency trust step, not
a peer-warning failure. The exact published postinstall reads dependency metadata and
prints a version-scheme warning; it downloads no executable. Do not globally enable all
dependency scripts.

The release script stages only runtime files, a production-only manifest, notices and
npm-shrinkwrap.json. npm consumers honor that lock; DSH's pnpm manager owns its profile
lock and needs registry access. Preserve the profile lock for exact reinstall. Run the
release scan and actual clean-profile install before distributing a new artifact.

## Release gates

There is no public Space GitHub Release yet. The current temporary entry is the **Space
Plugin** GitHub Actions workflow artifact, which contains
`space-plugin-<version>-<short-sha>.tgz`, `SHA256SUMS` and `build-info.json`, and is
retained by Actions for 30 days. These workflow artifacts are builds for review, not
GitHub Releases or npm publications.

The planned distribution channel is a GitHub Prerelease built from a `space-plugin-v`
tag. Until that prerelease exists, use the workflow artifact.

Desktop 0.2.2-rc.1 installation and native return-flow acceptance remain pending.

## Reproducing the demo

Reproduce the demo with a disposable Team Space and two accounts: create a Folder and
all six content types; rename/move/trash/restore a file; edit Docs/Sheets from both
clients; share with the second account and add a comment. Associate a Doc with the native
conversation, ask the Agent to append a unique paragraph to a private Worktree and mark
it ready, inspect Review, explicitly Apply, and verify the already-open second client and
a reopen. Repeat with a Sheet formula, Reject, and a shared edit after Review; verify the
SDK merge/conflict behavior and persisted result. Viewer / removed-member writes must
fail. No test fixture, model credential or private Session archive is included.
