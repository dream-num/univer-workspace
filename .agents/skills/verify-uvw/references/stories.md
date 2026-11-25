# Agent principals and real-agent stories

Read this before a run that speaks as an agent principal or runs a real model with `story`. Run
`$V secret-check` before you quote or copy story evidence.

An agent principal is a User that never signed in. These commands speak as one; the `mcp` forms need [MCP mode](mcp-mode.md).

```bash
$V principal <name> [label]                # POST /api/agents; prints id and username
$V mcp --as <name> <label> <tool> [json]   # also mcp-tools, mcp-skills, mcp-resources, mcp-resource, mcp-instructions
$V mcp-oauth login <label> --guest         # scripted OAuth client that takes the guest agent card
$V story [--as <identity>] [--oauth] [--model <id[#effort]>] <label> mcp|uvw|codex '<prompt>'
```

`principal` keeps the token in `home/principals/<name>.token` (mode 0600) and never prints it;
`principal-<name>.json` in `$EVIDENCE` records id, username and expiry. Names match
`^[a-z0-9][a-z0-9_-]{0,31}$`; `human` means the run user. Every `principal`, `mcp-oauth login --guest`,
first `story --oauth` of an identity, and `uvw auth guest` a model runs creates an agent, and Workspace answers 429
past `AGENT_CREATE_LIMIT_PER_HOUR` creations per source IP per hour, which defaults to 5. `up` raises it to 100 and
records it as `AGENT_CREATE_LIMIT` in `run.env`; set `VERIFY_UVW_AGENT_CREATE_LIMIT=5` before `up` to run with the
default. `principal` refuses with the run's limit. `mcp-oauth login --guest` and `story --oauth` stop on the guest
card's hourly-limit text, which the server also shows when its fixed limit on client metadata checks per source trips.
`mcp --as` authenticates with the principal's PAT, excludes `--auth`, and matches the usage event
by `user_id`, because the PAT id is never returned. `mcp-oauth login --guest` needs no `user`. It
opens the authorize URL with no cookies, saves `<label>-guest-card.png`, continues through the
card, and replaces the grant in `home/mcp-oauth-*`, so `mcp --auth oauth` then speaks as that
guest. The run's browser stays signed in as the guest.

**Stories.** `story` runs one real-model prompt as a verbatim argument. Clients `mcp` and
`uvw` use `opencode run` with `console-deepseek/deepseek-flash#high` by default. Pass
`--model console-deepseek/deepseek-flash#max` before the label to choose another model and
variant. Client `codex` uses `codex exec` with `gpt-6.1-sol` and reasoning effort `high` by
default. Its model option is `<model>[#<effort>]`; omitting the suffix keeps effort `high`.
For example:

```bash
$V story --model console-deepseek/deepseek-flash#max weak mcp '调用 univer-workspace 的 whoami，把返回的身份名称原样告诉我。'
$V story strong codex '调用 univer-workspace 的 whoami，把返回的身份名称原样告诉我。'
$V story --model gpt-6.2-sol#xhigh another codex '<prompt>'
```

Each client and identity gets a throwaway HOME,
`home/stories/<client>-<identity>/`, with XDG config, data, state and cache, `TMPDIR`, and an empty
working directory `work/<label>/` addressed by its real path. opencode's environment holds your
PATH, that HOME and the XDG variables, and no API key from your shell unless you name it.

The model credential comes from the opencode integration of the model's provider, the part before
the first `/`. A `console-` provider uses integration `opencode`. `VERIFY_UVW_OPENCODE_CREDENTIAL=<integration>`
names another one; `opencode auth list` shows yours. The first story of a run exports that
integration from your own opencode with `opencode auth export <integration> --standalone` into
`home/opencode-credential-<integration>.json` (mode 0600), and each story imports it into its HOME.
When opencode stores nothing for the integration, the story passes only the shell variables that
`VERIFY_UVW_STORY_ENV` names, comma- or space-separated, and records their values in
`home/story-env.json` (mode 0600) for the redactor. For example:

```bash
VERIFY_UVW_OPENCODE_MODEL='deepseek/deepseek-flash#high' VERIFY_UVW_STORY_ENV=DEEPSEEK_API_KEY \
  $V story s1 mcp '调用 whoami，然后告诉我你的用户名。'
```

