# Spec: Repository View

## Experimental status

Repository View is an experimental browser-only theme. Wiki-style remains the default and is unchanged for users who do not opt in. The selected theme is stored in browser local storage; the server does not receive or persist it.

## Objective

Add a GitHub/GitLab-style presentation of a Team Space while keeping the current wiki-style Space presentation. The two views are alternate navigation modes over the same Space, Nodes, Resources, Apps, and Worktrees.

The product mapping is intentionally one-to-one:

| Repository view | Existing Workspace concept |
|---|---|
| Repository | Team Space |
| Repository data | Team Space Nodes and Resources |
| PR / MR | Team Space Smart Workbench / Worktrees |
| Pages | Team Space Apps (`.univer.html`) |
| Repository landing document | Selected Team Space `.univer.html` |

The accepted C-style sidebar composition is the design reference for this experimental view. The throwaway prototype is not part of the product source tree.

## Scope

### V1

1. Treat each Team Space as exactly one repository. Do not add a `repositories` table.
2. Add a repository-style entry and C-style sidebar to the Team Space experience.
3. Show the current Team Space's data through existing Node/Resource browsing.
4. Show the existing Smart Workbench / Worktree page under the PR/MR navigation item.
5. Show the existing Apps page under the Pages navigation item.
6. Select one `.univer.html` from the current Team Space and render it as the repository landing Page.
7. Keep the existing wiki-style Team Space route and allow switching between modes without changing permissions or data.

### Deferred

- Repository-specific members or ACL.
- Repository transfer, archive, fork, branch, commit, or merge semantics.
- New PR/MR storage or review state.
- New Page storage or publication state.
- New README.md content type.

## Data and ownership

No new database table is required for the first implementation. Team Space identity remains the authoritative repository identity. The server resolves the current Team Space from the authenticated session and route `spaceId`, then reuses the existing Access Resolver for every child route.

`.univer.html` files remain existing Blob Resources. The existing HTML View query already identifies them using the filename suffix. Multiple Apps may exist in one Team Space.

### Landing App selection

The experimental theme stores the selected App in browser local storage under a key scoped by Team Space. `NULL` is represented by an absent key. If the stored Node is missing, inaccessible, or no longer a `.univer.html`, the browser falls back to the first readable matching App returned by the existing HTML View query. The choice does not change server data or permissions.

## Navigation and routes

The wiki view remains available at its current Space route. The experimental theme is selected in the global settings dialog and stored locally in the browser. It changes the navigation and page composition only; it does not change the URL contract, server data, or permission model.

- `/spaces/{spaceId}?view=repository` — repository overview
- `/spaces/{spaceId}/repositories/apps` — Apps/Pages list and landing selection
- `/spaces/{spaceId}/repositories/reviews` — existing Smart Workbench / Worktree dashboard

The exact TanStack Router filenames should follow the generated route convention already used in `apps/workspace/web/src/routes`.

## HTTP contract

Do not add repository CRUD endpoints. Reuse and, where necessary, extend existing Space, Node, HTML View, and Worktree endpoints.

Required behavior:

- `GET /api/spaces` continues to return Team Spaces. The Browser labels a Team Space as a repository only in repository mode.
- Existing Space and Node endpoints remain the authority for identity, data, and permissions.
- Existing `GET /api/html-views` returns all readable `.univer.html` Apps. Add an optional `spaceId` filter only if the current response cannot be filtered client-side without loading unrelated spaces.
- Existing Worktree list endpoints remain the source for PR/MR entries. Add a Team Space filter only if the current query cannot already express it.

All new or changed HTTP behavior must update OpenAPI source, generated types, server routes, Browser queries, and focused tests together.

## UI design

### C-style sidebar

Desktop sidebar groups navigation into:

- **Team Space**: repository overview and repository data;
- **Workspace**: PR / MR, Pages, and Activity;
- **Team Space management**: Members and Settings.

The sidebar is a navigation shell. It is not a new permission boundary. Every target route still performs server-side access resolution.

### Repository overview

The overview keeps the prototype hierarchy:

- current Team Space/repository identity;
- recent data from the existing Node browser;
- PR/MR link to the current Smart Workbench;
- Pages link to the current Apps list;
- selected `.univer.html` rendered as the default landing content;
- explicit empty state when the Team Space has no Apps;
- `Set as repository Page` action when multiple Apps exist.

### Apps / Pages

Pages is a presentation of the current Team Space's Apps. It lists readable `.univer.html` Nodes using the existing tree and HTML View components. One item has a “Repository Page” marker. Selecting another item updates the Team Space landing preference; opening an App still uses the existing `/apps` route and binding runtime.

