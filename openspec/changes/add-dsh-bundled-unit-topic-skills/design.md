## Context

Workspace CLI owns eight installed Skills. Change 4 already assigns the DSH-adapted `core` Skill to `apps/dsh-univer-work`; this Change owns the other seven. DeepSeek Harness `0.1.1-rc.2` does not discover arbitrary `SKILL.md` files inside an external plugin package. A Host contribution enters the catalog only through `ctx.skills.register()`, which defaults omitted invocation policy to `{ modelInvocable: true, userInvocable: true }` and omitted provider to `runtime`.

The seven CLI sources contain validated Facade and workflow knowledge, but also Commander commands, CLI options, CLI Skill loading and path/output language. The following accepted Changes own the complete tool catalog against which this Change verifies guidance:

| Owner Change | Exact operations |
| --- | --- |
| `add-dsh-univer-work-authentication` | `workspace_auth_start`, `workspace_auth_complete`, `workspace_auth_whoami`, `workspace_auth_logout` |
| `add-dsh-space-node-tools` | `workspace_space_list`, `workspace_space_browse`, `workspace_space_find`, `workspace_node_create`, `workspace_node_rename`, `workspace_node_move`, `workspace_node_trash` |
| `add-dsh-worktree-unit-tools` | `workspace_worktree_list`, `workspace_worktree_get`, `workspace_worktree_create`, `workspace_worktree_update`, `workspace_worktree_ready`, `workspace_worktree_reopen`, `workspace_worktree_merge`, `workspace_worktree_discard`, `workspace_unit_list`, `workspace_unit_add`, `workspace_unit_create`, `workspace_worktree_review_url` |
| `add-dsh-file-transfer-tools` | `workspace_blob_get`, `workspace_blob_upload`, `workspace_blob_download`, `workspace_asset_download` |
| `add-dsh-content-runtime-tools` | `workspace_content_execute`, `workspace_content_inspect` |
| `add-dsh-office-exchange-tools` | `workspace_office_import`, `workspace_office_export` |
| `add-dsh-typst-generation-tools` | `workspace_typst_compile`, `workspace_typst_apply` |
| `add-dsh-svg-generation-tools` | `workspace_svg_compile`, `workspace_svg_apply` |
| `add-dsh-render-verification-tools` | `workspace_screenshot`, `workspace_layout_lint` |
| `add-dsh-api-resource-discovery-tools` | `workspace_api_find`, `workspace_api_show`, `workspace_resource_registries`, `workspace_resource_find`, `workspace_resource_export` |

`add-dsh-univer-work-plugin-shell` owns packaging/lifecycle but adds no tool. The previous combined `add-dsh-discovery-and-skills` draft crossed the Tina size gate; discovery and static guidance now have independent owners.

## Goals / Non-Goals

**Goals:**

- Ship exactly seven DSH-native Unit/Topic Skills beside the exact tools and SDK behavior they describe.
- Make every executable reference mechanically checkable against the installed tool catalog.
- Use native Skill catalog precedence, default invocation and disposal without a parallel registry.
- Prove keyless catalog/load/dispose behavior from the packed tarball.

**Non-Goals:**

- Do not transform CLI Skill files at runtime or installation, share application source paths, or modify the CLI copies.
- Do not add a dynamic provider, filesystem watcher, Skill tool, eager prompt block or supplemental Skill resource tree.
- Do not move Facade or Workspace authority into prose.

## Diagram design

```text
seven package SKILL.md files ─┐
                              ├── source/package gate ──> same tarball
installed workspace_* catalog ┘                           │
                                                          ▼
Host registers each ──> native SkillRegistry ──> skill consumer
       └── reverse exact disposers
```

## Decisions

### 1. Own seven static DSH copies beside the plugin

The application owns these exact sources:

```text
apps/dsh-univer-work/skills/base/SKILL.md
apps/dsh-univer-work/skills/board/SKILL.md
apps/dsh-univer-work/skills/cross-unit-formula/SKILL.md
apps/dsh-univer-work/skills/doc/SKILL.md
apps/dsh-univer-work/skills/embed/SKILL.md
apps/dsh-univer-work/skills/sheet/SKILL.md
apps/dsh-univer-work/skills/slide/SKILL.md
```

