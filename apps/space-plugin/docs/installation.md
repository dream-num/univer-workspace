# Space Plugin installation

This package is a proof-of-concept preview for evaluation, not a production release. The
target Host version is official DSH 0.2.2-rc.1. Space runs inside official DeepSeek
Harness (DSH), connects to a Workspace service, and lets you browse your files, edit
Univer Docs and Sheets, and chat with an AI alongside an open document. It is an optional
way to use Workspace inside DSH, not a replacement for the separate Workspace Agent
Desktop application. Use non-critical documents while evaluating it.

## Requirements

- Official DeepSeek Harness Desktop 0.2.2-rc.1, installed from the official DeepSeek
  Harness project: https://github.com/deepseek-ai/deepseek-harness
- A Workspace service and a Workspace account. The default service is
  `https://space.univer.ai/`. DSH Settings → Workspace owns the account, Switch Account,
  Sign Out and Custom Workspace URL.
- Free port 3101 on the loopback interface for the sign-in return.

## Get the package

Look for a Space Plugin release first. On the repository's GitHub Releases page, find a
prerelease whose tag starts with `space-plugin-v`, then download that version's `.tgz`
package and its `SHA256SUMS` file:
https://github.com/dream-num/univer-workspace/releases

If no Space Plugin version is available there yet, use the **Space Plugin** GitHub Actions
workflow artifact from a successful build run instead. Download and extract it; it
contains a `.tgz` package, `SHA256SUMS` and `build-info.json`. Downloading Actions
artifacts requires a GitHub login, and Actions retains them for 30 days, so treat this
route as a temporary evaluation entry:
https://github.com/dream-num/univer-workspace/actions/workflows/space-plugin-build.yml

## Install

1. Verify the downloaded package with `shasum -a 256 -c SHA256SUMS` on macOS or
   `sha256sum -c SHA256SUMS` on Linux.
2. In DSH, open Plugins, choose Add plugin and paste the tarball's path into Package name
   or address, then install.
3. Fully quit DSH and start it again.

On a fresh profile the installer asks you to approve a dependency build script for
`protobufjs@7.6.6`. Check that this is the listed package, choose Allow these scripts and
retry. This is the normal dependency trust step, not a peer-warning failure. Do not
globally enable all dependency scripts.

## First use

Select Space and choose Sign in to Univer. Sign in and authorize in the system browser;
successful authorization loads Space Home. If sign-in fails because port 3101 is already
in use, free that port and retry. A denied, cancelled or expired request can also be
retried. Switching accounts uses the browser's Workspace account: sign out or choose the
desired account there before authorizing.

## Update

For updates, remove the existing `dsh-space-plugin` bundle first, install the new exact
tarball and cold-restart DSH; verify the checksum first. Hot reinstall can encounter
official DSH module-identity diagnostics, so it is not the supported update procedure.

## Uninstall

Remove `dsh-space-plugin` in Plugins and restart DSH. Uninstalling also removes the
navigation adapter. Your data is not deleted: Workspace documents remain on the Server,
and native conversation history stays with DSH.

## License

The packaged desktop license keeps its existing authorized scope and expiry; packaging
does not extend either. A normal Desktop launch needs no extra terminal configuration.

## Known limitations

- On DSH 0.2.2-rc.1, ordinary chat may act on an earlier document or selection than the
  one you are looking at. Check the target and the result when trying AI edits. The
  separate **Ask for change** control captures its selection when you activate it and is
  the more predictable path for a scoped edit, but it does not remove the ordinary-chat
  risk.
- Reliable offline writing is not enabled. While disconnected, new content edits pause
  until reconnection.
- History remains unaccepted, Favorites remains unavailable, and Space Move/Trash/Restore
  are not implemented.

## Self-hosted servers and further reading

If you run your own Workspace service, its Server version, OAuth registration, backup and
license setup are described in the administrator guide:
https://github.com/dream-num/univer-workspace/blob/main/apps/space-plugin/docs/administration.md

The developer guide carries the detailed behavior reference:
https://github.com/dream-num/univer-workspace/blob/main/apps/space-plugin/docs/development.md

Repository and source code: https://github.com/dream-num/univer-workspace ·
Univer product documentation: https://docs.univer.ai/
