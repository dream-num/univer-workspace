# Univer Workspace CLI

An agent-ready CLI for automating remote Univer Workspace, powered by the
[Univer SDK](https://docs.univer.ai/).

`univer-workspace-cli` gives AI agents a complete environment for creating, editing, validating,
rendering, and reviewing business content. It brings Sheets, Docs, Slides, Bases, and Boards
together with Workspace collaboration, content exchange, and verifiable output in one installable
tool.

It is also a comprehensive Univer SDK use case: a working example of how Univer's document model,
Facade APIs, collaboration, rendering, and conversion capabilities compose into an agent product.

## Built for agents

```text
Human intent
    ↓
AI agent + version-matched guidance
    ↓
Univer Workspace CLI
    ↓
Univer SDK + Workspace
    ↓
Verified, reviewable content
```

People define the outcome and review the result. Agents use the CLI to manage the Workspace task,
author content through the Univer Facade API, verify both data and rendering, and return a direct
review handoff.

The installed package supplies the operational contract an agent needs:

- Version-matched Skills for Core, Sheet, Doc, Slide, Base, Board, embeds, and cross-Unit formulas
- Structured JSON output for planning, execution, and verification
- Offline Facade API and SVG resource discovery
- CLI help aligned with the installed SDK and command surface

## SDK capabilities in one CLI

| Agent outcome           | Univer capabilities composed                                                  |
| ----------------------- | ----------------------------------------------------------------------------- |
| Author rich content     | Facade APIs across Sheet, Doc, Slide, Base, and Board                         |
| Work in isolation       | Personal and Team Spaces, task Worktrees, stable Resource and Unit identities |
| Verify results          | Structured inspection, headless layout capture, and PNG rendering             |
| Exchange business files | Office import and export with original-file preservation                      |
| Generate content        | Typst-to-Doc and SVG-to-editable-Slide compilation                            |
| Compose across Units    | Embedded Units and cross-Unit formulas backed by Workspace identities         |
| Deliver for review      | Worktree revisions, ready state, direct review links, and controlled merging  |

Worktree screenshots resolve UUID-backed images through the Workspace Asset sign/content flow
before rendering. Host, formula-reference, and embedded Unit data are rewritten only in the
render copy, including image references serialized inside `resources[].data`.

Together, these capabilities show the range of products and workflows that can be built with the
Univer SDK.

## Install

Install the CLI in the environment used by the agent:

```bash
npm install --global univer-workspace-cli@latest
```

Point the CLI at your own Workspace deployment with
`univer-workspace-cli config set workspace.origin <origin>`. Give the
agent access to the executable and that Workspace; the bundled guidance supplies the
version-correct workflow.

## Login

The default login does not ask the agent for a Workspace password:

```bash
univer-workspace-cli login
```

The command prints a short-lived Workspace URL and verification code, saves the pending request
locally, and exits immediately. The agent must send the URL and code to the user, then stop and wait
for the user's reply—it must not poll while approval is pending. Open that URL in your own browser,
sign in if necessary, and confirm the matching code. Existing browser sessions and all browser
sign-in methods—including GitHub and Discord—work with this flow.

Only after the user confirms approval, complete the one-time exchange:

```bash
univer-workspace-cli login --complete
```

`--complete` checks once and exits; it does not wait or poll. Approval creates a separate CLI session
without copying the browser cookie or an OAuth access token through the agent.

For compatibility, a user at an interactive terminal can still sign in directly with a Workspace
username and password:

```bash
univer-workspace-cli login --username <name>
```

`--password-stdin` remains available for controlled automation that already owns a password secret.

## License policy

The CLI bundles the same application-owned runtime development license as the
Workspace browser. Both copies are rotated every 90 days; this credential is
not the repository software license. Set `UNIVER_LICENSE` to a non-empty value
to override the bundled credential.

## Project links

- [Univer Workspace repository](https://github.com/dream-num/univer-workspace)
- [Univer SDK documentation](https://docs.univer.ai/)
- [Univer on GitHub](https://github.com/dream-num/univer)
- [Workspace issue tracker](https://github.com/dream-num/univer-workspace/issues)
- [Univer website](https://univer.ai/)
