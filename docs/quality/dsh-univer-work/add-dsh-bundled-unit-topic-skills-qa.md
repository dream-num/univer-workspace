# add-dsh-bundled-unit-topic-skills QA

状态：**PASS；0 open findings；READY TO ARCHIVE**

范围：独立验证 OpenSpec `add-dsh-bundled-unit-topic-skills` 的 7 项任务、delta spec、design、domain authority、
core + 7 bundled Skill sources、native registry lifecycle、42-tool drift gate、actual tarball/installed Native 与
Code Mode、CLI compatibility、docs/visual 与收敛 gates。本 QA 只修改本报告；未修改产品、tests、tasks、
planning、review，未 commit、push 或 archive。

## Findings ledger

| ID | Severity | Evidence | Resolution | Status |
| --- | --- | --- | --- | --- |
| WT-BUS-QA-001 | High（初始误判） | 初查遗漏 `space-node.test.ts:1328-1338` 的 equality bridge。该 test mount 真实十个 owner，从 `ctx.tools.schemas()` 取得 sorted Workspace catalog，先要求它与 42 项 `ACCEPTED_WORKSPACE_TOOL_NAMES` exact equality，再以同一 catalog 验证七份真实正文。mutation matrix 调用同一 validator。 | 独立 focused `space-node.test.ts` 纳入最终 3 files / 170 tests。真实 catalog equality 已排除手写 authority 与 mounted surface 分叉；该 composition/validation 路径不执行 tool，不读取 credential，不 fetch Workspace。每个 mutation 不需要再次 remount 十个 owner。 | **CLOSED / VERIFIED** |
| WT-BUS-QA-002 | High | 最初实现用七个 `SKILL.md?raw` import，built Host 内联正文。删除或损坏 tarball 中的文件不会使 installed activation 失败，违反 package-relative source 和 zero-contribution failure。 | `loadBundledWorkspaceSkills()` 现在从 `dirname(dirname(fileURLToPath(import.meta.url)))/skills/<name>/SKILL.md` 同步读取全部七份文件并在任何 registration side effect 前整体验证；Host verifier拒绝内联七个 exact descriptions。explicit-Chrome installed smoke分别删除和破坏 packed `base/SKILL.md`，activation 均拒绝，Workspace schemas 和七项 contributions 均为空；恢复后 Native/Code/dispose/remount正例通过。 | **CLOSED / VERIFIED** |
| WT-BUS-QA-003 | High | Base fenced JS 原先引用未定义 `unitId`；Sheet fenced JS 原先引用未定义 `sheet`。按实际 `workspace_content_execute` prelude直接执行会抛 `ReferenceError`，使已打包指导不可执行。 | Base先定义 `const unitId = "<selected-unit-id>"` 再 `api.getBase(unitId)`；Sheet先从已注入的 `workbook` 取得 `getActiveSheet()`，再订阅 calculation、写 formula。semantic gate增加存在性、顺序和反向 mutation。独立从 actual tarball读取两段 JS，确认 source/packed byte identity，并以 documented prelude执行通过。 | **CLOSED / VERIFIED** |
| WT-BUS-QA-004 | Hygiene observation | 最终 smoke 后审计发现一个 18:39 的历史 `dsh-univer-work-smoke-F19L9M` root；无相关存活进程或 holder，本次独立 smoke自己的 root已清理。 | Owner只对该 exact、已验证为 `0700` 非 symlink 的直接 temp child执行非 force删除；未 glob/prune。QA复查为 0 个 `dsh-univer-work-smoke-*` roots、0 个相关进程，repo未改变。 | **CLOSED** |
| WT-BUS-QA-005 | High | 最初 forbidden-syntax regex只覆盖有限的 `/Users/...`、Windows `\\Users\\...` 和部分 whitespace-delimited options；普通 POSIX absolute、Windows forward-slash drive root、反引号/引号/括号边界及 equals-form Commander option可绕过 source/packed gate，违反 spec 的 absolute checkout path / Commander syntax fail-closed要求。 | verifier改为识别任意 delimited POSIX absolute、Windows slash/backslash drive root、short/long option及 equals-form，同时保留普通 hyphenated prose。独立 probe逐项注入 10 个单一 token，全部只得到 `base: prohibited CLI or checkout syntax`；3 组合法连字符 prose和七份真实正文继续通过。real-catalog focused与 actual packed verifier均通过。 | **CLOSED / VERIFIED** |