With neither, the story fails before opencode starts and names the model, the integration, the
integrations opencode stores and both variables. `run-meta.json` records which source the story used
in `model_credential`. `down` deletes all of it with `home/`. Nothing is
written to your own opencode database. Codex instead copies only `auth.json` from the launching
shell's `CODEX_HOME` (default `~/.codex`) once into `home/codex-credential.json` (mode 0600),
then into its own `home/stories/codex-<identity>/.codex/auth.json` (mode 0600). That directory is its `CODEX_HOME`; no user config, rules, plugins, or sessions
are copied. A missing file credential fails the story; keyring-only login is not supported.
`down` deletes the copied credential, and the shared redactor reads it while the run exists.

| Client | `--as` (default `human`) | What the agent starts with |
| --- | --- | --- |
| `mcp` or `codex` | `human` | the run user's PAT as bearer |
| `mcp` or `codex` | a principal | that principal's token as bearer |
| `mcp` | another name, with `--oauth` | no credential. The first story runs opencode's own `mcp auth` and takes the guest agent card (`oauth-*` in the story evidence); later stories of that identity reuse the grant |
| `uvw` | `human` | `uvw` signed in as the run user |
| `uvw` | another name | `uvw` with the origin configured and no session. The model signs in itself, and later stories of that identity keep its session |

- `mcp`: one MCP server named `univer-workspace`, as in the README. Denied: read, glob, grep,
  list, edit, write, bash and shell, webfetch, websearch, question, task, skill, lsp.
