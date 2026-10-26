# Space plugin rules

- Keep the application here, in the Univer Workspace fork. Never modify official DSH source.
- Use React function components, TypeScript and scoped Tailwind utilities for the shell. Disable Tailwind preflight. Shell resets must not reach Univer or native Conversation descendants. Keep the SDK global-reset scoping build step and published-CSS isolation test.
- Keep Docs / Sheets on published, version-matched Univer UI presets; no static-preview replacement.
- DSH owns all Agent sessions, messages, composer, tool execution and tool logs. Use public slots, SessionProvider and the Conversation factory; no second chat, Agent or generic gateway.
- Current Page identity is automatically and visibly associated with the selected native Session, with a remove action. Use the public DSH runtime-context and native Composer slots; read bodies only through registered Workspace tools and current Server ACLs. Association is not proof of an actual read.
- This phase exposes read tools only. Future Agent writes require Worktree isolation, user Review and explicit merge authorization. Never write directly to trunk.
- Preserve isolated npm/React 18 and exact coupled Univer SDK versions. Do not patch node_modules, add skipLibCheck, import unpublished SDK paths or unify this graph with Workspace Browser React 19.

- DSH Tools must remain a type-only development dependency here. Register the existing public JSON Schema ToolDefinitions without installing a second Tools service in the Host profile. Preserve the checked contract fixture and packaging test; do not copy a Host registry, scheduler or runtime into the plugin.
- Floating chat geometry is plugin-owned; its transcript, composer, model controls, running state and durable messages remain DSH-owned. Keep one native Conversation tree through compact/minimized states.
