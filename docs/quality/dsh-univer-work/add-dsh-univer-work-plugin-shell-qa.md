# add-dsh-univer-work-plugin-shell QA

本文件定义并记录 Change `add-dsh-univer-work-plugin-shell` 的独立验收。QA 基线为 commit
`d2e51a25ef05bd662cb4a88ba6ff68236577269a`、tree
`381608c8eec5382d8985c3ce38358c479b1c89d8`。实现、QA 与 code review 由相互独立的
subagent 执行；本报告不替代 OpenSpec task 勾选，也不修改产品代码。

## 环境与边界

- Univer Workspace：Node.js `v24.19.0`、pnpm `11.24.0`、SDK baseline
  `1.0.0-beta.2`。
- DeepSeek Harness：真实 checkout
  `/Users/shenweimin/github.com/deepseek-ai/deepseek-harness`，commit
  `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`，CLI `0.1.1-rc.2`。
- 本 Change 的 shell 是 inert、Host-only、local-profile plugin。它不连接 Workspace，
  不需要启动 `127.0.0.1:3020`，也不执行 Agent turn 或业务 tool。
- 安装态验收必须使用预构建 tarball 和隔离 `DSH_HOME`。源码 import、workspace link、
  `--patch` overlay 或 Harness 私有 test-support 只能作为补充，不能代替安装态证明。
- QA 产生的 profile、tarball 与日志必须在系统临时目录中，并在成功和失败路径都清理；
  不得触碰用户既有 DSH profile。

## 验收标准

### Package identity 与 scope

- **AC-01** `apps/dsh-univer-work/package.json` 的 name/version/private/type 精确为
  `dsh-univer-work` / `0.0.0` / `true` / ESM；Host entry、exports 与
  `dsh.bundle.patch` 均只指向 packed artifact 内文件。
- **AC-02** package 精确选择 `@deepseek-ai/dsh@0.1.1-rc.2` 与 Cordis `4.0.1`；
  lockfile 无 version range 或相邻 checkout dependency，仓库 SDK cohort 仍为
  `1.0.0-beta.2`。
- **AC-03** manifest 与 tarball 不声明或携带 `dsh.client`、Web/Slot/Settings、
  authorization、Credentials、tool、Skill、Job、Workspace connection、Client Core、
  worker、CLI subprocess 或后续 runtime placeholder。
- **AC-04** package 不含 `prepare`、`preinstall`、`install`、`postinstall` 等安装时构建；
  `private: true` 与 `0.0.0` 不被文档描述为发布或兼容性合同。

### Bundle composition 与 Cordis lifecycle

- **AC-05** `cordis.patch.yml` 只插入一个启用的 Loader row，row name 为
  `dsh-univer-work`，resolver 指向 package root Host entry；manifest、row 和 plugin
  export name 一致。
- **AC-06** built Host entry 通过真实 Cordis composition load；plugin fiber dispose
  无异常并在返回前完成其 owned effect 清理，dispose 后不保留 effect。
- **AC-07** inert row 在没有 origin、credential、authorization、filesystem、subprocess、
  tools、skills、jobs、Web 或 Client service 时仍可激活；不得以 synthetic service、
  log line 或 placeholder contribution 伪造健康状态。

### Prebuilt artifact closure

- **AC-08** fresh build 后的 pack 文件清单包含 package manifest、Host output、
  `cordis.patch.yml`、package README 与 Apache-2.0 license；每个 manifest/patch target
  在 tarball 中真实存在。
- **AC-09** tarball 不含 TypeScript source、test、source map、临时文件、未声明目录、
  绝对路径或 `/Users/shenweimin/github.com/deepseek-ai/deepseek-harness` 等相邻 checkout
  字符串；installed package 不从 monorepo source/dist 内部路径解析依赖。
- **AC-10** `package:verify` 从实际 pack metadata/file list 检查 AC-01..AC-09，失败时
  给出具体文件或 target；不能只检查 source manifest。

### 真实 DSH 安装、发现与有界终止

- **AC-11** `package:smoke` 将已构建 tarball 安装到唯一临时 `DSH_HOME` local profile，
  安装过程不构建 package，且 profile 的 ordered bundle membership 精确包含
  `dsh-univer-work`。
- **AC-12** 同一隔离 profile 的 `--dump-config` 同时暴露 `dsh-univer-work` package layer
  和唯一启用 Loader row，resolver 指向临时 profile 内安装包，不指向源码 checkout。
- **AC-13** fresh DSH Host process 从该 profile 启动后出现 Harness 自身的明确 ready
  evidence；stderr/stdout 无 unresolved injection、module、Loader 或 plugin apply error。
  仅观察进程仍存活不算 ready。
- **AC-14** smoke 向 ready Host 发送正常终止信号，进程在固定 deadline 内以预期状态
  退出；超时必须升级终止并在错误中包含命令、阶段、stdout 与 stderr。
