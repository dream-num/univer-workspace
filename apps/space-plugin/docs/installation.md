# Space Plugin installation

This package is a proof-of-concept preview for evaluation, not a production release.
The target Host version is official DSH 0.2.2-rc.1. The navigation adapter recognizes
the published Web build 0.2.2-rc.1 / c59d10a. Desktop 0.2.2-rc.1 installation and
native return-flow acceptance remain pending.

Space runs inside official DeepSeek Harness (DSH), connects to a Workspace service, and
lets you browse your files, edit Univer Docs and Sheets, and chat with an AI alongside an
open document. It is an optional way to use Workspace inside DSH, not a replacement for
the separate Workspace Agent Desktop application. Use non-critical documents while
evaluating it.

The package contains no second DSH runtime and no local Workspace Server.

## Requirements

- Official DeepSeek Harness Desktop 0.2.2-rc.1, installed from the official DeepSeek
  Harness project: https://github.com/deepseek-ai/deepseek-harness
- A Workspace service and a Workspace account. The default service is
  `https://space.univer.ai/`; DSH Settings → Workspace owns the account, Switch
  Account, Sign Out and Custom Workspace URL.
- Free port 3101 on the loopback interface for the OAuth return.

## Install

1. Obtain the downloaded `.tgz` package and verify its checksum with
   `shasum -a 256 -c SHA256SUMS` on macOS or `sha256sum -c SHA256SUMS` on Linux.
2. In DSH, open Plugins, choose Add plugin and paste the tarball's path into
   Package name or address, then install.
3. Fully quit DSH and start it again.

On a fresh profile pnpm blocks the transitive protobufjs@7.6.6 postinstall until
explicitly approved. In the official installer, verify that this is the listed package
and choose Allow these scripts and retry. This is the normal dependency trust step, not a
peer-warning failure. The exact published postinstall reads dependency metadata and
prints a version-scheme warning; it downloads no executable. Do not globally enable all
dependency scripts.

## Update

For updates, remove the existing `dsh-space-plugin` bundle first, install the new exact
tarball and cold-restart DSH; verify the checksum first. Uninstall by removing
`dsh-space-plugin` in Plugins and restarting.

Hot reinstall can encounter official Host module-identity diagnostics, so it is not the
supported update procedure.

## Uninstall

Remove `dsh-space-plugin` in Plugins and restart DSH. Uninstalling also removes the
navigation adapter. Workspace documents remain on the Server; native conversation
history stays DSH-owned.

## First use

Select Space and choose Sign in to Univer. Sign in and authorize in the system browser;
successful authorization loads Space Home. The Host credential provider persists only the
plugin's own grant; the client receives no cookie or token. DSH model credentials and
native Sessions remain owned by DSH. A denied, cancelled or expired request can be
retried. Switching accounts uses the browser's Workspace account; sign out or choose the
desired account there before authorizing.

## Where to get the package

There is no public Space GitHub Release yet. The current temporary entry is the
**Space Plugin** GitHub Actions workflow artifact, which contains a `.tgz` package,
`SHA256SUMS` and `build-info.json`, and is retained by Actions for 30 days:
https://github.com/dream-num/univer-workspace/actions/workflows/space-plugin-build.yml

Download and extract it from the successful GitHub Actions run, verify the checksum, then
install the tarball as described under [Install](#install). These workflow artifacts are
builds for review, not GitHub Releases or npm publications.

The planned distribution channel is a GitHub Prerelease built from a `space-plugin-v`
tag. Until that prerelease exists, use the workflow artifact above.

## Server requirements

The Server must run the matching release commit (including the Review/Apply fixes), as
one writer process against persistent product SQLite, collaboration SQLite and Blob
storage. Back up those stores together. Stop the old writer before upgrading; never
reset the database. Remote services require HTTPS/WSS, the registered public OAuth
client `univer-workspace-harness` with consent and `identity session` scopes, and
reverse-proxy support for /api, /universer-api and collaboration WebSocket upgrade. The
plugin expects a service origin, not an API path.

The existing cloud registration accepts the exact loopback return
`http://127.0.0.1:3101/auth/oauth/callback`. Custom Server administrators must register
the same exact callback. The plugin binds only IPv4 loopback for the pending
authorization and closes it on completion, cancellation or timeout. Keep that port
free; a conflicting listener produces a retryable sign-in error, never a fallback
credential form. Native Desktop external-browser forwarding and the return link require
separate acceptance on 0.2.2-rc.1. An OS/browser confirmation may appear for the return
link. No `univer-workspace://` scheme or DSH account grant is used.

Multi-Unit SDK merges are per-Unit, not a cross-Unit transaction; Space's current-document
Agent edit targets one Doc or Sheet.

Administrator details, backup procedure and license configuration are documented in the
administration guide of the repository:
https://github.com/dream-num/univer-workspace/blob/main/apps/space-plugin/docs/administration.md

## License in this package

Desktop test packages include the repository's existing Workspace application license in
Host-only `lib/runtime-license.json`, so a normal Desktop launch does not need terminal
environment variables. A nonempty UNIVER_LICENSE can override the packaged value. The
existing authenticated owner-only runtime config route supplies it to the official
LicensePlugin; it is not saved in client preferences or included in Agent context.
Packaging does not extend its scope or expiry.

The package also carries third-party notices for the shipped dependencies.

## Known limitations

**Native Conversation focus on official DSH 0.2.2-rc.1** is still captured from Host
state after inbox insertion, rather than at the send gesture. A selection update still
in transit can therefore leave an earlier target in that message's snapshot. Generation
ordering and the native sending phase do not close this window. Exact native send
binding requires a supported per-attempt snapshot/admission API from DSH; composer
blocks and pre-step hooks do not provide it. This is a known POC risk: ordinary chat may
act on an earlier document or selection. Check the target and the result when trying AI
edits. The separate **Ask for change** control captures its SDK selection at activation
and retains the existing target, content, permission and revision checks, and it is the
more predictable path for a scoped edit, but it does not remove the ordinary-chat risk
described above.

Reliable offline writing is not enabled. While disconnected, new content edits pause
until reconnection. The SDK's queued-online-change recovery remains enabled.

History remains unaccepted. Favorites remains unavailable. Space Move/Trash/Restore need
a separate lifecycle extension and are not implemented.

## More documentation

- Repository and source code: https://github.com/dream-num/univer-workspace
- Univer product documentation: https://docs.univer.ai/
- Developer guide, detailed behavior reference and test scripts:
  https://github.com/dream-num/univer-workspace/blob/main/apps/space-plugin/docs/development.md
- Administrator guide:
  https://github.com/dream-num/univer-workspace/blob/main/apps/space-plugin/docs/administration.md
