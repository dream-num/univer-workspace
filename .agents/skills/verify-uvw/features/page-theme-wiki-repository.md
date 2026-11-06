# Page theme: Wiki and Repository modes

A signed-in user picks the page theme in Application settings. `Repository` (the default) is a
repository-style workspace with a top bar (OfficeLab mark, search, Home, Pull requests, Issues,
Recent and Pages) over the same data. `Wiki` is a file-tree workspace with a sidebar of Personal
Space, Team Spaces and Apps. The choice is stored per browser and survives a reload.

## Sub-features

- `mode-default-repository` starts in Repository with no stored choice.
- `mode-switch-wiki` switches to Wiki from Application settings.
- `mode-persist` keeps the chosen theme across a reload.
- `mode-switch-repository` switches back to Repository.
- `mode-repo-directory` searches and creates repositories on `/repositories`.
- `mode-repo-pulls` lists and opens pull requests on `/worktrees`.
- `mode-repo-views` renders `/home`, `/issues`, `/recent` and `/apps` in the Repository shell.

## How to get to it (user POV)

- Repository mode: `Account` (avatar, top right) → `Application settings`. The top bar has no gear.
- Wiki mode: the `Application settings` gear in the page header.
- Either way the dialog has a `Page theme` control with `Wiki` and `Repository`.
- Repository routes: `/home`, `/repositories`, `/worktrees`, `/issues`, `/recent`, `/apps`.

## Driving it with agent-browser and uvw

Preconditions:

- Baseline run with `$V user`, a fresh agent-browser session (no stored page theme), locale pinned
  to English (see [README](./README.md)), browser signed in as the baseline user.
  `O=verify-$VERIFY_UVW_RUN`.
- Seed content so Repository views are not empty. Each command is its own recorded step:
  `$V cli seed-repo repo create verify-team --name "Verify Team" --json id`,
  `$V cli seed-issue issue create -R $O/verify-team -t "Totals look wrong" -b "North should be 42" --json number`,
  `$V uvw repo view $O/verify-team --json id` (the `id` is the Space ID `S`),
  `$V cli seed-pr pr create -R $O/verify-team -t "Add Sales sheet" --json` (take `id` as `W`), and
  `$V cli seed-unit unit create --worktree $W --space $S --type sheet --name Sales --json`.

- **Repository default.** After sign-in on `$ORIGIN/home`,
  `agent-browser eval 'document.documentElement.dataset.uiMode'` prints `repository`. The top bar
  has a link `OfficeLab`, a searchbox `Find a repository…`, a `Main navigation` with `Home`,
  `Pull requests`, `Issues`, `Recent` and `Pages`, and a button `Account`. The Home rail is the
  region `Your repositories` with `Verify Team`. Run
  `agent-browser screenshot "$EVIDENCE/mode-repository-home.png"`.
- **Open settings.** Run `agent-browser find role button click --name "Account"`, then
  `agent-browser find role menuitem click --name "Application settings"`. The dialog shows
  `Page theme` with buttons `Wiki` and `Repository`. Run
  `agent-browser screenshot "$EVIDENCE/mode-settings-open.png"`.
- **Switch to Wiki.** Run `agent-browser find role button click --name "Wiki"`.
  `agent-browser storage local get univer-workspace-layout-theme` prints `wiki`. The sidebar has a
  `Personal Space` region and `Team Spaces`, and the header has a button `Application settings`.
  Run `agent-browser screenshot "$EVIDENCE/mode-wiki-home.png"`.
- **Persist.** Run `agent-browser reload` and `agent-browser wait 2000`.
  `document.documentElement.dataset.uiMode` still prints `wiki`.
- **Switch back.** Run `agent-browser find role button click --name "Application settings"`, then
  `agent-browser find role button click --name "Repository"`. The theme key prints `repository`
  and the `OfficeLab` link is back in the top bar.
- **Repository directory.** Run `agent-browser open "$ORIGIN/repositories"` and `agent-browser wait 2000`.
  The heading is `All repositories`, with `Type`, `Visibility` and `Sort` comboboxes. Run
  `agent-browser find placeholder "Find a name or description…" fill "Verify Team"`. The URL becomes
  `/repositories?q=Verify+Team` and the page says `1 repository found`. Screenshot
  `$EVIDENCE/mode-repository-repositories-filter.png`.
- **Create a repository.** Run `agent-browser find role button click --name "New repository"`.
  A dialog `New repository` has `Repository name` and `Slug` textboxes. Run
  `agent-browser find label "Repository name" fill "UI Created"`. `Slug` fills itself with
  `ui-created`. Run `agent-browser find role button click --name "Create" --exact`. The URL becomes
  `/spaces/<spaceId>`. Read it back with `$V cli mode-repo-readback repo list --json`: it lists
  `fullName: <owner>/ui-created`, `type: team`, `name: UI Created`.
- **Pull requests.** Run `agent-browser open "$ORIGIN/worktrees"` and `agent-browser wait 2000`.
  The heading is `All pull requests`, with a `Search pull requests` textbox and `Open <n>` and
  `Closed <n>` buttons. The PR is a link whose name starts with `Add Sales sheet`. Click it with
  `agent-browser find role link click --name "Add Sales sheet"` (add the rest of the accessible name
  from `snapshot -i` if the match is ambiguous). The URL is `/spaces/<spaceId>/pulls/<n>`, the page
  shows `Add Sales sheet #<n>`, a `Draft` state and `Files changed`. Screenshot
  `$EVIDENCE/mode-repository-pr-open.png`, then confirm the number with
  `$V cli mode-repo-pr-view pr view <n> -R $O/verify-team --json`.
- **Other views.** `agent-browser open` each of `/issues` (heading `Issues`, textbox `Search issues`,
  `Open 1` / `Closed 0`), `/recent` (heading `Recent`, textbox `Search by name…`) and `/apps`
  (heading `Pages`, `No pages yet`), and screenshot each as `$EVIDENCE/mode-repository-<route>.png`.

## Gotchas

- The theme lives in `localStorage` key `univer-workspace-layout-theme`, per browser profile,
  not per user. A fresh agent-browser session starts in Repository, and the first render writes
  `repository` to that key.
- To start another journey in Wiki mode, skip the dialog:
  `agent-browser storage local set univer-workspace-layout-theme wiki`, then open any route. This
  does not replace the dialog journey above, which is the proof of the settings entry.
- In Wiki mode `/repositories` and `/recent` redirect to `/home`. `/worktrees`, `/issues` and
  `/apps` stay on their route. Assert on those pages in Repository mode.
- `Find a repository…` exists twice on Repository Home (top-bar search and the rail filter), so
  `find` may report two matches. On `/repositories` use the placeholder `Find a name or description…`.
- Issues and pull requests share `#N`. After creating Issue `#1`, the seeded PR is `#2`, not
  `#1`. Take the number from `pr create --json`.
- `/repositories` writes its search into the URL (`?q=`). The `/worktrees` search box does not
  change the URL, so do not assert on it.
- The slug in `New repository` is derived from the name (`UI Created` becomes `ui-created`).
  Proof is the `repo list` readback, not the toast or the redirect.
- The `Page theme` buttons are named exactly `Wiki` and `Repository`; there is no `(experimental)`
  suffix any more.
