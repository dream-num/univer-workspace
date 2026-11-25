# Agent Mode

Agent Mode keeps people out of an agent's task between the grant at the start and the merge at the end. The
[spec](../../../../docs/design/agent-mode/spec.zh-CN.md) states its requirements R1-R24, its stories and its
acceptance criteria. This page says which journeys cover each of them, how to run all of those journeys, and what no
journey covers yet.

## Features

| Feature | Journeys | Mode |
| --- | --- | --- |
| [An Issue as an agent's task](../features/agent-mode-tasks.md) | MP11, MP12, MP13, MI12, MI15 | mcp |
| [Judge and undo an agent's task](../features/agent-mode-acceptance.md) | MI13, MI14, MI17, MI16 | mcp |
| [Declared checks and the landing guard](../features/agent-mode-checks.md) | MP15, MP17, MP18 | mcp |
| [Files that move to Trash around a pull request](../features/agent-mode-trash.md) | MP16, MP19 | mcp |
| [An agent's limits](../features/agent-mode-limits.md) | MP14 | mcp |
| [Pull requests (Worktrees)](../features/pull-requests.md) | PR4-PR10, then PR11 | mcp, then default |
| [Agent handoff and claim](../features/agent-handoff.md) | HO1-HO8, then HO9 and MH1-MH5 | default, then mcp |
| [HTML View drafts over MCP](../features/mcp-html-view.md) | MHV5-MHV16 | mcp |
| [Files and Office exchange over MCP](../features/mcp-blobs-office.md) | MF10, MF11 | mcp |
| [MCP sign-in with personal access tokens](../features/mcp-auth.md) | MA7 | mcp |
| [MCP sign-in with OAuth](../features/mcp-oauth.md) | MO2 | mcp |

## Run all of it

Give each feature its own instance, and each mode of a feature its own, because journeys leave agents, Spaces and
browser sign-ins that another feature's journeys do not expect. For each, with the commands of [the skill](../SKILL.md):

1. `$V up --for <feature> [journey-id|mode...]`, then `$V user` and `$V doctor`. `up` raises the agent creation limit
   for the run ([agent principals](stories.md)).
2. `$V run-journeys` with the same selection, for the feature's `Run: helper.` journeys.
3. `$V delegate` with the same selection when `doctor` names a verifier. Otherwise give a subagent the text of
   `$V brief` ([Hand the driving to another agent](../SKILL.md#hand-the-driving-to-another-agent)). Judge each
   verdict against its evidence.
4. `$V journeys` with the same selection, until it no longer ends with `RESULT: INCOMPLETE`.
5. `$V secret-check`, then `$V down`.

Run several features at once only with an id and ports of their own each ([Parallel runs](../SKILL.md#parallel-runs)).

## Requirements

| Spec | Journeys |
| --- | --- |
| R1 An agent creates, edits, merges and shares in its own Space | HO2, MH3, MH5, MP14, MI13, MI17. MH4: an unclaimed agent cannot make it public |
| R2 An agent creates a repository and owns it | MH1 (the tools), MP11, MP18 |
| R2a The owning agent manages members and merges others' proposals | MP11 and MP12 (adds a Viewer, merges its pull request), MP18 (adds an Editor, sets `landing`) |
| R2b A claimed agent as a member | Viewer: MI12, MP11, MP15, MHV11. Editor: MI13, MP15, MP18, MHV10 |
| R2c An unclaimed agent holds repositories but joins none | Not covered |
| R2d The claimer owns what the agent holds | HO6 and MH3, in the agent's Personal Space only |
| R3 The scope granted at the start counts | MA7 and MO2 without `worktree:merge`; MI13 and MP19 merge with the run user's PAT and no `toolsets` |
| R4 Read access is enough to propose | PR4, PR5, PR6, MI12, MP13, MP15, MHV11, MF10 |
| R5 The upstream role alone decides the landing | PR7, PR8, PR9, PR10, MP12, MP15, MI13, MHV8, MHV10, MHV11, MF10 |
| R6 `capabilities` tells an agent whether it may merge | MP11, MP17, MP19, MHV13 |
| R7 Author and merger are recorded | PR7, MP12 |
| R8 An owner or admin discards any Worktree | Not covered |
| R9 A fork is the whole repository and one row | Not covered |
| R10 An unchanged file in a fork shows the upstream Trunk | MHV11, MHV14 |
| R11 A Unit joins the fork's Worktree on its first write | MHV11, MF10 (same Unit ID; the baseline is not read) |
| R12 One open Worktree per fork | Not covered |
| R13 A fork stays usable after its Worktree ends | MHV11, MHV12 |
| R14 A ready fork refuses writes | MHV11 (`FORK_WORKTREE_NOT_DRAFT`); reopen, then write, is not covered |
| R15 The way back is a Worktree Merge | MHV11, MF10 |
| R16 `freshness` and `stale` | Not covered |
| R17 Verify on the merge preview | Not covered for agents |
| R18 A page changed upstream since its draft is not overwritten | MHV9, MHV12 |
| R19 The same for other Blobs | MF10, MF11 |
| R20 Reading upstream content needs upstream read access | MH3, MP11, PR11 |
| R21 Losing membership cuts the fork off | Not covered. MHV13 shows only that `accountable` admits a non-member |
| R22 A fork stores no upstream data | Not covered |
| R23 An unclaimed agent's quota spans all its Spaces | Not covered |
| R24 The server derives identity and state | No journey of its own |

## Stories

| Story | Journeys |
| --- | --- |
| 1 Read access only: a Viewer agent proposes through a fork, an Editor merges | MHV11, MF10, MHV15 (a real model) |
| 2 An Editor agent merges its own work | MHV10, MI13 |
| 3 Two agents in an agent's repository | MP11, MP12 |
| 4 (A6.1) Three linked pull requests, checks and one acceptance | MI13, MI14, MP13, MP15, MP17 |
| 5 (A6.2) Send back, fix and accept | MI12 |
| 6 (A6.3) Revert an Issue | MI16 |
| 7 (A6.4) Agents hand work over with no task in the prompt | MP11, MP12, MP18 |

Each journey above scripts its agents, except MP12 and MHV15, which run a real model. None measures what A6.7 asks.

## Acceptance criteria

| Criterion | Journeys |
| --- | --- |
| A1.1 A PAT with `worktree:merge` merges with no browser | The seed pull requests of MI13 and MP19 |
| A1.2 A PAT without it is refused | MA7, MO2 |
| A2.2 A Viewer agent proposes; Trunk is unchanged | PR4, PR5 (a person), MP15 |
| A2.3 The proposal is shared and its author cannot merge | PR4, PR5, MHV11 |
| A2.4 An Editor merges it; author and merger | PR7, MP15 |
| A2.5 A new file in a proposal lands | PR4, PR7 |
| A2.6 An Editor agent merges alone | MHV10, MI13 (added as an Editor, not raised from Viewer) |
| A2.7 A Viewer's direct Trunk writes are refused | PR6 (a person, over uvw and MCP) |
| A2.8 A non-member sees no Worktree | MH3, MP11 |
| A2.12 Who merges their own Worktree today still does | PR1, PR9, HO2 |
| A3.1 An agent creates a repository and works in it alone | MP11, MP18 (the repository stays private) |
| A3.9 An unclaimed agent cannot make a Space public | MH4 (expiry is not covered) |
| A4.6 A ready fork refuses writes | MHV11 (reopen is not covered) |
| A4.7 After the merge the fork is clean and opens a new Worktree | MHV11, MHV12 |
| A4.8 One Unit merges while another conflicts | MHV12 (a page), MF11 (a file); the discard and redo are not covered |
| A6.5 An Editor agent in a `review` repository merges as before | MHV10, MI13, MP17 |
| A6.6 Past its budget an agent is refused at the first step | MP14 (`pr_create`; a first write through a fork is not covered) |
| Phase 5: pages and Blobs through a fork | MHV5-MHV7 and MHV16 review pages, MHV8-MHV14, MF10, MF11 |

A0.x, A2.11, A4.1, A4.12, A6.7 and A6.8 are measurements, test suites or migrations, not journeys.

## Follow-ups

| Change | Journeys |
| --- | --- |
| #603 A merged pull request stays reviewable after a file moves to Trash | MP16, MI13, MI16 |
| #608 An agent declares checks on the default connection | MP18, MP17 |
| #609 An acceptor reads a summary of the agent's personal shares | MI17, MI13 |
| #610 An open pull request stays reviewable after its file moves to Trash | MP19, MP16 |
| #611 A reader who cannot see a file learns nothing about it | PR11 |
| #612 Checks as they stood at merge | MI14, MI16, MP15 |

## Not covered yet

- Fork substrate: R9, R12, R14 reopen then write, R21, R22, A4.2-A4.5, A4.9-A4.11, and `uvw fork list`, `view` and
  `delete`.
- The Trunk write guards of #581 and #590.
- Agent ceilings: R2c, R23, A2.1, A3.3, A3.4, A3.7 and A3.8.
- Ownership of an agent's repository: R2a labels and other people's Worktrees, R2b as admin, R2d, A3.2, A3.5 and
  A3.6.
- #570, the visibility of a pull request its author merged.
- R8, an admin's discard that unblocks a permanent delete (A2.9).
- R16 `behind` and `stale` (A2.10).
- R17, the merge preview for agents.
- A1.3, a CLI session on day 8.
- The real-model stories S1-S7 as recorded runs. They do not reproduce.
