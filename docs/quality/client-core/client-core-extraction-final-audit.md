# Client Core 十切面提取最终审计

日期：2026-08-28

分支：`refactor-cli-core`

起始 HEAD：`6c9b842e5544be5ea04ceb24d55f0e8ff1b3115b`

最终产品树：`f90023ca61ed593993ce5e252329492542ed9aa8`

## 结论

十个 OpenSpec Change 均已按顺序实施，64 个已列任务全部完成。每个 Change 的 QA 与 Standards/Spec review 均为 0 open finding；没有提交或归档。

Workspace CLI 的命令面、参数校验、JSON/text/stderr 呈现、Session/daemon 边界及安装包入口保持兼容。Client Core 成为 Space/Node、认证协议、Worktree/Unit、文件传输、runtime target/reference、content runtime、Office exchange、Typst、screenshot/lint 与 SVG workflow 的共享 owner。

| Change | QA | Review |
| --- | --- | --- |
| `extract-space-node-client-core` | 19/19 pass | 0 open |
| `extract-auth-client-core` | 26/26 automated pass；2 environment-unavailable | 0 open |
| `extract-worktree-unit-client-core` | 35/35 pass | 0 open；1 accepted risk |
| `extract-file-transfer-client-core` | 40/40 pass | 0 open |
| `extract-runtime-target-client-core` | 48/48 pass | 0 open |
| `extract-content-runtime-client-core` | 60/60 pass | 0 open |
| `extract-office-exchange-client-core` | 48/48 pass | 0 open |
| `extract-typst-client-core` | 56/56 + 补充 8/8 pass | 0 open |
| `extract-screenshot-lint-client-core` | 74/74 + 补充 12/12 pass | 0 open |
| `extract-svg-client-core` | AC-01–95 pass；AC-96 environment-unavailable | 0 open |

各 Change 的详细证据位于同目录的 `*-qa.md` 与 `*-review.md`。

## 最终 fresh gate

最终审计在全部报告落盘后重新运行完整 gate：

- `pnpm install --frozen-lockfile`：pass。
- Client Core typecheck、453/453 tests、build 与 render runtime build：pass。
- SDK dependency/release：12/12 tests；reference-provider：16/16 tests。
- Workspace：152/152 tests；CLI：69/69 tests；package manifest：13/13 tests。
- 根 `pnpm typecheck`、`pnpm test`、`pnpm build`：pass。
- `pnpm package:workspace-cli`、package verify、隔离安装 smoke：pass。
- 安装包：203 files，packed 13,029,788 bytes，unpacked 58,137,751 bytes。
- 安装态从任意 cwd 验证 auth、Space/Node、Worktree/Unit/open、Blob/Asset、inspect、Office/Typst native closure、screenshot/lint browser closure、SVG nested asset、daemon、worker、render page 与 8 个 Skills。
- `git diff --check`、package-root import、唯一 owner 与 secret hygiene：pass；检测到的 credential 字符串均为明确的 fixture 假值。

最终 fresh gate 只出现既有的 Redocly update 提示、route generator circular-dependency warning 与 Vite chunk-size warning；没有失败或新的产品 finding。

## 已知风险

1. Worktree lifecycle mismatch detail 继续返回完整 Worktree。这是迁移前已有的公开错误输出；本轮为保持 CLI 行为没有压缩字段。若要限制 detail 大小，应单独提出 behavior Change。
2. Content runtime 对 `@univer-cli/univer-collaboration-runtime-pool@1.0.0-beta.2` 使用精确 pnpm patch，补充同步 `destroy-start` lifecycle event。保留 patch，等待 [univer-cli-sdk#48](https://github.com/dream-num/univer-cli-sdk/issues/48) 发布上游等价能力；升级 SDK 后按 [univer-workspace#19](https://github.com/dream-num/univer-workspace/issues/19) 移除 patch 并重跑 runtime/package gate。
3. 最终 fresh gate 时本地 Server 不可达，因此当时的真实账号 smoke 记录为 `environment-unavailable`。随后已使用系统临时目录中的真实 Server、SQLite、Collaboration、Blob、CLI Session、worker、Chrome 与 native runtime 完成补充 QA；见 [`client-core-extraction-real-environment-qa.md`](./client-core-extraction-real-environment-qa.md)。
