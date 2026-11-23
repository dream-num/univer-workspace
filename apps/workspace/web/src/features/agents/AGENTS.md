# Browser Agents prompt cache

The Browser Agent resends the full model request on every step. Providers cache by prompt
prefix, so a change to any earlier token recomputes everything after it. These rules keep the
prefix stable for the whole session.

- The first run of a session stores the full system message and the model tool definitions as
  the session record's optional `modelSnapshot` in IndexedDB. Later runs reuse it and never
  rewrite it. A record without one gets it once, on its next run. Tool calls still go to the live
  MCP gateway by name, and a tool the gateway has removed returns a tool error result.
- Within a session, the tool list, the system prompt, and the history already sent stay
  byte-identical. The system prompt holds only what is known when the session starts. Runtime
  state such as Worktree IDs, counts, and timestamps belongs in tool results in the history.
- History is append-only. Never rewrite, truncate, or reorder it.
- Users may change mode, scope, model, and thinking between turns. Report a mode or scope change
  only in a `<system-reminder>` text part at the end of that turn's user message. A model or
  thinking change costs one cache miss, and that is the user's choice.
- `runtime/runner.test.ts` asserts that the snapshot survives gateway releases and reloads, and
  that the system prompt stays the same after a new pull request appears. When you change prompt assembly or message conversion, keep it passing and confirm on
  the session page that the cache hit rate did not drop. In Debug mode, the Trajectory tab shows
  the Context sent and the history rewrite count.
