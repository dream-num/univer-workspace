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
