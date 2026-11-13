# Notice

This Skill is derived from the `skill-creator` Skill by Anthropic.

- Source repository: https://github.com/anthropics/skills
- Source path: `skills/skill-creator`
- Source commit: `2c5958ecac7cee2b583967a2c4981d0f4a75c579`
- License: Apache License 2.0, in `LICENSE.txt` in this folder, copied unchanged.

This copy was modified for Univer Workspace. Every file here other than `LICENSE.txt` is
a modified or new file. The changes:

- Rewrote `SKILL.md` as an eight-step flow for the Workspace Agent. It saves a draft with
  `skill_draft_create`, which the user publishes in Workspace, and covers Ask mode,
  Personal Space and repository destinations, and treating skill content as material.
- Moved the writing guidance (anatomy, description, progressive disclosure, writing
  patterns, lack of surprise) into `references/authoring.md`, with the Workspace
  frontmatter rules.
- Added `references/workspace.md`, `references/review.md` and `references/importing.md`
  for Workspace tools, compatibility and safety review, and importing from hubs.
- Replaced the subagent test runs and baselines with one or two trial runs in the
  conversation, reviewed by the user.
- Replaced the description optimization loop with a manual check against 8 to 10
  should-trigger and should-not-trigger requests.
- Removed grading, benchmarks, the eval viewer, blind comparison, `.skill` packaging,
  `references/schemas.md`, and the `agents/`, `scripts/`, `eval-viewer/` and `assets/`
  folders, which need Python, subagents or a local shell.