Each begins from the corresponding CLI Skill's current Facade, identity, authoring and verification knowledge, then replaces every CLI execution path with accepted DSH operations. The implementation does not import `apps/cli`, read its artifact, generate from sibling files during build, or add a cross-application Skill package. The copies may evolve together in repository changes when shared SDK facts change, while each Client Shell retains its own delivery language.

The five Unit Skills cover `base`, `board`, `doc`, `sheet` and `slide`. The two Topic Skills cover Embed and cross-Unit formulas. Each body directs the Agent to load `core` and the applicable Unit/Topic guidance through DSH's native catalog, without a `skills get` command. `core` remains a single file owned and registered by Change 4.

### 2. Keep frontmatter fixed to two interpreted fields

Every file uses only:

```yaml
---
name: <exact-name>
description: <non-empty one-line description>
---
```

The Host's small package loader accepts that fixed subset, strips it from the registered body and rejects extra keys, wrong names, empty descriptions or bodies before registration. It does not add a general YAML/frontmatter dependency. `allowed-tools` is deliberately rejected: rc.2's Skill filesystem parser does not interpret it as an invocation or authorization boundary, and runtime registration has no equivalent field.

The registration object explicitly sets `source: 'bundled'` and `provider: 'runtime'`, omits `resourceBase`, and omits `invocation` so the native default enables both model and user surfaces. Tests inspect the normalized catalog rather than duplicating that default in application configuration.

### 3. Enforce a per-Skill operation matrix and semantic anchors

The rewrite preserves the substantive SDK knowledge and changes only delivery-specific routing. The delta spec owns an exact required/forbidden operation matrix for all seven entries. That matrix is executable test data, not prose guidance: both source and packed copies must contain every required token, omit every forbidden token, and resolve every remaining `workspace_*` token in the real complete ToolRegistry.

The matrix makes these capability boundaries explicit:

- all five Unit Skills use Worktree/Unit/review operations from Change 4, content execute/inspect from Change 6, API lookup from discovery, and only their applicable Office, Typst, SVG, screenshot or lint operations;
- `base` and `board` use read-only `workspace_content_execute` where no native inspect target exists;
- `board` does not claim Office exchange;
- `doc` may use Office and Typst workflows; `sheet` may use Office; `slide` may use Office, SVG, resource discovery/export, screenshot and layout lint;
- `embed` and `cross-unit-formula` use API lookup plus Host-targeted content execution and keep Source identity explicit.

Operation coverage alone cannot prove that the rewritten guidance retained its substantive SDK facts. A second per-Skill anchor table is also checked in source and packed content:

| Skill | Required semantic anchors |
| --- | --- |
| `base` | Base has no injected `base`; resolve it with `api.getBase(unitId)`; table formulas distinguish `#This Row` from `#Data` and use `getFormulaName()`; attachment authoring uses `record.setAttachments()` with `ImageSourceType.BASE64`; later execution reads computed/attachment values back. |
| `board` | The selected runtime injects `board`; `insertShapes()` precedes bound `insertConnectors()`; `analyzeModelLayout()` precedes browser evidence and `normalizeConnectorRouting()` is bounded to one repair pass; native charts use direct `FBoard.newChart`/`await board.insertChart(info)` ownership; built-in images use stable resource handles. |
| `doc` | The selected runtime injects `doc`; paragraph offsets follow the `dataStream` and `\r`/`\r\n` model; physical pagination requires the Traditional guard; Typst compile/apply remains the formal-document path; native charts use direct `FDocument.newChart`/`await doc.insertChart(info)` ownership. |
| `sheet` | The selected runtime injects `workbook`; authoritative cell data distinguishes `v`, `t`, `f`, `s` and `p`; writes use explicit `ICellData`; `onCalculationResultApplied()` is registered before formula write/recalculation; later inspection separates stored from displayed values. |
| `slide` | Tool page selectors are one-based while Facade indexes are zero-based; new/reworked pages use SVG compilation and replacement rather than overlay repair; resource handles remain files; layout lint plus screenshot supplies final evidence; native charts use direct `FSlide.newChart`/`await slide.insertChart(info)` ownership. |
| `embed` | A Source uses the exact `#unit=<unitId>&type=<type>` ResourceRef; `loadAsync()` performs lazy read-only loading; later read-back matches the stable child ID/type and Host anchor; the Source is not staged merely for reading. |
| `cross-unit-formula` | The Host persists Source `unitId`, type and qualifier binding; `buildReference()` or `upsertExternalReference()` owns that binding; `onCalculationResultApplied()` is registered before the formula write; later execution reads formula and calculated result; the Source is not staged merely for reading. |