- **AC-15** smoke 的成功和故障路径只删除其 exact temporary root。测试结束后该
  `DSH_HOME` 与 pack staging path 不存在，用户现有 DSH home 未改变。
- **AC-16** smoke 仅使用 Node standard library 与安装的公开 DSH CLI/package exports；
  不依赖 Harness checkout 的源码路径或 `@deepseek-ai/dsh-loader-smoke`。

### 文档、scope 与完整 gates

- **AC-17** `apps/workspace/CONTEXT.md` 定义 Workspace Agent Client、Workspace Client
  Core 与 Client Shell，并把 Workspace CLI 和 `dsh-univer-work` 记为独立 Shell；ADR
  记录已接受的共仓与 private package-exports 边界。
- **AC-18** root README、AGENTS、DREAMNUM 与 package README 的布局、owner、local
  Host-only、private/no-release 边界一致，且不把认证、tools、Skills、Web 或 CLI parity
  写成已实现事实。
- **AC-19** Change diff 不修改 Workspace HTTP contract、Server/Browser 行为、数据库、
  Client Core、Workspace CLI package/release workflow 或 SDK baseline；若出现这些改动，
  判 scope failure，不能用全量 gate 通过掩盖。
- **AC-20** focused commands与仓库 `pnpm typecheck`、`pnpm test`、`pnpm build`、
  `git diff --check` 全部 exit 0；OpenSpec strict validation 通过。

验收项总数：**20**。

## OpenSpec scenario → 直接证据

| Scenario | 必须取得的直接证据 |
| --- | --- |
| Package metadata is inspected | source manifest + packed `package/package.json` 的字段与 targets |
| Host-only scope is inspected | pack file list、manifest/scripts/dependency 与禁用 surface 静态检查 |
| Packed file list is verified | fresh pack metadata、tar entry 与 target existence |
| Tarball is installed outside the source application | 临时 profile 中的 installed package、profile manifest、无 install-time build |
| Effective configuration is dumped | 真实 DSH `--dump-config` 的 package layer 与唯一 Loader row |
| Profile does not configure Workspace capabilities | patch/source/injection 检查及无业务配置的启动成功 |
| Plugin is loaded and disposed | built entry 的真实 Cordis lifecycle test 与 effect-after-dispose assertion |
| Installed profile starts and stops | fresh DSH Host ready evidence、正常 signal、有界 exit、完整诊断 |
| Dependency and documentation baseline is checked | manifest/lockfile/DSH checkout commit/version/SDK cohort/文档联合检查 |

## 执行命令

实现完成后按以下顺序执行；所有命令均从仓库根运行：

```bash
pnpm --filter dsh-univer-work typecheck
pnpm --filter dsh-univer-work test
pnpm --filter dsh-univer-work build
pnpm --filter dsh-univer-work package:verify
pnpm --filter dsh-univer-work package:smoke
openspec validate add-dsh-univer-work-plugin-shell --strict
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

静态 scope/closure 检查：

```bash
git diff --name-only d2e51a25ef05bd662cb4a88ba6ff68236577269a -- \
  apps/workspace/contracts/http apps/workspace/server packages/client-core apps/cli \
  .github/workflows
rg -n '/Users/|deepseek-harness|apps/cli/(src|dist)|client-core/(src|dist)' \
  apps/dsh-univer-work --glob '!test/**'
rg -n 'dsh\.client|tools|skills|authorization|credentials|jobs|worker|subprocess' \
  apps/dsh-univer-work/package.json apps/dsh-univer-work/cordis.patch.yml \
  apps/dsh-univer-work/src
