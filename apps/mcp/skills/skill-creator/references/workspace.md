# Workspace constraints

What a skill can rely on when the Workspace Agent runs it.

## Where skills live

| Destination | Folder | Who sees it |
| --- | --- | --- |
| Personal Space | `.agents/skills/<name>/` at its root | Only this user, in every session |
| Repository | `.agents/skills/<name>/` at the repository root | Every member's agent, in sessions scoped to that repository |

- A repository skill overrides a personal skill with the same name in that repository's
  sessions.
- Built-in skills (`core`, `sheet`, `doc`, `slide`, `base`, `board`, `embed`,
  `cross-unit-formula`, `blob`, `html-view`, `skill-creator`) reserve their names.
- Skills are read from trunk. A published change takes effect at the start of the next
  agent run, without a pull request.
- Agents of non-members never load a repository's skills.

## What the agent has

The Workspace Agent runs in the browser. It has no shell, no sandbox, no local files, no
environment variables and no network access beyond the Workspace MCP tools. It cannot run
`bash`, `python`, `node`, `npx`, `pip` or `curl`, and it has no `Bash`, `Read`, `Write`,
`Edit`, `WebFetch` or `Task` tool. Write every step as something the tools below can do.

It has the `core` toolset. Its main tools by job:

| Job | Tools |
| --- | --- |
| Find files and Spaces | `repo_list`, `repo_view`, `space_find`, `space_browse` |
| Read content | `inspect` (`trunk: true` reads the live file), `screenshot`, `export` |
| Change content | `pr_create`, `unit_add`, `unit_create`, `execute`, `import`, then `pr_ready`, `pr_view`, `browse` |
| Look up the Facade API | `api_find`, `api_show` |
| Pages backed by live Sheets | `html_view_create` (when available), `html_view_read`, `html_view_replace`, `html_view_draft_get` |
| Issues and pull requests | `issue_list`, `issue_view`, `issue_create`, `issue_comment`, `pr_list`, `search` |
| Skills | `skills_read`, `skill_draft_create`, `skill_draft_get` |

Check your own tool list before naming a tool; schemas define the arguments. External MCP
clients may also have the `files` toolset (`blob_download`, `compile_markdown`,
`compile_typst`, `print_pdf` and others). If a skill needs one of those, say in its body
that the step needs that toolset, so the browser agent tells the user instead of guessing.

For any change to a Sheet, Doc, Slide, Base or Board, tell the skill to follow the `core`
Skill: work in a new Worktree, verify, mark it ready and hand the review link to the
user. A skill should also tell the agent to read the matching domain Skill (`sheet`,
`doc` and so on) before it writes Facade code.

In Ask mode the agent has only read tools. A skill that writes should say that those
steps need Auto mode.

## Referring to the user's files

When a skill always works on the same file, write the repository, its path and its
`unitId`. Tell the agent to confirm the file with `space_find` or `inspect` before it
writes, because files can move or be replaced. When the file differs per run, describe
how to find it instead.

## Facade scripts

A script in `scripts/` is text. The agent reads it with
`skills_read {"name": "<skill>", "resource": "scripts/<file>.js"}` and passes its text as
`code` to `execute`. Nothing in `scripts/` runs on its own.

Write scripts for `execute`:

- `execute` runs in a Worktree against one Unit. It needs `worktree`, `unit` and `code`.
- It predefines `univerAPI`, its alias `api`, and the root for the Unit type: `workbook`
  for a Sheet, `doc` for a Doc, `presentation` for a Slide, `base` for a Base and `board`
  for a Board. Never redeclare them.
- The code is an ES module with no `require`. Its `return` value comes back as `value`.
- Changes the code makes commit as one revision. Code that only reads commits nothing.
- Use only signatures confirmed with `api_show`. Do not guess argument shapes.

In `SKILL.md`, say when to run each script, what to set before running it (for example
constants at the top of the file), and how to check the result.

Keep scripts short. The agent copies the whole script into the tool call, which costs
tokens and can introduce copy mistakes.

## Templates and assets

- Text templates work. The agent reads them with `skills_read` and uses the text, for
  example a `.univer.html` page passed to `html_view_create`, or a Markdown outline.
- Binary files (`.xlsx`, `.docx`, `.pptx`, images, fonts) are listed but never read. The
  agent cannot import an `.xlsx` template from a skill. Describe the layout in text so the
  agent builds it with `execute`, or keep the template as a Sheet or Doc in a Space that
  the skill reads with `inspect`.
