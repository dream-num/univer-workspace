# Page theme: Wiki and Repository modes

A signed-in user picks the page theme in Application settings. `Wiki` (the default) is a
file-tree workspace with a sidebar of Personal Space, Team Spaces and Apps. `Repository
(experimental)` is a GitHub-style dashboard with Home, Pull requests, Issues, Recent and Pages
views over the same data. The choice is stored per browser and survives a reload.

## Sub-features

- `mode-default-wiki` starts in Wiki with no stored choice.
- `mode-switch-repository` switches to Repository from Application settings.
- `mode-persist` keeps the chosen theme across a reload.
- `mode-switch-wiki` switches back to Wiki.
- `mode-repo-directory` searches and creates repositories on `/repositories`.
- `mode-repo-pulls` lists and opens pull requests on `/worktrees`.
- `mode-repo-views` renders `/home`, `/issues`, `/recent` and `/apps` in the Repository shell.

## How to get to it (user POV)

- Wiki mode: the `Application settings` gear in the page header.
- Repository mode: `Account` (avatar, top right) → `Application settings`. The header has no gear.
- Either way the dialog has a `Page theme` control with `Wiki` and `Repository (experimental)`.
- Repository routes: `/home`, `/repositories`, `/worktrees`, `/issues`, `/recent`, `/apps`.

## Driving it with agent-browser and uvw

Preconditions:

- Baseline run with `$V user`, browser signed in as the baseline user, locale pinned to
  English (see [README](./README.md)). `O=verify-$VERIFY_UVW_RUN`.
- Browser starts in Wiki: `agent-browser storage local get univer-workspace-layout-theme`
  prints `wiki`.
- Seed content so Repository views are not empty. Each command is its own recorded step:
  `$V cli seed-repo repo create verify-team --name "Verify Team" --json id`,
  `$V cli seed-issue issue create -R $O/verify-team -t "Totals look wrong" -b "North should be 42" --json number`,
  `$V uvw repo view $O/verify-team --json id` (the `id` is the Space ID `S`),
  `$V cli seed-pr pr create -R $O/verify-team -t "Add Sales sheet" --json` (take `id` as `W`), and
  `$V cli seed-unit unit create --worktree $W --space $S --type sheet --name Sales --json`.

- **Wiki baseline.** On `$ORIGIN/home` run `agent-browser screenshot "$EVIDENCE/mode-wiki-home.png"`.
  The sidebar has a `Personal Space` region, `Team Spaces`, `Apps` and a link `Intelligent Workbench`.
  The header has a button `Application settings`.
- **Open settings.** Run `agent-browser find role button click --name "Application settings"`.
  A dialog headed `Application settings` shows `Page theme` with buttons `Wiki` and
  `Repository (experimental)`, then `Interface language` and `Appearance`.
  Run `agent-browser screenshot "$EVIDENCE/mode-settings-open.png"`.
- **Switch to Repository.** Run `agent-browser find role button click --name "Repository (experimental)"`.
  The dialog closes itself. `agent-browser storage local get univer-workspace-layout-theme`
  prints `repository`. The URL is unchanged, the breadcrumb link is `OfficeLab`, and the sidebar
  has `Home`, `Pull requests`, `Issues`, `Recent`, `Pages` and `Your repositories` with
  `Verify Team`. Run `agent-browser screenshot "$EVIDENCE/mode-repository-home.png"`.
  The `Issues` section shows `Totals look wrong`.
- **Persist.** Run `agent-browser reload`, `agent-browser wait 2000`. The theme key still reads
  `repository` and the `OfficeLab` breadcrumb is still there.
- **Repository directory.** Run `agent-browser open "$ORIGIN/repositories"` and `agent-browser wait 2000`.
  The heading is `All repositories`, with `Type`, `Visibility`, `Sort` comboboxes. Run
  `agent-browser find placeholder "Find a name or description…" fill "Verify Team"`. The URL becomes
  `/repositories?q=Verify+Team` and the page says `1 repositories found` with
  `<owner> / Verify Team`. Screenshot `$EVIDENCE/mode-repository-repositories-filter.png`.