```

`rg` 命中后按上下文判断；README 对 non-goal 的文字命中不构成 finding。产品代码、manifest、
patch 或 packed runtime 的命中必须解释。

## AC 逐项结果

| AC | 实际观察与证据 | 结论 |
| --- | --- | --- |
| AC-01 | source 与 packed manifest 均为 `dsh-univer-work@0.0.0`、`private: true`、ESM；main/exports/patch targets 全部位于五文件 artifact | PASS |
| AC-02 | manifest 精确声明 DSH `0.1.1-rc.2`、Cordis `4.0.1`；SDK dependency test 通过；Harness checkout 为指定 commit/version | PASS |
| AC-03 | `package:verify` 证明 artifact 仅含 LICENSE、README、patch、built Host 与 manifest；forbidden surface 静态检查无产品代码命中 | PASS |
| AC-04 | source/packed manifest 均无 install lifecycle script；文档明确 private tarball verification 不构成 release/compatibility contract | PASS |
| AC-05 | focused test 与 dump 均只观察到一个启用的 `dsh-univer-work` Loader row；package/row/plugin name 一致 | PASS |
| AC-06 | 真实 Cordis `Context` 加载 built entry；fiber disposal 等待异步 cleanup witness 后才 settle，dispose 后 witness inactive | PASS |
| AC-07 | Host entry 仅导出 inert `name`/`apply`，无 inject/config/service；无业务配置的真实 DSH web profile 成功 ready | PASS |
| AC-08 | 实际 tarball 列表精确为五文件；`package/LICENSE` 与仓库根 LICENSE SHA-256 同为 `cfc7749...23d30`；全部 targets 存在 | PASS |
| AC-09 | artifact 无 source/test/map/临时目录；runtime、manifest、patch 无绝对 checkout 或 app/core internal path | PASS |
| AC-10 | `package:verify` 从 `pnpm pack --json --dry-run` 的实际 file metadata 执行精确 closure/target/manifest 检查并 exit 0 | PASS |
| AC-11 | `package:smoke` 从 fresh tarball 安装隔离 web profile；ordered bundles 为 base、web-app、`dsh-univer-work` | PASS |
| AC-12 | 真实 `--dump-config` 包含 package layer 与唯一 enabled row；随后 installed module 实际 load，未经过 source overlay/link | PASS |
| AC-13 | 随机端口 `49371` 的 fresh DSH Host 输出 `dsh web: http://127.0.0.1:49371`，HTTP GET 成功，无 Loader/module/injection error | PASS |
| AC-14 | ready 后发送 `SIGTERM`，Host 在 10 秒 deadline 内以 `{ code: 0, signal: null }` 退出；timeout 路径实现 process-tree kill-and-reap 与 diagnostics | PASS |
| AC-15 | success 后系统 temp 中无 `dsh-univer-work-smoke-*`；另以 missing pnpm entry 注入失败，前后 temp count 均为 0 | PASS |
| AC-16 | smoke source 只导入 Node builtin；无 Harness checkout/test-support import。installed DSH bin 与指定 checkout bin SHA-256 同为 `c0226687...66c62` | PASS |
| AC-17 | CONTEXT 新增三个术语；ADR 0007 记录两个 Client Shell 只经 private Client Core exports 复用 | PASS |
| AC-18 | README、AGENTS、DREAMNUM、package README 一致描述当前 inert/local/Host-only/private scope，并显式列出 deferred 能力 | PASS |
| AC-19 | baseline scope diff 对 HTTP contract、Server、Client Core、CLI 与 workflows 无文件；只增加 app、workspace graph/lock、owner docs/ADR 与 task/report | PASS |
| AC-20 | focused 2 tests、strict OpenSpec、repository typecheck/test/build 与 diff check 全部 exit 0；测试计数见下表 | PASS |

## Issues

| ID | Severity | Evidence | Expected | Repro | Status |
| --- | --- | --- | --- | --- | --- |
| — | — | QA 未发现 open issue | — | — | — |

独立 review 曾记录 timeout child 未 reap；implement subagent 已在正式 QA 前改为 process-tree
`SIGTERM` → deadline → `SIGKILL` 并等待 `close`。本轮 package smoke 与故障清理探针均基于修复后源码。

## 实际执行结果

| 命令/探针 | 结果 |
| --- | --- |
| `pnpm --filter dsh-univer-work typecheck` | exit 0 |
| `pnpm --filter dsh-univer-work test` | exit 0；1 file、2 tests pass |
| `pnpm --filter dsh-univer-work build` | exit 0 |
| `pnpm --filter dsh-univer-work package:verify` | exit 0；五文件 closure |
| `pnpm --filter dsh-univer-work package:smoke` | exit 0；随机端口 49371，真实 ready/HTTP/SIGTERM/code 0 |
| `openspec validate add-dsh-univer-work-plugin-shell --strict` | valid |
| `pnpm typecheck` | exit 0；五个递归项目完成 |
| `pnpm test` | exit 0；repository scripts 12、shell 2、Client Core 453、reference-provider 16、Workspace 152、CLI 69 tests pass |
| `pnpm build` | exit 0；五个递归项目完成 |
| `git diff --check` | exit 0 |
| actual tar extract/license SHA-256 | 五个 entries；packed LICENSE 与 root LICENSE byte-identical |
| missing `npm_execpath` failure probe | expected failure；smoke temp count `before=0 after=0` |
| Harness checkout/binary probe | commit/version exact；checkout 与 installed `lib/bin.js` byte-identical |

## QA 结论

**PASS。** AC-01..AC-20 全部通过；open QA issue 为 **0**。真实 tarball 安装、profile
发现、Cordis lifecycle、DSH ready/HTTP、正常有界终止、成功/故障临时目录清理与完整仓库
gates 均已在 2026-08-29 08:04 CST 前独立执行。该结论只覆盖 inert Host-only shell；
Workspace Server `:3020`、认证、tools、Skills 与 Agent turn 属于后续 Changes，未用本轮结果代替。
