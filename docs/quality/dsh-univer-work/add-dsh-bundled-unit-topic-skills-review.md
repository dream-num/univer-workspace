# add-dsh-bundled-unit-topic-skills Review

状态：**PASS；Standards 0 open；Spec 0 open；READY TO ARCHIVE**

审查坐标：pre-Skills 产品树 `393f5f064987791736c7bccf750426a3a3fc9445`，最终产品树
`17cbb1bdac05441cc46ddd1fce0e2e5f7a8eb53d`。QA 报告与前序 SVG review 仅作证据，不计入产品 diff。
本 review 未修改 implementation、tasks、QA、archive、commit 或 push 状态。

## Findings history

| ID | Severity | Finding | Resolution | Status |
| --- | --- | --- | --- | --- |
| REV-BUS-001 | High | 七份 `SKILL.md?raw` 被内联进 Host；删除或损坏 installed Markdown 后仍可从内联副本注册，违反 package-relative authority 与 malformed zero-contribution 合同。 | `bundled-skills.ts` 改为从 installed `dist/../skills/<name>/SKILL.md` 读取并整体验证；authentication effect 在任何 tool/Skill side effect 前调用 loader。installed smoke 分别删除和破坏 packed Base 文件，mount 均失败且 Workspace schemas、七项 contribution 为零；built Host verifier拒绝七正文内联。 | **CLOSED** |
| REV-BUS-002 | Medium | Base fenced JS 使用未定义 `unitId`，Sheet fenced JS 使用未定义 `sheet`；按真实 content-execution prelude 执行会 `ReferenceError`。 | Base 先声明 selected `unitId`；Sheet 先从 injected `workbook` 取得 active Sheet。source/packed anchors 固定存在性和执行顺序，actual packed snippets 已用 documented prelude 执行。 | **CLOSED** |
| REV-BUS-003 | Medium | drift regex 漏掉 Linux/一般 Windows absolute path、Markdown code span 中的 Commander option、任意 short option 与 `--name=value`；组合负例可能由另一 trigger 掩盖。 | shared validator 现覆盖 POSIX root、Windows 两种 separator、whitespace/backtick/quote/paren-delimited short/long option 和 `=` boundary。isolated negatives 分别覆盖 `-f`、`--json`、`--worktree=id`、POSIX、Windows backslash/forward-slash、CLI executable 与 `/Users`，七份真实正文无误报。 | **CLOSED** |

## Standards

**0 open findings.**

- `apps/dsh-univer-work` 保持 Client Shell owner：七份静态 Skill、固定 parser、native registration 与 package checks 均留在 application；没有把 delivery contract 推入 private Core，也没有读取 CLI source。
- loader 是当前合同所需的窄同步 package reader；两字段 frontmatter parser、一个 contract map 和 exact native disposer 没有发展成通用 YAML、第二 registry、provider、root、watcher、timer、cache 或 network layer。
- native first-wins/no-op disposer、partial-registration rollback、reverse exact cleanup 与 plugin disposal 使用 rc.2 原生合同。42-name 常量由真实挂载的十 owner ToolRegistry exact-equality bridge 约束，不为每个纯 mutation 重建 composition。
- 七份 description 可区分 Unit/Topic intent，正文只保留影响决策的 version-matched Facade、identity、authoring 与 verification guidance。Base/Sheet 可执行片段与真实 prelude 一致；其余示例没有伪造 authority、approval 或 success。
- root、DREAMNUM、DSH README 与 change visual 记录当前 core + seven 事实和职责边界；文本未提前声称 provider、Web、Server、public SDK 或 release 能力。
- Fowler smell baseline 与 Ponytail minimality follow-up 未发现 hard breach 或新增 judgement-call smell。

## Spec

**0 open findings；ready.**

- catalog 恰为 `base`、`board`、`cross-unit-formula`、`doc`、`embed`、`sheet`、`slide`；`core` 仍由前序 Change 独占。frontmatter 只有 exact `name`/`description`，正文非空。
- required/forbidden operation matrix、semantic anchors 和所有 literal `workspace_*` token 同时检查 source 与 actual packed copies；真实 mounted catalog 与 42-name authority 精确相等。CLI syntax、options、absolute paths、unknown/deferred tools 均 fail closed。
- Host 在注册前读取并验证全部七份 installed files；missing/malformed failure、unexpected partial registration、native shadowing、reverse disposal、Host dispose/remount 均有真实 SkillRegistry 或 installed evidence。
- actual tarball 恰含 core 加七份 Markdown，Host 不内联七正文。unrelated cwd、empty project/DSH/AGENTS roots 下的真实 Native 与 Code Mode `skill` consumer 加载 packed bodies；Skill load 不读 credential、不请求 approval/HTTP、不启动 browser，plugin 不增加 provider/root/watcher，dispose 后 contributions 消失。
- CLI 八份既有 Skill source blobs 与冻结基线逐一相同；Change 未扩展 Client Core、Workspace Server/Browser、OpenAPI、database、deployment、Commander 或 release behavior。

## Verification

- 双轴 code-review 初审与修复后并行 follow-up：Standards 0 open；Spec 0 open。
- `pnpm exec vitest run --config vitest.config.ts test/bundled-skills.test.ts`：1 file / 6 tests PASS。
- `pnpm typecheck`（`apps/dsh-univer-work`）：PASS。
- `node scripts/verify-package.mjs`：actual pack、exact closure、packed matrix、runtime graph 与 no-inline checks PASS。
- `node --check`：`skill-contract.mjs`、`verify-package.mjs`、`smoke-package.mjs`、built Host PASS。
- `openspec validate add-dsh-bundled-unit-topic-skills --strict`、frozen-tree/global `git diff --check`：PASS。
- Final QA 的 explicit-Chrome installed smoke、Native/Code/dispose/remount、missing/malformed artifact negatives与 residual audit：PASS，0 temp/process residual。

结论：三个 review finding 均已关闭；Standards 与 Spec 当前均为 **0 open**。Change 可进入用户明确授权的 archive 步骤，本 review 不执行 archive。