- **Create a repository.** Run `agent-browser find role button click --name "New repository"`.
  A dialog `New repository` has `Repository name` and `Slug` textboxes. Run
  `agent-browser find label "Repository name" fill "UI Created"`. `Slug` fills itself with
  `ui-created`. Run `agent-browser find role button click --name "Create" --exact`. The URL becomes
  `/spaces/<spaceId>`. Read it back with `$V cli mode-repo-readback repo list --json`: it lists
  `fullName: <owner>/ui-created`, `type: team`, `name: UI Created`.
- **Pull requests.** Run `agent-browser open "$ORIGIN/worktrees"` and `agent-browser wait 2000`.
  The heading is `All pull requests`, with `Open` and `Closed` buttons, a `Search pull requests`
  textbox, and the PR as a link `Add Sales sheet`. Run
  `agent-browser find role link click --name "Add Sales sheet"`. The URL is
  `/spaces/<spaceId>/pulls/<n>`. The repository tabs are `Code`, `Issues`, `Pull requests`, `Pages`,
  `Settings`. The page shows `Add Sales sheet #<n>`, a `Draft` badge, and `Sales` under
  `Files changed`. Screenshot `$EVIDENCE/mode-repository-pr-open.png`, then confirm the number
  with `$V cli mode-repo-pr-view pr view <n> -R $O/verify-team --json`.
- **Other views.** `agent-browser open` each of `/issues` (heading `Issues`, `Search issues`,
  `Open 1` / `Closed 0`), `/recent` (heading `Recent`, `Search loaded items…`) and `/apps`
  (heading `Pages`, `No pages yet`), and screenshot each as
  `$EVIDENCE/mode-repository-<route>.png`.
- **Switch back.** Run `agent-browser find role button click --name "Account"`,
  `agent-browser find role menuitem click --name "Application settings"`, then
  `agent-browser find role button click --name "Wiki"`. The theme key prints `wiki`, and the
  sidebar shows `Personal Space` and `Team Spaces` again with the `Application settings` gear
  back in the header. After `agent-browser reload` the `Intelligent Workbench` link is still there.
  Screenshot `$EVIDENCE/mode-wiki-after-switch-back.png`.

## Gotchas

- The theme lives in `localStorage` key `univer-workspace-layout-theme`, per browser profile,
  not per user. A fresh agent-browser session starts in Wiki, so every run starts there.
- To start another journey already in Repository mode, skip the dialog:
  `agent-browser storage local set univer-workspace-layout-theme repository`, then open any route.
  Driven in a fresh session: after sign-in the `OfficeLab` breadcrumb is present. This does not
  replace the dialog journey above, which is the proof of the settings entry.
- In Wiki mode `/repositories` and `/recent` redirect to `/home`. `/worktrees`, `/issues` and
  `/apps` stay on their route. Switch to Repository before asserting on those two pages.
- `Find a repository…` exists twice in Repository mode (header and sidebar), so `find` may
  report two matches. On `/repositories` use the placeholder `Find a name or description…`.
- Issues and pull requests share `#N`. After creating Issue `#1`, the seeded PR is `#2`, not
  `#1`. Take the number from `pr create --json`.
- `/repositories` writes its search into the URL (`?q=`). The `/worktrees` search box did not
  change the URL when driven here, so do not assert on it.
- The slug in `New repository` is derived from the name (`UI Created` becomes `ui-created`).
  Proof is the `repo list` readback, not the toast or the redirect.
- The README states that narrow screens use a drawer, that PR links keep list filters in the
  URL, and that the sidebar follows the language and color theme. None of these has been driven here.
- `Repository (experimental)` is in the label. Look it up by that name, not `Repository`.