The existing CLI Skill contract test supplies the direct chart-owner/stale-name assertions for `board`, `doc` and `slide`; the DSH source and packed checks retain equivalent assertions while changing only the invocation language. The other anchors come directly from their current CLI Skill bodies and receive the same two-level source/packed check.

No Skill repeats authentication secrets, file-policy mechanics, approval implementation or error contracts. It names an operation and explains when to use its outcome; the tool remains the only enforcement boundary.

Source and packed checks extract literal `workspace_[a-z0-9_]+` tokens from each body. In a complete installed composition they compare those tokens with the actual ToolRegistry catalog listed above, rather than treating the required/forbidden matrix as the complete catalog. The same check rejects `univer-workspace-cli`, Commander flags, `skills get`, CLI config/Session/daemon language and checkout-absolute paths. A capability rename or missing semantic anchor therefore breaks packaging instead of silently shipping stale guidance.

### 4. Validate before registration and use exact native disposers

One fiber-owned effect reads and validates all seven package-relative files before the first call to `ctx.skills.register()`. It then registers the entries in deterministic name order, retains each returned disposer and yields cleanup that invokes them in reverse order. If registration unexpectedly throws, it immediately invokes already returned disposers before propagating the activation failure.

DSH runtime duplicates are first-wins within one layer, and nearer project layers may shadow a runtime entry. The plugin accepts that native behavior. A duplicate registration may return a no-op disposer; cleanup still calls the exact returned function and never looks up or removes a Skill by name. No `registerProvider()`, invalidation, polling, watcher, cache or network work is needed for immutable package resources.

### 5. Verify the installed catalog without Workspace credentials

Focused source tests cover fixed frontmatter parsing, all-before-side-effect validation, rewrite bans, real-catalog reference matching and reverse disposal. Integration tests use the actual SkillRegistry and `skill` tool to prove normalized source/provider/default invocation, on-demand body loading, native shadowing and complete cleanup.

Package verification asserts the seven files exist exactly once in the tarball and contain no monorepo dependency. The isolated smoke installs the tarball into a fresh local profile, sets empty isolated DSH and AGENTS homes, starts from an unrelated temporary project whose project Skill roots are empty, and provides no Workspace grant or network. DSH's default/scoped provider lookups may still run, and the filesystem provider may query those roots; the test asserts provider results are irrelevant to the seven runtime registrations and that `dsh-univer-work` adds no provider, root or watcher. It observes all seven unshadowed summaries, invokes every body through real Native and Code Mode ToolRuntime, and disposes the Host. The smoke does not execute the operations described by the bodies; loading guidance is keyless and side-effect free.

## Risks / Trade-offs

- **Seven owned copies can drift from CLI guidance** -> Keep exact names and focused semantic assertions for verified Facade contracts; update both application copies only when the underlying SDK fact changes.
- **A tool rename or missing workflow leaves stale prose** -> Apply the per-Skill required/forbidden matrix, semantic anchors and real installed-catalog check to both source and packed bodies.
- **A same-name Skill wins by native precedence** -> Accept DSH shadowing and retain exact/no-op disposers; do not introduce a competing catalog.
- **Static bodies consume package size** -> Markdown is the required guidance artifact; load bodies on demand and keep supplemental resources out until a real need appears.

## Migration Plan

1. Add and rewrite the seven package-owned Skill files.
2. Add the fixed loader, all-before-side-effect validation and native registrations.
3. Add real registry/tool tests and installed catalog-reference verification.
4. Extend the prebuilt tarball and isolated keyless smoke.

No persisted Workspace data, credential or user Skill directory changes. Rollback removes these seven package contributions; Change 4's `core` Skill and all installed operations remain.

## Open Questions

无。catalog、frontmatter subset、operation-reference authority、default invocation、shadowing、lifecycle 与 package closure 已由确认拆分、前序 Changes 和冻结 DSH source 收敛。
