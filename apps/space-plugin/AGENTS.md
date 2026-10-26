# Space plugin rules

- Keep the application here, in the Univer Workspace fork. Never modify official DSH source.
- Use React function components, TypeScript and scoped Tailwind utilities for the shell. Disable Tailwind preflight. Shell resets must not reach Univer or native Conversation descendants. Keep the SDK global-reset scoping build step and published-CSS isolation test.
- Keep Docs / Sheets on published, version-matched Univer UI presets; no static-preview replacement.
- DSH owns all Agent sessions, messages, composer, tool execution and tool logs. Use public slots, SessionProvider and the Conversation factory; no second chat, Agent or generic gateway.
- Associate explicit stable file identities to an existing Session. Send references only; fetch bodies on demand through registered Workspace tools using authenticated Server ACLs. Opening is not selecting; submitting a reference is not proof of tool use.
- This phase exposes read tools only. Future Agent writes require Worktree isolation, user Review and explicit merge authorization. Never write directly to trunk.
- Preserve isolated npm/React 18 and exact coupled Univer SDK versions. Do not patch node_modules, add skipLibCheck, import unpublished SDK paths or unify this graph with Workspace Browser React 19.
