> Implementation root: `~/github.com/dream-num/univer-workspace`. Do not create product code in this planning repository. Apply only after `extract-worktree-unit-client-core`, `extract-runtime-target-client-core` and `extract-content-runtime-client-core` are complete; Changes 1–2 are transitive prerequisites, while `extract-file-transfer-client-core` is only an ordered predecessor.

## 1. Confirm direct prerequisite boundaries

- [x] 1.1 Verify the target repository contains the completed Client Core Worktree-local Unit create, runtime target resolution and content-runtime UnitData export public operations from Changes 3, 5 and 6; record their exact names and run `pnpm --filter @univerjs/univer-workspace-client-core typecheck` before editing, stopping instead of creating parallel Unit, target, runtime or daemon seams if any prerequisite is absent.

## 2. Move Office policy and Node conversion ownership

- [x] 2.1 Add Office input/output suffix inference, Unit type compatibility, conversion-option construction and the default Node exchange adapter to `@univerjs/univer-workspace-client-core` public exports; move the real XLSX round-trip test and verify the full suffix/type matrix, presentation format overrides, exact formula options and native fixture round trip with `pnpm --filter @univerjs/univer-workspace-client-core test`.

## 3. Move the import workflow

- [x] 3.1 Move Office import, name precedence, converted UnitData preparation and Worktree-local Unit result validation into Client Core, reusing the prerequisite create operation and preserving the supplied idempotency key; verify explicit/imported/fallback names, Sheet/Base/Doc/Slide creation, Space/parent/Worktree identity, unsupported formats and result-mismatch cases with the Client Core test command.

## 4. Move the export workflow

- [x] 4.1 Move Office export into Client Core using the prerequisite target resolver and UnitData export operation; verify Board rejection, output suffix/type compatibility and validation order, exact target revision/Unit identity, invalid UnitData rejection, converter options and unchanged output path/result with `pnpm --filter @univerjs/univer-workspace-client-core test`.

## 5. Reduce the CLI to presentation, daemon and artifact adapters

- [x] 5.1 Switch CLI program composition and exchange commands to package exports, adapt the existing `runtime.export-unit-data` RPC to the Core operation, remove the superseded CLI exchange owner/tests, and update Client Core/CLI manifests, exports, build graph and responsibility docs; retain `@univerjs-pro/exchange-node-binding` as a CLI artifact runtime dependency, then verify command/JSON/text/RPC behavior, Client Core build, CLI typecheck/tests, package manifest verification and installed binding load with `pnpm --filter @univerjs/univer-workspace-client-core build`, `pnpm --filter univer-workspace-cli typecheck`, `pnpm --filter univer-workspace-cli test`, `pnpm package:workspace-cli`, `pnpm --filter univer-workspace-cli package:verify` and `pnpm --filter univer-workspace-cli package:smoke`.

## 6. Run the compatibility gate

- [x] 6.1 From a clean target-repository build state, run `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm package:workspace-cli`, `pnpm --filter univer-workspace-cli package:verify`, `pnpm --filter univer-workspace-cli package:smoke` and `git diff --check`; record that Office formats/options, Worktree Unit/runtime behavior, CLI command/results/errors, daemon protocol, native binding delivery, SDK baseline and installed artifact remain unchanged and contain no workspace bare import or source-checkout dependency.

## Implementation notes

- Baseline virtual tree: `fe8a216126594211da39116414cfe29129ad20e4`.
- Direct prerequisites verified from the Client Core package root before editing:
  `WorkspaceUnitFeature.create`, `WorkspaceContentSource.resolveRuntimeTarget`,
  `WorkspaceContentRuntimeOperations.exportUnitData`, `WorkspaceRuntimeTarget`, and
  `serializeWorkspaceRuntimeTarget`.
- Pre-edit `pnpm --filter @univerjs/univer-workspace-client-core typecheck`: passed.
- Final gates passed: frozen install, SDK dependency test, Core focused/full test and build,
  CLI focused/full test, typecheck and build, root typecheck/test/build, package build/verify,
  installed smoke, owner/scope/secret searches, and baseline-limited `git diff --check`.
- Product implementation tree (excluding this OpenSpec progress record):
  `b3896dd7052eeedca460b83d188e46d9aacb399d`.
- Office suffix/type/options, Worktree-local create and exact runtime target/revision behavior,
  CLI command/result/error and `runtime.export-unit-data` wire shape, SDK baseline, explicit native
  binding delivery, and self-contained installed artifact remained unchanged. Package artifact
  searches found no bare Client Core import, source-checkout dependency, or secret material.