- `codex`: one MCP server named `univer-workspace`. The generated TOML uses
  `mcp_servers.univer-workspace.url` and `bearer_token_env_var = "VERIFY_UVW_MCP_BEARER"`.
  The token is passed in the isolated process environment, never a command argument or evidence.
  Config sets `model_reasoning_effort`, `approval_policy = "never"`, `sandbox_mode = "read-only"`,
  `web_search = "disabled"`, and file credential storage. Apps, plugins, and multi-agent tools are
  disabled. The shell environment excludes the MCP bearer. `codex --no-daemon exec --strict-config
  --skip-git-repo-check --ephemeral --ignore-rules --json --color never` runs in the empty working
  directory. Config keys and flags were checked with Codex CLI 0.170.0 help, its
  [versioned config schema](https://github.com/openai/codex/blob/rust-v0.170.0/codex-rs/core/config.schema.json),
  and [configuration docs](https://developers.openai.com/codex/config-reference/).
  Codex supports the run user's PAT and principal tokens; `--oauth` remains specific to opencode.
- `uvw`: no MCP server. Shell and file tools are allowed, `uvw` is first on PATH, and the
  checkout's `skills/univer-workspace-cli` is installed as an opencode Skill. Denied: webfetch,
  websearch, question, task and subagent, opencode's `execute` wrapper, and file tools outside the
  working directory and the story's `TMPDIR`. Inside `execute`, `tools.opencode.session_move` moves
  the working directory anywhere, after which `read` and `glob` returned the run's credential export
  without an `external_directory` refusal. The shell tool runs `/bin/zsh` under macOS
  `sandbox-exec` (`SHELL` names `.local/libexec/zsh` in the story HOME, profile
  `.local/libexec/shell.sb`). The profile denies reading and writing your home directory and the
  whole `VERIFY_UVW_ROOT`, then gives back only
  the story's `work/`, `TMPDIR` and `.univer-workspace-cli`, read access to `.local/bin`,
  `.local/lib`, the checkout without `.data/`, and node's install directory. Every process the
  shell starts, `uvw` included, inherits it. Without `/usr/bin/sandbox-exec`, a `uvw` story refuses
  to start.

Story evidence is `$EVIDENCE/<label>/`: `prompt.txt`, `transcript.jsonl` (redacted),
`trajectory.txt` (one `ok` or `error` line per MCP call, helper call or shell command, then the
final answer verbatim), `answer.txt`, `opencode-stderr.txt` or `codex-stderr.txt`, and
`run-meta.json` (actual model, Codex effort, client, identity, duration, exit code). Codex transcripts
come from `codex exec --json`; settled MCP and shell items are each listed once.
A label that already has evidence is refused. The run is killed
after 30 minutes and `run-meta.json` records `timed_out`.

Not contained, so read `trajectory.txt` for it and report it:

- `mcp`: opencode cannot deny its own `execute` wrapper, which carries the MCP calls. Inside it
  the model also has `fetch`, which reaches any host and local port including this run's HTTP API,
  plus `search` and the `tools.opencode.*` helpers. The wrapper is a restricted interpreter: with a
  scripted model, `require`, `import()`, `process`, `Bun`, `Deno`, `globalThis`, the Function
  constructor and `fetch('file://…')` all failed, and no canary file or environment value came
  back. `session_move` still moves the working directory anywhere, and opencode then adds the
  `AGENTS.md` it finds there, and in parent directories, to the conversation. In a git
  repository `worktree_create` adds a worktree to the repository's `.git` and checks it out under
  the story HOME. The model credential is not reachable this way.
- `codex`: the read-only sandbox applies to local shell commands, not remote MCP effects.
  Commands can read accessible local files outside the working directory, including the story's
  copied model credential and other run credentials. Read-only is not a confidentiality boundary.
  Commands cannot write files or use the network under that policy, and approval escalation is
  disabled. MCP calls run in the Codex host and can still read or change Workspace data according
  to the identity's permissions. The model retains read-only shell and local inspection tools;
  check the trajectory for any use outside MCP. Web search is disabled. The copied Codex credential
  is never written to evidence and is removed by `down`.
- `uvw`: the shell cannot read the run's `home/` (the model credential export, principal tokens,
  `mcp-*`), `user.pw`, `run.env`, `user.env`, other story HOMEs, opencode's data in its own story
  HOME, or your home directory. What it can still read: its own uvw session in
  `.univer-workspace-cli` (the identity's own credential), the whole checkout except `.data/`
  (including any untracked files there), node's install directory, and anything outside your home
  and the run root, such as `/etc` and other `/tmp` directories. `uvw` can upload whatever the shell
  can read. The network is not restricted, so the shell reaches every local port, your own
  Workspace on 3020 included, without its cookies. `stat` still shows names and sizes of denied
  files. The `uvw` wrapper and `readlink` still reveal the checkout path.
- opencode's per-command shell rules (`permission.shell`) were tried and do not hold. With
  `{"*": "deny", "uvw *": "allow"}`, `--auto` keeps the deny, and pipes, `&&`, `;`, `$(cat …)`
  and backticks are refused. But `uvw "$(< file)"`, `X=$(<file); uvw "$X"`, `uvw … < file`, a
  here-string and zsh's bare `< file` all run and return the file. opencode checks only command
  nodes, and these read files without one.
- The plaintext export `home/opencode-credential-<integration>.json` and `home/story-env.json` stay
  for the whole run. `secrets.mjs` reads them to redact the model credential, and each story HOME's
  opencode database holds the same value anyway. The sandbox denies these files to the shell.
  `down` removes them. A variable that `VERIFY_UVW_STORY_ENV` names is in the environment of a `uvw`
  story's shell, so the model can print it.

Rules for the verifier:

- The prompt is the one sentence a user would type, and nothing else: no tool names, IDs, URLs or
  hints. Preparation belongs in the identity, not in the prompt.
- The first attempt is the result. Another attempt gets its own label (`<label>-attempt2`), and
  the report shows every attempt.
- When the model goes wrong, quote what it said and did from `transcript.jsonl`. Do not
  paraphrase it or repair the prompt.
- Check the end state yourself: read the file back as another principal or with `uvw read --trunk`,
  `open-anon` every link in the answer, and compare both with what the answer claims. Exit 0 and
  a confident answer prove nothing.
- Run `secret-check` before you quote or copy evidence.

Client pitfalls seen with opencode 2.0.29. They are harness artifacts, not product behavior:

- `opencode run` cannot answer its `question` tool, so the tool is denied. A model that needs an
  answer has to say so in its reply.
- In `mcp` stories opencode's wrapper is also named `execute`, and models confuse it with the
  Workspace `execute` tool. In `trajectory.txt` the Workspace one is `univer-workspace.execute`. The first wrapper
  call can fail with `Unknown tool namespace 'univer-workspace'` while the tool list loads.
- File tools are confined by resolved path, and `/tmp` is `/private/tmp` on macOS. A read or
  write refused with `external_directory` is an artifact. The story's paths are already resolved
  and its `TMPDIR`, where models keep scripts and screenshots, is allowed.
