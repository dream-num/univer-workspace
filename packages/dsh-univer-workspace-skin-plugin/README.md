# dsh-univer-workspace-skin-plugin

The browser skin plugin for DSH in Univer Workspace Agent. It aligns the
DSH shell with the Univer Workspace brand.

## Responsibilities

- Look and feel only: overrides the DSH brand and business-accent theme
  tokens (`--dsw-alias-brand-primary`, `--dsw-alias-state-business-*`,
  `--dsw-specific-sidebar-nav-item-active-accent`) in both light and dark
  modes, replaces the sidebar/hero brand mark and name with the Workspace
  logo and the fixed "Univer Workspace" product name, and repairs the browser
  favicon with the same static Workspace mark.
- The conversation hero reads the host locale and displays “与 AI 一起，完成每一份文档”
  or “Create and collaborate with AI” through the public hero-brand slot. DSH
  0.1.5-rc.1 has no headline slot: one isolated structural CSS rule hides the
  adjacent upstream headline/Preview group. Remove that rule when DSH provides
  a headline slot; no hashed class names or upstream source patches are used.

The token overrides target only the brand/accent aliases; static neutral and
semantic state tokens stay with the DSH design system so layout and status
colors keep their intended meaning.

## Non-responsibilities

- Any behavior: authentication, sessions, navigation, or capability UI
  belong to the harness core and the capability plugin.
- Publication: this is a private workspace package consumed by the harness
  profile build, never published to npm.

## Build

`pnpm build` emits `lib/index.js` (empty host bundle, required by the dsh
row loader) and `lib/client.js` (browser bundle).
