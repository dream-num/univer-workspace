---
name: maintain-agentsmd
description: Add to, revise, audit, or prune this repository's AGENTS.md files. Decides where a rule belongs (root AGENTS.md, a nested AGENTS.md, a README, a design doc, a skill, or a test), checks each line against the admission test, and runs the review that removes drift, duplication, and rules written for older models. Use when adding or changing an instruction in any AGENTS.md, when an agent ignored or misapplied a rule, when `pnpm check:agents-md` fails, after a major model release, or for a periodic review.
---

# maintain-agentsmd

AGENTS.md files are the instructions every coding agent loads before it works here. Each line
costs context in every session and agents act on it, so a stale line causes wrong work. Keep only
what an agent cannot learn from the repository and would get wrong without being told.
`references/evidence.md` holds the research behind these rules. Read it when you review the rules
themselves.

## Where a rule belongs

Pick the first row that fits.

| The rule                                               | Put it in                                                                               |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| A test, type, lint, script, or CI job can enforce it   | That mechanism. AGENTS.md keeps at most one line with the reason and the enforcing file |
| It matters only under one directory                    | That directory's `AGENTS.md`, plus one row in the root "Nested instructions" table      |
| It is a multi-step procedure used for one kind of task | A skill under `.agents/skills/`                                                         |
| It describes behavior for users or package consumers   | The README beside the code                                                              |
| It records a design decision, its history, or a plan   | `docs/design/` or `apps/workspace/docs/`                                                |
| It is a cross-repository fact                          | `DREAMNUM.md`                                                                           |
| It holds for the whole repository and no code shows it | Root `AGENTS.md`                                                                        |
| It is a personal or machine-local workflow             | The Git-ignored `AGENTS.override.md`                                                    |

A new nested `AGENTS.md` needs a row in the root table in the same change. Some tools load
instructions only from the working directory upward, so that row is how they find the file.

## Admission test

Keep a line only if every answer is yes:

1. Would a strong model, after reading the code, get this wrong without the line?
2. Is it true today? Check each named path, command, version, and status against the repository.
3. Is this the only place that states it? Otherwise keep one copy and point to it.
4. Does no test, type, or script already enforce it? If one does, shorten the line to the reason and
   the file that enforces it.
5. Does it apply to every session that loads this file?

These usually fail the test: directory trees, architecture overviews, dependency lists, generic
engineering advice ("run the smallest test first"), history ("moved out of the README"),
instructions to read a file the tool already loads, and plans written as current fact.

## Writing rules

- Follow the Language Settings in root `AGENTS.md`. These files are in English.
- State the rule as a plain instruction, with its scope and its reason when the reason is not
  obvious. A reason lets the model handle the case the rule did not name.
- Do not add emphasis such as IMPORTANT, MUST, CRITICAL, or capital letters. Current models follow
  plain wording and over-apply emphasized rules. Use "never" only for a true invariant, and prefer
  an enforcing check for those.
- Give one fact one home. Other files point to it by path and say when to read it.
- Write paths from the repository root or from the AGENTS.md file's own directory, so
  `pnpm check:agents-md` can check them.
- Keep two rules from contradicting each other. Agents resolve a conflict arbitrarily.
- Prefer deleting a line to adding one. When an agent ignores a rule twice, first ask whether the
  file is too long or the rule belongs in a check. Do not add emphasis.

## Size

Run this from the repository root. It prints each file's bytes and the bytes of its chain from the
root, which is what Codex loads.

```bash
git ls-files -- AGENTS.md '**/AGENTS.md' | while read f; do d=$(dirname "$f"); t=0; while :; do [ -f "$d/AGENTS.md" ] && t=$((t+$(wc -c <"$d/AGENTS.md"))); [ "$d" = . ] && break; d=$(dirname "$d"); done; printf '%6d %6d %s\n' "$(wc -c <"$f")" "$t" "$f"; done
```

Targets are about 12 KB for the root file and 4 KB for a nested file. The hard limit is the chain
total. Codex stops reading at 32 KiB by default. Treat a file over its target as a reason to apply
the admission test again, not as a reason to split it.

## Workflows

### Add or change a rule

1. Place it with the table above and apply the admission test.
2. Write it by the writing rules. Look for an existing line to replace before you add one.
3. When the rule moves out of a file, search for links to the old place
   (`rg -n 'AGENTS.md' --glob '!node_modules'`) and keep anchors that other files link to.
4. Run the verification below.

### Review all files

Do this after a major model release, after a large restructure, or when the files have not been
reviewed for about three months.

1. Run `pnpm check:agents-md` and fix every broken reference.
2. Fact drift. For each concrete claim (package lists, stages, versions, product status, script
   behavior), read the code, manifest, or doc it describes. The check covers only paths and
   scripts, so this step finds the semantic drift.
3. Duplication. For each section, search `README.md`, `DREAMNUM.md`, package READMEs, `docs/`,
   and code comments for the same fact. Keep one copy.
4. Enforcement. List the tests and scripts that already guard each rule (`rg` the identifiers in
   `test/`, `scripts/`, and `*.test.*`). Shorten those rules to a pointer.
5. Scope. Measure each root section and move the ones that matter only under one directory.
6. Older-model rules. Remove emphasis, generic advice, and workarounds for model limits.
7. Reread `references/evidence.md`. Recheck the sources listed there for changes, and update the
   file and these rules if the guidance changed.
8. Report what you removed, moved, and corrected, with evidence for each fact you changed.

### Fix a failing check

`pnpm check:agents-md` prints `file:line: kind ref not found`. Find what replaced the path or script
with `git log --diff-filter=DR --summary -- <path>`. Update the reference, or delete the line if
the thing it described is gone. Never create a file only to satisfy the check.

## Override files

`AGENTS.override.md` is local and Git-ignored. Codex reads it in place of the `AGENTS.md` in the
same directory, so it must repeat the shared principles and the language settings. When you change
those shared sections, check whether an override file exists next to the changed file and tell the
user it needs the same change. Never commit an override file.

## How tools load these files

Verify these facts against current vendor docs during a review. They change between releases.

| Tool                      | Loads                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code               | Every `AGENTS.md` from the launch directory upward at start, nested ones when it reads a file in their directory. Reads `AGENTS.md` only when no `CLAUDE.md` exists, so do not add a root `CLAUDE.md` unless it imports `@AGENTS.md` |
| Codex                     | `AGENTS.override.md` or `AGENTS.md` per directory from the root to the working directory, concatenated, up to 32 KiB                                                                                                                 |
| Cursor and GitHub Copilot | Root and nested `AGENTS.md`, with the nearest file taking precedence                                                                                                                                                                 |

## Verification

- `pnpm check:agents-md` exits 0.
- `git diff --check` is clean.
- For a restructure, start fresh sessions in the changed tree and ask each a question that needs a
  moved rule, for example "I am changing the Agents prompt assembly. What must hold?". Check that
  each one finds the right file without hints. Use a new headless session such as
  `claude -p "<question>"` from the repository root. A subagent of the session that edited the
  files inherits the instruction files loaded when that session started, so it tests the old text.
