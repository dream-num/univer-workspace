# Space plugin rules

## Contribution guidelines

The agent implements the agreed product contract. Never change the contract to make the code
easier to write.

When a feature has a mature reference implementation, reuse it. When an interaction has a real
product reference, follow the reference design faithfully.

A technical constraint can start a product decision discussion. It never authorizes the agent to
change product behavior on its own.

Work is done when the user-observable features and interactions pass acceptance. Compiling code,
a growing test count, or the agent's own claim of completion is not acceptance.

## Engineering rules

- Desktop plugin packages must include the repository's existing Workspace license through the Host-only packaged runtime configuration. Use `npm run package:release`, require the scanner's exact source/license match, and verify the extracted package with `UNIVER_LICENSE` absent. Do not rely on a licensed development Host as proof of package completeness, log license values, or change the SDK's license validation.
- Preserve the approved menu and interaction contract even when a capability is incomplete. Technical constraints require a product decision, not unilateral deletion, hiding, renaming, moving, global View Only or disabled-button test passes. Reuse existing Workspace APIs, workflows, Hooks, SDKs and Facades; the old Workspace Agent UI remains excluded as a design reference.
- UI types are Docs, Sheets, Slides, Canvas, Relational Table and Pages; Pages retain the Workspace HTML View identity.
- All content UI names, creation labels and runtime classifications come from `src/content-types.ts`. Row More, right-click and file identity menus share `FileActions`. Human lifecycle writes reuse Server Node/Resource/Blob/Trash workflows; retain fresh Server capabilities and stable Resource/Unit identities.
- Pages use the Fork's shared formal HTML Viewer/engine in this application's isolated peer graph, not a script-free replacement iframe. Run its prepare-to-leave protocol even before pending drafts reach the host, drain the complete HTTP pipeline and resume the same sandbox if departure is cancelled. Keep the public pointer services needed by globally loaded Sheets UI Facade observers in the headless source runtime.
- Keep the application here, in the Univer Workspace fork. Never modify official DSH source.
- Use React function components, TypeScript and scoped Tailwind utilities for the shell. Disable Tailwind preflight. Shell resets must not reach Univer or native Conversation descendants. Keep the SDK global-reset scoping build step and published-CSS isolation test.
- Keep Docs / Sheets on published, version-matched Univer UI presets; no static-preview replacement.
- DSH owns all Agent sessions, messages, composer, tool execution and tool logs. Use public slots, SessionProvider and the Conversation factory; no second chat, Agent or generic gateway.
- Current Page identity is automatically and visibly associated with the selected native Session, with a remove action. Use the public DSH runtime-context and native Composer slots; read bodies only through registered Workspace tools and current Server ACLs. Association is not proof of an actual read.
- Preserve isolated npm/React 18 and exact coupled Univer SDK versions. Do not patch node_modules, add skipLibCheck, import unpublished SDK paths or unify this graph with Workspace Browser React 19.

- DSH Tools must remain a type-only development dependency here. Register the existing public JSON Schema ToolDefinitions without installing a second Tools service in the Host profile. Preserve the checked contract fixture and packaging test; do not copy a Host registry, scheduler or runtime into the plugin.
- Floating chat geometry is plugin-owned; its transcript, composer, model controls, running state and durable messages remain DSH-owned. Keep one native Conversation tree through compact/minimized states.
