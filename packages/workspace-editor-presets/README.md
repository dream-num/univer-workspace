# Workspace editor presets

`@univerjs/univer-workspace-editor-presets` is a private package owning the
shared Univer editor preset composition used by Workspace Web and the Space
app: per-product preset factories and locale bundles for Sheets, Docs, Slides,
Boards and Bases, plus the cross-cutting pieces those editors need. It ships
TypeScript source, has no build step, and is not published to npm; each
consuming application compiles it in its own bundle.

## Why this package exists

Both browser hosts assemble the same editor capabilities for the same product
types. When each host composed its own preset list, the assembly code was
duplicated and the two plugin sets drifted apart between products. This package
is the shared composition point; it is not a claim that every host behavior was
moved here unchanged, since what is shared is the preset and plugin composition
rather than the surrounding product behavior.

## What it owns

| Capability | Where |
| --- | --- |
| Product preset factories and locale bundles | [`src/sheets.ts`](./src/sheets.ts), [`src/docs.ts`](./src/docs.ts), [`src/slides.ts`](./src/slides.ts), [`src/boards.ts`](./src/boards.ts), [`src/bases.ts`](./src/bases.ts) |
| Doc feature plugins | [`src/doc-features.ts`](./src/doc-features.ts) |
| Referenced-sheet plugins, embedded product runtime, read-only guard | [`src/referenced-sheets.ts`](./src/referenced-sheets.ts), [`src/embed-product-runtime.ts`](./src/embed-product-runtime.ts), [`src/read-only-guard.ts`](./src/read-only-guard.ts) |
| Base worker registration entry | [`src/base-worker.ts`](./src/base-worker.ts) |

Entry points are declared in [`package.json`](./package.json).

## Consumers

- [`apps/workspace`](../../apps/workspace/package.json) (`@univerjs/univer-workspace`,
  Workspace Web) — re-exports locales, comparison presets, referenced-sheet
  plugins and the read-only guard from
  [`web/src/features/editor/`](../../apps/workspace/web/src/features/editor/).
- [`apps/space-plugin`](../../apps/space-plugin/package.json) (`dsh-space-plugin`)
  — composes the presets in
  [`src/collaborative-editor.tsx`](../../apps/space-plugin/src/collaborative-editor.tsx),
  loads locales in
  [`src/editor-locales.ts`](../../apps/space-plugin/src/editor-locales.ts), and
  registers the Base worker through
  [`src/base-worker.ts`](../../apps/space-plugin/src/base-worker.ts).

## What the host owns

The host owns the editor container, the mount and dispose of that container,
locale selection, worker registration, collaboration wiring, and the SDK and
React dependency versions its own bundle resolves. The presets do not decide
permissions, routing, or product workflows.

This package is not a complete viewer, and sharing it does not unify all host
behavior: the two applications may still present different screens and actions
over the same presets.

## SDK and React

The Univer SDK baseline is 1.4.0, declared as peer dependencies. React is a
peer with the range `>=18 <20`; the React 19 development dependencies here
support package development and do not select a consuming application's runtime,
which resolves one matching React and React DOM pair.

## Verification

This package has no build script and no independent test script. Verify changes
through the consumers:

```bash
pnpm --filter @univerjs/univer-workspace typecheck
pnpm --filter @univerjs/univer-workspace test
pnpm --filter dsh-space-plugin typecheck
pnpm --filter dsh-space-plugin test
```

The Workspace unit tests cover the preset entry points: they mock the preset
subpaths and read the preset sources through `import.meta.resolve`.
