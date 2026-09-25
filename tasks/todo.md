# Team Space Repository View

- [x] Task 1: Add repository-mode shell and C sidebar to the existing Team Space route
  - Acceptance: Global settings switches between default Wiki and experimental Repository themes; the choice survives reload in browser local storage; sidebar links to data, Smart Workbench, Apps, Members, and Settings; no repository table or API change is added.
  - Verify: `pnpm --filter @univerjs/univer-workspace typecheck`; manual check at 320px, 768px, 1024px, and 1440px.
  - Files: `apps/workspace/web/src/routes/spaces.$spaceId.tsx`, `apps/workspace/web/src/features/repository-view/*`.

- [x] Task 2: Add selected `.univer.html` landing App behavior
  - Acceptance: Overview renders the selected App; multiple Apps expose a keyboard-accessible selection action; invalid or deleted selections fall back deterministically; zero Apps has an actionable empty state.
  - Verify: focused query/service tests; `pnpm --filter @univerjs/univer-workspace test`.
  - Files: existing Space schema/service or preference table, HTML View queries, repository overview and selector components, contract sources if changed.
  - Dependencies: Task 1.

- [x] Task 3: Wire PR/MR and Pages labels to existing modules
  - Acceptance: PR/MR opens the current Team Space Smart Workbench; Pages opens the current Apps list; no parallel review or publication state is created.
  - Verify: route/browser navigation checks and focused tests.
  - Files: repository sidebar/overview routes and existing query composition.
  - Dependencies: Task 1.

- [x] Task 4: Complete contract, migration, and documentation verification
  - Acceptance: OpenAPI/generated types, migration behavior, Browser queries, and docs agree; wiki routes remain unchanged.
  - Verify: `pnpm --filter @univerjs/univer-workspace api:verify`, `pnpm typecheck`, `pnpm test`, `git diff --check`.
  - Files: affected contract/schema/migration/docs files only.
  - Dependencies: Tasks 2-3.

## Checkpoint

- [x] C sidebar and repository mode accepted in the existing Team Space flow.
- [x] Landing App persistence choice resolved: browser local storage; no schema migration.
- [x] Full focused verification passes before implementation is declared complete.

## Follow-up tasks from repository view audit

- [x] Task 5 [P1]: Harden repository-scoped navigation and states
  - Acceptance: Repository data opens the existing NodeBrowser; PR/MR and Pages show only the current Team Space; repository loading, error, retry, and empty states are distinct.
  - Files: repository route, Worktree/App query composition, existing route search contracts.
  - Dependencies: Tasks 1-3.

- [ ] Task 6 [P1]: Clarify repository copy and remove inactive controls
  - Acceptance: Repository overview labels are available in both supported languages; the repository search input filters visible data or is removed; empty and error messages describe the actual state.
  - Files: `apps/workspace/web/src/shared/i18n.tsx`, repository route and related UI.
  - Dependencies: Task 5.

- [ ] Task 7 [P2]: Filter HTML Views by Team Space at the query boundary
  - Acceptance: Repository pages request only readable `.univer.html` items for the current Team Space; client-side ownership filtering remains as a safety check; pagination remains correct.
  - Files: HTML View query, HTTP contract/server query if required, repository route tests.
  - Dependencies: Task 5.

- [ ] Task 8 [P2]: Improve mobile touch targets
  - Acceptance: Repository overview buttons, Page selector, and collapsed navigation controls meet a 44px touch target at mobile widths while retaining visible keyboard focus.
  - Files: repository overview and workspace navigation styles.
  - Dependencies: Task 5.

- [ ] Task 9 [P3]: Clear invalid landing App preferences
  - Acceptance: When a stored landing App is deleted or inaccessible, the browser falls back to the first readable App and removes the stale Team Space localStorage key.
  - Files: repository route landing App selection logic and focused tests.
  - Dependencies: Task 5.
