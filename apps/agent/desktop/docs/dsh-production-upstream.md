# DSH production browser artifacts: upstream investigation

Checked 2026-09-12 against official DeepSeek Harness source and releases. This is
an investigation, not a claim that Desktop startup meets its performance budget.

## Current upstream behavior

The newest published GitHub release inspected is
[`dsh-v0.1.5-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.2),
published 2026-09-10 and marked prerelease. Its client module package manifest is
[`@deepseek-ai/dsh-client-modules@0.1.5-rc.2`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/packages/client/modules/package.json).
The only public branch returned by the GitHub branches API was `master`, at
[`c291e7961a515f6d7af9304e7fd1d257929aef26`](https://github.com/deepseek-ai/deepseek-harness/commit/c291e7961a515f6d7af9304e7fd1d257929aef26).
Release and master differ, so observations below were checked against both module
implementations. GitHub release recency alone does not identify npm dist tags.

Neither implementation exposes a source-map production switch. The official
[package README](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/client/modules/README.md#build-requirements)
explicitly says: “The package accepts no plugin config of its own.” Its constructor
takes only `ctx`, and the composition path has no `NODE_ENV` or other environment
condition. Setting `NODE_ENV=production` cannot disable this path.

The implementation still does all of the following:

- Reads and parses each available authored map when capturing a bundle.
- Builds an indexed source map eagerly for every combo; when an authored map is
  absent, `identitySectionMap` includes the complete generated JavaScript in
  `sourcesContent` and constructs a mapping for its lines.
- Hashes the combined JavaScript and indexed map for startup combo revisions.
- Builds both startup combo responses and individual plugin responses every time
  `compose()` runs after changed plugin entries.

Sources: [release implementation](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/packages/client/modules/src/index.ts#L299-L389),
[master map construction](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/client/modules/src/index.ts#L323-L356),
[master composition](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/client/modules/src/index.ts#L650-L697),
and [official subsystem contract](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/docs/subsystems/client-modules.md#the-bundle-route-and-index-injection).
Deleting installed `.map` files therefore removes shipped files but does not stop
runtime map generation. No browser request for a map is necessary to incur it.

There are existing upstream optimizations, but they do not eliminate this work:
[`9c3a0893`](https://github.com/deepseek-ai/deepseek-harness/commit/9c3a0893f622620bd9016bfabb95ddcfd07cf18b)
defers initial per-plugin revision hashing, while
[`83463aa8`](https://github.com/deepseek-ai/deepseek-harness/commit/83463aa89627575b205a438c521458bddd9df771)
introduces bounded combo URLs. Current initial per-plugin revisions include a
process nonce; combo revisions still hash bytes and maps.

The repository's [GitHub metadata](https://api.github.com/repos/deepseek-ai/deepseek-harness)
reported issues and pull requests disabled. A repository issue search for
`sourcemap` returned no results. This establishes no public fix found in the
inspected release/source; it says nothing about private upstream work.

## A fixed Desktop profile can compose public APIs

There is no dedicated published prebuilt-cache importer or source-map disable
option in the inspected client module service. However, its existing public
exports permit the application to capture generated browser output during
packaging and serve that fixed output at runtime. This is an application-owned
static delivery composition, not an upstream cache mode.

The relevant APIs are present in both `0.1.5-rc.2` and the inspected master:

| API | Supported role |
| --- | --- |
| `ClientModuleRegistry.graph(): WebBootGraph` | Read the current composed graph. |
| `ClientModuleRegistry.fetchBundle(request: Request): Response` | Obtain an advertised revisioned JavaScript/map response without a Web server. |
| `bootInjections(graph: WebBootGraph): IndexInjection[]` | Produce the official queue, preload, bootstrap and graph injection rows. |
| `WebServer.register({ kind, path, handler })` | Let the composing application serve its fixed artifact routes. |
| `webserver/index-inject` event | Contribute the official injection rows while retaining other live application injections. |

Sources: [release exports and bootstrap helper](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/packages/client/modules/src/index.ts#L474),
[release response API](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/packages/client/modules/src/index.ts#L607),
[master module service contract](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/docs/subsystems/client-modules.md#the-service),
and [Web server composition contract](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/host/webserver/README.md#registering-routes).

Implementation constraints inferred from those contracts:

1. Capture only after the final profile has settled (`ctx.loader.await()`), with
   production-only rows selected. Upstream itself uses this readiness barrier
   before announcing its Web URL; see
   [web-app readiness](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/bundle/web-app/src/index.ts).
2. Disable the `client-hmr` profile row before capture and runtime. Its public
   configuration only changes the polling interval, and its host plugin requires
   `clientModules` and `webServer`; see
   [HMR source](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/client/hmr/src/index.ts#L26-L38).
3. Replace the host registry's activation with the application static-serving
   plugin at runtime, while retaining the original client-modules browser entry
   in the captured graph. The browser derives its plugin tree from the graph,
   independently of the runtime host Loader roster; see
   [browser boot](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/client/web/src/boot.ts)
   and [graph parsing](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/client/modules/src/client/manifest.ts).
4. Use `bootInjections` rather than copying its queue implementation or privately
   patching registry methods. Preserve live authentication, connection and other
   index injections; do not cache an authenticated HTML page.
5. Export JavaScript only for production, strip its source-map directive during
   application artifact finalization, and do not expose a map response. Bind
   immutable response identities to the finalized bytes. This transforms build
   output; it does not require editing installed DSH implementation files.
6. Bind captured output to the final package inventory and effective client
   profile. Changing installed plugins, client declarations or active browser
   rows requires rebuilding the artifacts. A stale graph must fail explicitly;
   the inspected upstream service provides no cache validation API for the
   application. Ordinary runtime settings need not invalidate artifacts unless
   they alter the browser roster or bundle bytes.
7. Relocate and boot the actual packaged result in verification. Check every
   advertised script, browser readiness, rejected map requests, and that the
   dynamic registry/HMR host plugins are absent. A passing Linux check does not
   establish Windows installation or first-launch timings.

## Host service consumers

A GitHub code search for `clientModules` in this pinned source found these
functional host consumers outside the module registry:

- [`client-hmr`](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/client/hmr/src/index.ts)
  requires the service and must be omitted.
- [`client-modules/invariant`](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/client/modules/src/invariant.ts)
  checks `ctx.get('clientModules')` and deliberately returns when absent.
- Upstream [`apps/desktop-host`](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/apps/desktop-host/src/index.ts)
  requires the registry and forwards asset requests to `fetchBundle`. Workspace's
  existing Node CLI plus HTTP desktop shell is a different composition and does
  not use that upstream desktop host.

The ordinary upstream `web-app` host glue does not consume `clientModules`.
This audit supports a fixed HTTP Desktop composition without a fake replacement
`clientModules` service. It does not guarantee future DSH versions have the same
consumer set; recheck when upgrading the pinned packages.
