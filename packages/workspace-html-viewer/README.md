# Workspace HTML Viewer

Private React HTML View host shared by Workspace Browser and Workspace Agent.
Import from `@univerjs/univer-workspace-html-viewer`; this package is not published.

## Responsibilities

`WorkspaceHtmlViewer` composes the published HTML parser and renderer SDK. It
owns the sandboxed iframe, per-navigation handshake token, MessagePort validation,
Binding Host lifecycle, and cancellation on teardown. It forwards errors and
collaboration status and exposes `flush()` and `hasPendingChanges()` through its ref.
It permits script and form events in an opaque-origin sandbox, blocks native
form submission, and takes the external resource allowlist from its consumer.

Applications supply HTML source, localized title, bundled SDK runtime, and a
stable `loadEngine(unitId, signal)` callback. Each build registers the renderer's
`htmlViewRuntime()` Vite plugin and imports `virtual:html-view-runtime`.

## Host responsibilities

- Fetch Blob contents and resolve source Unit identities and permissions.
- Resolve identity, license, permissions and collaboration endpoints, and inject
  the reference policy into `createWorkspaceHtmlEngine`.
- Present errors and interpret collaboration status for leave protection.
- Keep the component mounted while awaiting `flush()` before leaving; changing
  source/loader or unmounting disposes the old Host and is not an async save guard.
- Implement route/tab/account lifecycle and browser unload protection.

The `/engine` export owns the shared Univer runtime factory: base plugins, identity and
license installation, read-only write enforcement, and abort/load/disposal lifecycle.
Consumers supply resolved permissions, collaboration endpoints, network configuration
and `registerEmbed(univer)` for their referenced-Unit policy. SDK dependencies remain
peers, using each consumer’s runtime.

All binding writes first reject an anonymous identity (`user.anonymous`) with
“当前为访客模式，请登录后再操作”, then check source edit permission. Consumers pass identity and permissions,
not error messages; signed-in read-only users retain the source read-only error.

No HTTP requests, credential storage, DSH services or routes belong here. The SDK owns binding syntax, subscriptions and the communication
protocol. `workspace-ui` remains the owner of generic controls and icons.

Web uses its route blocker. Agent's current Sidecar has no asynchronous close
hook; its adapter keeps a stable mounted iframe while saving after native close,
and retains a visible recovery surface when saving fails. A browser/process exit
or account reload cannot guarantee saving; existing account fences remain active.

## React and validation

The component uses React 18-compatible APIs and the consumer's React runtime
(Web 19, Agent 18). SDK packages are peers so each application's dependency graph
supplies its own versions. Web also deduplicates these SDK peers at its Vite
composition root, preventing this package’s React 18 development graph from
introducing another SDK/DI instance into the React 19 application.
Do not import an application's internal modules here.

Run `pnpm --filter @univerjs/univer-workspace-html-viewer test` and `typecheck`,
then both consumers' typechecks and builds for shared changes. The Agent browser
fixture exercises the actual SDK handshake, live subscriptions, editing, and
retention on save failure:

```bash
pnpm --filter dsh-univer-workspace-plugin exec vite --config test/vite.html-view.config.ts
```

Open `http://127.0.0.1:5184/test/fixtures/html-view.html`. It uses in-memory Sheet
values and no credentials or remote data. The Web resource fixture is documented
in [Workspace README](../../apps/workspace/README.md#沉浸视图).
