# Writing a skill

How to write the files of a skill. Workspace limits and tools are in `workspace.md`.

## Layout

```text
<name>/
  SKILL.md          required: frontmatter, then Markdown instructions
  references/       optional: text the agent reads when the body points to it
  scripts/          optional: Facade code for execute (see workspace.md)
  assets/           optional: text templates such as .univer.html
```

Workspace accepts at most 100 files per skill, `SKILL.md` up to 64 KiB, and other text
files up to 256 KiB. The agent cannot read larger text files or any binary file.

## Frontmatter

```yaml
---
name: weekly-report
description: "Write the weekly report in the finance team's format from the Expenses sheet. Use whenever the user asks for a weekly summary, status report or week-over-week numbers, even if they do not say report."
---
```

| Field | Rule |
| --- | --- |
| `name` | Required. 1 to 64 lowercase letters, digits and single hyphens. Must equal the folder name. Cannot be a built-in skill name such as `core`, `sheet` or `skill-creator`. Keep it unchanged when editing. |
| `description` | Required. 1 to 1024 characters. See below. |
| `argument-hint` | Optional. Shown next to `/name` in the menu, such as `[week number]`. |
| `user-invocable` | Optional, default true. `false` hides the skill from the `/` menu. |
| `disable-model-invocation` | Optional, default false. `true` keeps it out of the agent's catalog; only `/name` runs it. Use it for skills with side effects the user wants to start by hand. |
| `compatibility` | Optional, 1 to 500 characters. Rarely needed. |
| `metadata` | Optional map of string keys to string values. Imports record their source here (`importing.md`). |

Workspace ignores `allowed-tools`, `context`, `model`, `hooks` and `paths`. Leave them out
of new skills.

Wrap any value in double quotes when it contains `: ` or ` #`, starts with a quote,
bracket, `*`, `&`, `!`, `%` or `@`, or looks like a number, `true`, `false` or `null`.
`metadata` values must be strings, so quote them all.

## The description

The agent sees only `name` and `description` in its catalog and decides from them whether
to read the body. All "when to use" information goes in the description, not the body.

- Say what the skill does and the situations that call for it, including requests that
  never name it.
- Agents tend to under-use skills, so make the description a little pushy. Instead of
  "Build a dashboard of sales data", write "Build a dashboard of sales data. Use whenever
  the user mentions dashboards, KPIs, sales charts or wants to see company numbers at a
  glance, even if they do not ask for a dashboard."
- An agent consults a skill for work it cannot do well alone. A one-step request like
  "read this Sheet" may not trigger any skill. Aim the description at the multi-step or
  specialized requests the skill exists for.
- The catalog has a shared budget and shortens the longest descriptions first. Put the
  most important trigger words in the first sentence.

## Progressive disclosure

A skill loads in three levels:

1. `name` and `description`, always in the catalog.
2. The `SKILL.md` body, when the skill triggers. With `/name` the whole body goes into the
   user's message, so every line costs context on every run.
3. Other files, only when the body tells the agent to read them.

Keep the body under 500 lines, ideally far less. When it grows, move detail into
`references/` and say in the body which file to read and when. Keep references one level
deep from `SKILL.md`. Give a reference over 300 lines a table of contents.

When a skill covers several variants, put each in its own reference and let the body
choose:

```text
monthly-close/
  SKILL.md              the shared steps, and which reference to read
  references/
    retail.md
    wholesale.md
```

The agent then reads only the variant it needs.

## Arguments

With `/name some text`, Workspace replaces each `$ARGUMENTS` in the body with `some text`.
If the body has no `$ARGUMENTS`, it appends `ARGUMENTS: some text` to the end. Use the
placeholder where the user's input belongs, such as `Write the report for $ARGUMENTS.`

## Writing the body

- Use the imperative: "Read the Expenses sheet", not "The Expenses sheet should be read".
- Explain why each step matters. A model that knows the reason handles cases the text did
  not foresee. Treat MUST, NEVER or ALWAYS in capitals as a sign that a reason is missing.
- Keep it general. Write the rule the examples share, not one branch per example.
- Write a draft, then reread it as a stranger and cut what does not change behavior.

Define an output format with an exact template:

```markdown
## Report structure
Use this template:
# [Title]
## Summary
## Numbers by department
## Open questions
```

Show examples as input and output pairs:

```markdown
## Commit message format
**Example 1:**
Input: Added user authentication with JWT tokens
Output: feat(auth): implement JWT-based authentication
```

## No surprises

A skill's behavior must match what its description tells the user. Do not write skills
that mislead the user, hide what they do, collect data for an outside party, or help gain
access the user should not have. Role-play skills such as "act as our auditor" are fine.
Decline the rest and say why.