## 验收矩阵

| Task | 独立证据 | 结论 |
| --- | --- | --- |
| 1.1 五个 Unit Skills | Skill root恰为 `core`、`base`、`board`、`cross-unit-formula`、`doc`、`embed`、`sheet`、`slide`。七份新增 frontmatter 都只有 `name` 与 `description`。static validator 对 source 和 actual packed copies通过；operation token数分别为 Base 11、Board 12、Doc 14、Sheet 12、Slide 18，required/forbidden rows和 Facade/ordering anchors通过。Base/Sheet executable-prose回归见 QA-003。 | PASS |
| 1.2 两个 Topic Skills | `embed` 与 `cross-unit-formula` 各引用 5 项 accepted operations；ResourceRef、stable Source Unit identity、qualifier binding、lazy read-only load、calculation/read-back顺序 anchors存在。validator拒绝 staging、inspection、exchange/generation、CLI/checkout syntax和 second core。 | PASS |
| 2.1 native lifecycle | Loader先读取并验证全部七份 installed files。real SkillRegistry tests确认 `source: bundled`、`provider: runtime`、native default双 invocation、first-winner shadowing、partial-registration rollback、exact reverse disposal；authentication effect在其它 owner/tool registration前调用 loader。 | PASS |
| 3.1 42-tool drift gate | real composed registry exact等于 42-name authority后验证七份 body。focused negatives覆盖 missing、forbidden、unknown、renamed、stale chart owner、CLI、`skills get`、absolute path及新增 Base/Sheet ordering drift；失败路径零 credential、fetch、Workspace tool execution。 | PASS |
| 4.1 tarball closure | `package:verify` 重建并 dry-pack 成功；closure恰含 runtime、README/LICENSE/config、`skills/core/SKILL.md` 加七份 Markdown，没有 Skill supplemental resource或 install lifecycle generator。packed sources通过同一 matrix；Host没有内联七份正文，runtime不读 CLI Skill或 checkout path。 | PASS |
| 5.1 installed Native / Code Mode | fresh profile、unrelated cwd、empty project/DSH/AGENTS roots、无 Workspace grant下，explicit-Chrome smoke通过。真实 Native 与 Code Mode `skill` consumer均按需加载七份 packed body；plugin不新增 provider/root/watcher，credential、approval、HTTP、browser基线不变；dispose清空 contributions，remount恢复并再次清理。missing/malformed installed artifact负例见 QA-002。 | PASS |
| 6.1 docs / compatibility / closure | proposal引用 repo-relative `apps/workspace/CONTEXT.md` 和 accepted ADR 0007；README、DREAMNUM、AGENTS、DSH README和 `change.html` 一致描述 core + seven、Client Shell/private Core边界及 no provider/root/watcher。CLI frozen coordinate `a01adf28bfdfbf098ecf66653d520d08ecac4117` 下八份 Skill data、command和command test无 diff；独立 CLI compatibility test通过。OpenSpec为 7/7、strict和 global diffcheck通过。 | PASS |

## 独立运行记录