### PR / MR

PR/MR is a label and navigation entry for the existing Smart Workbench. V1 does not introduce Git branches, commits, merge requests, or a second review state. The Worktree dashboard remains authoritative.

### View switching

The switch must preserve `spaceId`, must not mutate data, and must not create a session or permission model. URL state is sufficient for V1; cross-session user preference persistence is deferred.

### Accessibility and responsive behavior

- Use semantic `header`, `nav`, `main`, `aside`, and list landmarks.
- All icon-only controls have accessible labels.
- `.univer.html` selection has a visible label and keyboard-accessible control.
- The desktop sidebar collapses behind a keyboard-accessible menu at mobile widths.
- Verify at 320px, 768px, 1024px, and 1440px.

## Project structure

```text
apps/workspace/web/src/features/repository-view/
  repository-sidebar.tsx
  repository-overview.tsx
  repository-app-selector.tsx
  repository-view.queries.ts
  index.ts
apps/workspace/web/src/routes/
  spaces.$spaceId.tsx                 # mode switch and overview host
  spaces_.$spaceId.repositories.apps.tsx
  spaces_.$spaceId.repositories.reviews.tsx
apps/workspace/server/src/modules/spaces/
  # optional landing_app_node_id persistence and validation
apps/workspace/contracts/http/
  # additive Space/App query contract changes only when required
```

The design reference is not a production data source.

## Code style and boundaries

Use existing named exports, strict ESM, React Query for server state, TanStack Router search validation for shareable view state, and existing UI primitives/tokens. Keep fetching separate from presentation. Reuse `AppsSidebarSection`, `app-tree`, `selectedHtmlView`, the Node browser, and Worktree dashboard where they already provide the needed behavior.

Always:

- derive repository identity from Team Space;
- use the existing Access Resolver for Space, Node, Resource, App, and Worktree access;
- keep `.univer.html` bytes and metadata in Blob/Resource storage;
- validate the selected App against the current Team Space in the browser and use the existing server-side App/Resource checks;
- update contract source and generated files together.

Ask first:

- adding `landing_app_node_id` to `spaces` versus creating `space_view_preferences`;
- changing the `/apps` or `/worktrees` HTTP query shape;
- changing the existing Smart Workbench semantics;
- changing database migration version or deployment behavior.

Never:

- create a `repositories` table for a 1:1 alias of Team Spaces;
- duplicate Nodes, Resources, Worktrees, HTML View bytes, or permissions;
- introduce repository-specific ACL before a separate requirement exists;
- trust client-provided Space, Node, App, or Worktree identity;
- edit generated OpenAPI or route files by hand.

## Commands

Focused checks:

```bash
pnpm --filter @univerjs/univer-workspace api:verify
pnpm --filter @univerjs/univer-workspace typecheck
pnpm --filter @univerjs/univer-workspace test
```

Repository checks before delivery:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @univerjs/univer-workspace test:production-import
```

## Testing strategy

- Space/service tests cover landing selection ownership, suffix and readiness validation, fallback ordering, and clearing the selection.
- Browser query tests cover Team Space filtering and selected landing App state.
- Route tests cover wiki/repository mode switching, inaccessible Space behavior, empty Apps state, and links to existing Worktree and Apps routes.
- Browser checks cover keyboard navigation, mobile sidebar behavior, loading/error/empty states, and default App rendering.
- Do not add tests that only mirror JSX structure.

## Success criteria

1. A Team Space can be opened in wiki mode or repository mode with the same authoritative data and permissions.
2. Repository mode does not create or require a repository table.
3. The C sidebar reaches Team Space data, existing Smart Workbench, existing Apps, Members, and Settings.
4. The overview renders the selected `.univer.html` by default and provides an explicit empty state when none exists.
5. A Team Space with multiple `.univer.html` Apps can choose one as the repository Page; invalid selections fall back safely.
6. PR/MR shows the existing Team Space Smart Workbench rather than a parallel review model.
7. Pages shows the existing Team Space Apps rather than a parallel publication model.
8. Existing wiki-style routes continue to work.
9. OpenAPI, Browser queries, server behavior, migration code, and tests agree.

## Open questions

1. Should “Set as repository Page” later become a shared Team Space preference? V1 keeps it browser-local because Repository View is experimental.
2. Should the first repository-mode URL be a new route segment or `?view=repository` on the existing Space route? V1 uses the global local theme setting.
3. Should “Set as repository Page” require Space editor access, or Space admin access, if it becomes server-backed? The recommended default is editor, matching content organization permissions.
