# dsh-univer-workspace-skin-plugin

The browser skin plugin for DSH in Univer Workspace Harness. It aligns the
DSH UI with the Workspace brand — theme token overrides (`--dsw-alias-*`)
and the sidebar brand slot with the Workspace logo and product name.

## Responsibilities

- Look and feel only: colors, typography, logo, and brand naming of the
  DSH shell when deployed as Univer Workspace Harness.

## Non-responsibilities

- Any behavior: authentication, sessions, navigation, or capability UI
  belong to the harness core and the capability plugin.
- Publication: this is a private workspace package consumed by the harness
  profile build, never published to npm.

## Build

`pnpm build` emits `lib/index.js` (empty host bundle, required by the dsh
row loader) and `lib/client.js` (browser bundle).