- `pnpm --filter dsh-univer-work exec vitest run --config vitest.config.ts test/bundled-skills.test.ts test/authentication.test.ts test/space-node.test.ts`：3 files / 170 tests PASS。
- `pnpm --filter dsh-univer-work typecheck`：PASS。
- `pnpm --filter univer-workspace-cli exec vitest run test/workspace-skills-command.test.ts`：1 file / 2 tests PASS。
- `pnpm --filter dsh-univer-work package:verify`：clean build、actual pack、exact closure、packed body/matrix、no-inline checks PASS。
- `UNIVER_RENDER_BROWSER='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' pnpm --filter dsh-univer-work package:smoke`：PASS，`dsh web` ready；包含 installed missing/malformed negatives和 positive Native/Code/dispose/remount matrix。
- 独立 dry-pack probe：Base/Sheet packed bytes分别与 source exact equality；两段 fenced JS使用 documented prelude执行 PASS；probe temp root在 `finally` 清理。
- `openspec validate add-dsh-bundled-unit-topic-skills --strict`、`git diff --check`：PASS。
- `openspec status` / `instructions apply`：planning complete，7/7 complete，0 remaining，`all_done`。
- 最终 residual audit：0 个 `dsh-univer-work-smoke-*` temp roots；0 个 smoke/web/content-worker相关存活进程。

## Final verifier follow-up

- 独立 isolated probe：POSIX `/opt/work/SKILL.md`、Windows `C:\\work\\SKILL.md`、`C:/work/SKILL.md`、
  backticked `-f` / `--json` / `--worktree=id` / `-f=code`、quoted `"--json"`、parenthesized
  `(--json)` / `(-f)` 共 10 个 case逐项 fail closed；每个 case只新增一个禁止 token，未删除 required
  operation或 semantic anchor，错误均精确标识 `base: prohibited CLI or checkout syntax`。
- `long-term`、`read-only`、`package-relative`、`same-name`、`one-based`、`zero-based` 等正常 prose
  control通过；全部七份 legitimate Skill content通过。
- `pnpm --filter dsh-univer-work exec vitest run --config vitest.config.ts test/bundled-skills.test.ts test/space-node.test.ts`：
  2 files / 111 tests PASS；其中 production composition再次证明 real catalog exact 42-name equality。
- `pnpm --filter dsh-univer-work package:verify`：fresh build、actual tarball source/packed syntax gate与 closure PASS。
- `openspec validate add-dsh-bundled-unit-topic-skills --strict`、`git diff --check`：PASS。
- runtime loader、Skill bodies与 installed behavior未变；按 follow-up 范围未重复 full installed smoke。

此次独立复验选择与本 Change 风险直接相关的 focused、typecheck、actual package、installed runtime、CLI
compatibility、strict/diff gates；未重复运行未改 Server/Browser/database/deployment 的全仓测试矩阵。

## 最终坐标

- planning：proposal `c5c3f0c90b3d7222c340a74fd5344714e2b8e9a6`；design `dfc6919cc8d727ff13a71987731be6c24f209c20`；tasks `3721e7bb2066800a0e5b5f314f48a7d0006616bb`；delta spec `752804b3d20104657870f7ab9474fb4ac060ee73`；`change.html` `cf91855a836621718c449a73d08923fed6548e1b`。
- review-fix implementation：loader `840622acd4a7410258258e1620c34341a3e7d0f3`；authentication `e44b4d4c4776991b74b1cd546a6ce6356e2e00f7`；focused test `b48649171045a38f6351c2d075cee54e1ac47c4a`；contract `98247efbd4ad9188c5e1fd84a81b75bff2b5b2cb`；verifier `ca56809a025c3878406a5a2d193d7cdbd70f9852`；installed smoke `82bef9430c5027dbd08a11e5842f7f3353b8b88e`；Base `41f673cae0bc710c22597ba54e8f49e5cef9b71c`；Sheet `b9aee6572385cbf674d685896b90e3d3b521a20e`。
- final verifier follow-up：contract `0d63f6952a1982d6c0a4e9394a5cf71545a00390`；focused test `7b25eebed57b505fdd1070a0e5c970ff02d7978b`；package verifier保持 `ca56809a025c3878406a5a2d193d7cdbd70f9852`；runtime loader和八份 Skill blobs保持不变。
- final built Host：`apps/dsh-univer-work/dist/index.js` `48731f6f2e5e3e826d4bc1e6e88b0b87016e28ac`。

结论：全部四个行为 finding 已关闭，历史 temp hygiene observation已收敛；7/7 tasks与所有 delta
spec scenarios具有独立证据，当前 Change **PASS / READY TO ARCHIVE**。
