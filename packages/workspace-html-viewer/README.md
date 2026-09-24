# Workspace HTML Viewer

Private React adapter shared by Workspace Browser and Workspace Agent.
Import from `@univerjs/univer-workspace-html-viewer`; this package is not published.

## Responsibilities

`WorkspaceHtmlViewer` mounts the published SDK's `renderHtmlView` in a div. The SDK
owns the sandboxed iframe, embedded iframe program, connection protocol, bindings,
inspection panel, hover popovers and highlights. Consumers do not install a renderer
Vite plugin or provide iframe scripts.

This package adapts SDK state to React callbacks, provides metadata from authorized
source engines, and exposes the view's save and inspection controls through a ref:

- `inspect.open()` / `inspect.close()` toggle the built-in inspection UI.
- `onInspectChanged(boolean)` keeps the host's toolbar toggle in sync.
- `prepareToLeave()` commits drafts, waits for saving and pauses page writes; hosts
  keep the component mounted until it succeeds. Failures leave the page usable.
- `hasPendingChanges()` includes drafts, writes and collaboration confirmation.

Applications supply HTML source, an accessible title, `locale` (`zh-CN` or `en-US`),
an external resource allowlist and a stable `loadEngine(unitId, signal)` callback.
Locale defaults to English and is applied at page creation. Changing the UI language
alone does not recreate a live page or discard its edits; reopen the page to apply
that language to SDK inspection UI.

Inspection metadata reads workbook and sheet names from the same loaded, authorized
engine used by the page. It never loads a second engine or bypasses authorization.
Unavailable names use the SDK's `id: xxx` fallback.

## Host responsibilities

- Fetch Blob contents and resolve source Unit identities and permissions.
- Resolve identity, license, permissions and collaboration endpoints, and inject
  the reference policy into `createWorkspaceHtmlEngine`.
- Present errors, an inspection toggle and browser unload protection.
- Await `prepareToLeave()` before leaving; changing source/loader or unmounting
  disposes the old view and is not an async save guard.
- Implement route/tab/account lifecycle. Current hosts dispose the view after a
  successful departure preparation.

The `/engine` export owns the shared Univer runtime factory: base plugins, identity and
license installation, read-only write enforcement, metadata from the loaded workbook,
and abort/load/disposal lifecycle. Consumers supply resolved permissions, collaboration
endpoints, network configuration and `registerEmbed(univer)` for their referenced-Unit
policy. SDK dependencies remain peers, using each consumer’s runtime.

All binding writes first reject an anonymous identity (`user.anonymous`), then
check source edit permission. `HtmlViewWriteError.code` identifies the reason;
`translateError(code)` uses the host's current UI language to produce its message
before the SDK serializes it for the iframe. Web and Agent own their Chinese and
English dictionary entries. Translation callbacks read the current language without
recreating the engine or losing pending edits when the UI language changes.

No HTTP requests, credential storage, DSH services or routes belong here.
`workspace-ui` remains the owner of generic controls and icons.

Web uses its route blocker. Agent's current Sidecar has no asynchronous close
hook; its adapter keeps a stable mounted iframe while saving after native close,
and retains a visible recovery surface when saving fails. A browser/process exit
or account reload cannot guarantee saving; existing account fences remain active.

## React and validation

Local development pins React and React DOM together at 18.3.1 to keep automatically
installed SDK peers on the same renderer. The component uses React 18-compatible APIs and the consumer's React runtime
(Web 19, Agent 18). SDK packages are peers so each application's dependency graph
supplies its own versions. Web also deduplicates these SDK peers at its Vite
composition root, preventing this package’s React 18 development graph from
introducing another SDK/DI instance into the React 19 application.
Do not import an application's internal modules here.

Run `pnpm --filter @univerjs/univer-workspace-html-viewer test` and `typecheck`,
then both consumers' typechecks and builds for shared changes. The Agent browser
fixture exercises the published SDK's rendering, inspection, live subscriptions,
editing, and retention on save failure:

```bash
pnpm --filter dsh-univer-workspace-plugin exec vite --config test/vite.html-view.config.ts
```

Open `http://127.0.0.1:5184/test/fixtures/html-view.html` (add `?lang=zh-CN` for Chinese).
It uses in-memory Sheet values and no credentials or remote data. The Web resource
fixture is documented in [Workspace README](../../apps/workspace/README.md#沉浸视图).
