# Space plugin rules

## Contribution guidelines

Agent 的职责是实现已经确定的产品契约，而不是通过改变产品契约让代码变得容易实现。

对于有成熟参考实现的功能，优先复用现有实现；对于有真实产品参考的交互，优先忠实执行参考设计。

技术约束可以触发产品决策讨论，但不能自动授权 Agent 改变产品行为。

交付完成的依据是用户可观察的功能和交互通过验收，而不是代码编译通过、测试数量增加，或 Agent 自己宣布完成。

## Engineering rules

- Preserve the approved menu and interaction contract even when a capability is incomplete. Technical constraints require a product decision, not unilateral deletion, hiding, renaming, moving, global View Only or disabled-button test passes. Reuse existing Workspace APIs, workflows, Hooks, SDKs and Facades; the old Workspace Agent UI remains excluded as a design reference.
- UI types are Docs, Sheets, Slides, Canvas, Relational Table and Pages; Pages retain the Workspace HTML View identity.
- All content UI names, creation labels and runtime classifications come from `src/content-types.ts`. Row More, right-click and file identity menus share `FileActions`. Human lifecycle writes reuse Server Node/Resource/Blob/Trash workflows; retain fresh Server capabilities and stable Resource/Unit identities.
- Pages use the Fork's shared formal HTML Viewer/engine in this application's isolated peer graph, not a script-free replacement iframe. Run its prepare-to-leave protocol even before pending drafts reach the host, drain the complete HTTP pipeline and resume the same sandbox if departure is cancelled. Keep the public pointer services needed by globally loaded Sheets UI Facade observers in the headless source runtime.
- Keep the application here, in the Univer Workspace fork. Never modify official DSH source.
- Use React function components, TypeScript and scoped Tailwind utilities for the shell. Disable Tailwind preflight. Shell resets must not reach Univer or native Conversation descendants. Keep the SDK global-reset scoping build step and published-CSS isolation test.
- Keep Docs / Sheets on published, version-matched Univer UI presets; no static-preview replacement.
- DSH owns all Agent sessions, messages, composer, tool execution and tool logs. Use public slots, SessionProvider and the Conversation factory; no second chat, Agent or generic gateway.
- Current Page identity is automatically and visibly associated with the selected native Session, with a remove action. Use the public DSH runtime-context and native Composer slots; read bodies only through registered Workspace tools and current Server ACLs. Association is not proof of an actual read.
- This phase exposes read tools only. Future Agent writes require Worktree isolation, user Review and explicit merge authorization. Never write directly to trunk.
- Preserve isolated npm/React 18 and exact coupled Univer SDK versions. Do not patch node_modules, add skipLibCheck, import unpublished SDK paths or unify this graph with Workspace Browser React 19.

- DSH Tools must remain a type-only development dependency here. Register the existing public JSON Schema ToolDefinitions without installing a second Tools service in the Host profile. Preserve the checked contract fixture and packaging test; do not copy a Host registry, scheduler or runtime into the plugin.
- Floating chat geometry is plugin-owned; its transcript, composer, model controls, running state and durable messages remain DSH-owned. Keep one native Conversation tree through compact/minimized states.
