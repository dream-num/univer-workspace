## 1. Exact discovery datasets

- [ ] 1.1 Add exact `@univer-cli/api-reference@1.0.0-beta.2`, `@univer-cli/resource-library@1.0.0-beta.2` and `@univerjs-pro/cli-assets@0.1.0` ownership to `apps/dsh-univer-work`, resolve datasets only from installed package exports, and verify valid/missing/malformed package data without CLI or checkout fallback.

## 2. API discovery tools

- [ ] 2.1 Implement `workspace_api_find` and `workspace_api_show` with closed schemas/results, exact-key validation, frozen fan-out/byte budgets, keyless execution and found/not-found projections; cover real ToolRuntime Native/Code Mode success, overflow, malformed output, abort and secret-free failures.

## 3. Resource catalog tools

- [ ] 3.1 Implement `workspace_resource_registries` and `workspace_resource_find` with closed bounded resource metadata that excludes SVG/source URLs/cache paths; test registry filters, defaults/maxima, invalid handles/registries, output validation and keyless cancellation.

## 4. Local resource export

- [ ] 4.1 Implement `workspace_resource_export` by reusing the Change 5 local constructor, current Session policy, cwd/derived-target containment and one-approval/body-recheck seam; verify read-only/non-local/outside-root no-effect rejection, approval denial, existing-file replacement and policy/path changes while approval is pending.
- [ ] 4.2 Add sequential signal-aware HTTPS/cache/output composition and closed `{ complete, exported, failed }` projection; test controlled downloads, allowlisted per-handle failures, partial confirmed files, caller/owner cancellation, no replay and private cache cleanup.

## 5. Seven bundled Skills

- [ ] 5.1 Add and adapt exactly `base`, `board`, `cross-unit-formula`, `doc`, `embed`, `sheet` and `slide` under the DSH application, replacing every CLI-only instruction with accepted DSH tools while preserving Facade/Workspace semantics; verify frontmatter, non-empty bodies, forbidden CLI syntax and every `workspace_*` reference against the installed tool catalog.
- [ ] 5.2 Validate all seven definitions before side effects, explicitly register each through `ctx.skills.register()`, and dispose exact registrations in reverse order; cover atomic activation failure, keyless list/get, native shadowing behavior and full catalog cleanup with real SkillRegistry.

## 6. Installed closure and repository gates

- [ ] 6.1 Extend package verification and isolated tarball smoke to prove exact datasets, seven Skill files, five tools, local HTTPS export, bounded keyless Native/Code Mode transcripts and load/dispose from an unrelated cwd; update responsibility docs and run focused app checks, repository SDK-baseline/typecheck/test/build, CLI package smoke and `git diff --check`.
