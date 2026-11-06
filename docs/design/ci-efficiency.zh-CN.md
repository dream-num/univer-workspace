# 每个 tree 只验证一次的 CI 方案

本文是提案，描述的机制尚未实现。实现前以 `.github/workflows/ci.yml` 的现状为准。

## 要解决的问题

2026-11-06 合入 PR stack #186、#187、#188 用了 33.5 分钟，其中约 28 分钟在等两轮串行的 CI。
三个 PR 的代码在 13:44 之前就已经全部推上去，CI 也各自跑绿过一次。合入阶段又跑了两轮
PR CI 和三轮 `main` push CI，才把同样的改动送进 `main`。

目标很直接。同一份内容只验证一次，验证过的内容在任何地方都直接复用。合入一个 stack
不应再等 CI。在本地完整跑过验证的改动，PR 阶段也不应再等 CI。

## 这次 stack 合入发生了什么

以下时间均为 UTC，来自 PR timeline 和 Actions 运行记录。

| 时间 | 事件 | CI |
| --- | --- | --- |
| 12:51 | #185 合入 `main` | |
| 13:11 | #186 打开，base 为 `main` | 9.9 分钟，绿 |
| 13:23 | #187 打开，base 为 #186 的分支 | 14.9 分钟，绿 |
| 13:44 | #188 打开，base 为 #187 的分支 | 9.3 分钟，绿 |
| 14:04 | squash 合入 #186，#187 自动改 base 为 `main` | `main` push 跑 15.1 分钟 |
| 14:05 | #187 推送 `Merge main into better-ui-pr2b` | 13.9 分钟，绿 |
| 14:21 | squash 合入 #187，#188 自动改 base 为 `main` | `main` push 再跑一轮 |
| 14:21 | #188 推送 `Merge main into better-ui-pr2c` | 14.1 分钟，绿 |
| 14:38 | squash 合入 #188 | `main` push 再跑一轮 |

整个过程一共跑了 8 轮 CI。按内容去重后，真正需要验证的只有 3 份 tree。

### #187 的 merge commit 并非多余，但它本可以不出现

squash 合入 #186 之后，`git merge-tree` 显示 #187 与新的 `main` 在 4 个文件上冲突，包括
`apps/workspace/contracts/http/openapi.yaml` 和 `apps/workspace/generated/http/schema.d.ts`。
原因是 GitHub 用 #187 分支与 `main` 的旧分叉点做三方合并。#186 的三个原始提交仍在 #187 的历史里，
它们的改动和 `main` 上的 squash commit 被当成两份独立改动，相邻的 hunk 因此冲突。

用 `git rebase --onto <新 main> <#186 原 head>` 只重放 #187 自己的提交，结果 tree 是
`cc3595ba`。这正是最终落到 `main` 上的 tree，也等于在 13:23 用当时的 `main` 合并 #187 head 得到的
tree。#188 同理，rebase 结果 `1895e432` 等于 13:44 用当时的 `main` 合并 #188 head 的结果。
也就是说，这次合入阶段所需的验证结果，在推送阶段就已经可以拿到。这个相等关系在本例两层上都成立，
但不是一般保证。下层 squash 时如果手工解决过冲突，或者 `main` 在推送后前进了，rebase 结果就会不同。
所以方案在合入时总是重新计算 tree 并查询记录，而不是假定它相等。

### 被重新测试的是同一份内容

`main` 上没有 branch protection，也没有 ruleset，GitHub 并不强制 CI 通过才能合入。
等待来自流程本身。合入者看到一个没有 CI 结果的新 head，只能等它跑完。CI 只认 commit，
而每次 squash、每次 merge commit 都会产生新的 commit。

## 现状测量

数据来自 2026-09-16 到 2026-11-06 的最近 300 次 `CI` workflow 运行。统计命令见文末"测量方法"。

- 成功运行的耗时中位数是 12.6 分钟，P90 是 26.8 分钟。全部运行共消耗 2,809 runner 分钟。
- 81 次 squash 合入触发的 `main` push 运行中，68 次（84%）测试的 tree 已经在该 PR 的某次成功运行中测过，
  共 702 runner 分钟。
- 212 次 PR 运行中，41 次在运行期间被同一分支的新推送取代，结果没人需要，共 381 runner 分钟。
- 以上两项合计约 1,083 分钟，占总量的 39%。

单次运行内部，`pnpm test` 占大头。以 #187 合入阶段那次运行（14:06）为例：

| 步骤 | 耗时 |
| --- | --- |
| checkout、setup、`pnpm install` | 19 秒 |
| `api:verify` | 5 秒 |
| `pnpm typecheck` | 43 秒 |
| `pnpm test` | 9 分 39 秒 |
| `pnpm build` | 41 秒 |
| `pnpm package:workspace-cli` | 26 秒 |
| `package:smoke` | 78 秒 |
| `test:production-import` | 34 秒 |

`pnpm test` 慢的原因主要不在测试本身。`pnpm -r test` 按依赖层级分批执行，一批全部结束才开始下一批，
批内默认并发 4。`apps/workspace` 依赖 `workspace-file-browser`，后者依赖 `workspace-ui`，所以它在第三批。
第一批里最慢的是 `packages/client-core`（147 秒），第二批里是 `apps/cli`（约 140 秒）。
`apps/workspace` 不依赖这两个包，它的测试自己需要 284 秒，却在这一步开始 4 分 49 秒后才启动。
测试并不需要依赖包先跑完测试，这段等待可以去掉。下文说明为什么应该拆到多台 runner，而不是用 `--no-sort`。

`univer-workspace-cli` 的 client-core 和 CLI 构建在一次运行里执行了三次。`apps/cli` 的 `test` 脚本、
`pnpm build`、`apps/cli/scripts/build-package.mjs` 各构建一次。

本地完整跑一遍同样的步骤，在 10 核 macOS 上耗时 8 分 1 秒，所有步骤都通过，明细见文末"测量方法"。
这比 CI 的中位数还短，Agent 在推送前完整跑一次本地验证是现实的做法。

## 根因

问题可以归结为三点。

1. 验证结果绑定在 commit 上，而改变 commit 的操作很多，改变内容的操作很少。squash、merge commit、
   rebase 和改 base 都会换掉 commit，内容往往不变，结果却必须重新算。
2. 验证步骤只存在于 `ci.yml` 里。本地跑的 `verify`、`smoke` 是这份清单的子集或近似，
   CI 无法确认本地跑的就是同一组检查，所以只能自己重跑。
3. CI 只有一个串行 job，`pnpm test` 又被拓扑分批拉长。真正需要跑的时候也比必要的慢。

stack 的冲突是第一点的特例。GitHub 用旧分叉点合并上层 PR，制造了一个本不该存在的冲突，
解决冲突又产生了新 commit。

## 方案

方案的核心是换一个记录验证结果的键。验证的对象是"合入 `main` 后会出现的 git tree"，
结果以 tree hash 为键保存。任何事件只要算出的 tree 已有结果，就直接复用。

### 以 tree 为键的验证记录

一条验证记录是一个 git ref，名字里带 tree hash，指向一个 tree 恰好等于该 hash 的 commit。

```text
refs/ci/verified/<tree>   由 GitHub Actions 在 Linux runner 上写入
refs/ci/attested/<tree>   由开发者或 Agent 在本地写入
```

ref 指向的 commit 由 `git commit-tree <tree> -p <被测 commit>` 生成，commit message 记录来源。
CI 写入运行 URL，本地写入用户、`node -v`、`uname -sm` 和执行过的阶段。`git ls-remote` 只返回 SHA，
读取方要 `git fetch origin <ref>` 后检查 `<ref>^{tree}` 等于 ref 名里的 hash，再使用这条记录。

选择 git ref 的理由如下。

- 查询只需要 `git ls-remote origin refs/ci/verified/<tree>`，没有新服务，也不依赖 Actions cache 的作用域规则。
  Actions cache 在 PR 上写入后，`main` 上的运行读不到，所以不能用来保存这类记录。
- ref 名就是 tree hash，读取方可以直接校验记录和内容是否一致。
- 默认 refspec 只拉取 `refs/heads/*` 和 `refs/tags/*`，普通 `git fetch` 不会下载这些 ref。
- 能写 ref 的人本来就能推送分支和合入 PR。`main` 现在没有保护，这些人也能直接推送 `main`。

这些记录是有写权限的人之间的约定，不是安全边界。任何有推送权限的人都能直接 `git push` 一个
`refs/ci/verified/*`，`verified` 与 `attested` 的区分只靠约定维持。`attested` 尤其只是作者的自我声明，
接受它意味着 PR 阶段不再有独立于作者的检查。这是为了 Agent 开发速度而做的明确取舍，
`main` 上的 Linux 验证是它的兜底。

两种来源分开命名，是因为它们的证明力不同。本地是 macOS，CI 和部署镜像是 Linux。
`@univerjs-pro/exchange-node-binding` 这类原生绑定、大小写敏感的文件系统、时区和 locale 都可能让两边结果不同。

| 事件 | 接受的记录 | 没有记录时 |
| --- | --- | --- |
| `pull_request` | `verified` 或 `attested` | 运行完整验证 |
| `push` 到 `main` | 只接受 `verified` | 运行完整验证，不阻塞任何人 |

因此每份进入 `main` 的 tree 最多在 Linux 上验证一次。PR 已在 CI 上验证过，`main` 上直接跳过。
PR 只有本地证明，`main` 上补一次 Linux 验证，合入时没人等它。

### 一个验证入口

新增 `scripts/ci/verify.mjs`，把现在 `ci.yml` 里 `pnpm install` 之后的 7 条命令收进三个阶段。

| 阶段 | 内容 |
| --- | --- |
| `static` | `api:verify`、`pnpm typecheck` |
| `test` | 根目录 `node --test` 测试、各包的 `test` 脚本，可按包选择子集供 CI 分 job |
| `package` | `pnpm build`、`package:workspace-cli`、`package:smoke`、`test:production-import` |

`ci.yml` 和本地都只调用这个脚本，CI 的检查清单与本地完全一致。以后增删检查只改这一个文件。
根 `package.json` 增加两个入口。

```bash
pnpm ci:verify            # 在当前工作区跑全部阶段
pnpm ci:verify --attest   # 在干净的临时 worktree 里跑全部阶段，成功后写 refs/ci/attested/<tree>
```

`--attest` 不在当前工作区运行。它先算出目标 tree，基于该 tree 建临时 worktree，执行
`pnpm install --frozen-lockfile`，跑完三个阶段后推送 ref。工作区里未提交的改动不会混进证明。
目标 tree 的算法与 CI 相同，见下一节。

### CI 先查记录，再决定跑不跑

`ci.yml` 改为四类 job。

1. `gate` 计算目标 tree，查询记录，输出是否命中。耗时约 10 秒。
2. `verify` 是一个 matrix，只在未命中时运行。`test` 阶段按包拆成三个 job，加上 `static` 和 `package`，共 5 个 job 并行。
3. `record` 在 `verify` 全部成功后写 `refs/ci/verified/<tree>`。只有这个 job 声明 `contents: write`，
   其余 job 用 `contents: read` 和 `persist-credentials: false`，避免 PR 里的测试或安装脚本拿到写权限伪造记录。
   仓库当前的默认 workflow 权限是 `write`，应改为 `read`。来自 fork 的 PR 拿不到写权限，跳过写入即可。
4. `ci` 汇总前面的结果，命中或验证成功即为成功。以后在 ruleset 里设置必需检查时，只需要这一个稳定名字。

目标 tree 的算法如下。

- base 是 `main` 的 PR，目标 tree 就是 GitHub 生成的 `refs/pull/<n>/merge` 的 tree，也就是 checkout 的结果。
- base 是其他分支的 PR，也就是 stack 的上层，`gate` 把 PR head 与当前 `origin/main` 合并，测这个 tree。
  上层 PR 的历史里包含下层的原始提交，所以普通合并不会出现上文的重复冲突。
  合并失败时退回测试 GitHub 的 merge ref，并且不写记录。求 merge base 需要历史，
  这类 PR 的 checkout 要用 `fetch-depth: 0` 并额外拉取 `main`。
- `main` 上的 push，目标 tree 是 `HEAD^{tree}`。

第二条是 stack 只跑一次的关键。每一层在推送时就测"自己落到 `main` 后的样子"，而不是"落到下一层分支上的样子"。
之后下层合入、上层 rebase，只要 `main` 没有别的提交进来，上层的 tree 就和推送时测过的一样。

`concurrency` 也一起加上。

```yaml
concurrency:
  group: ci-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

PR 的新推送会取消旧运行。`main` 上连续合入时，前一次运行也会被取消，最终 tree 包含了前面所有改动。
代价是中间那些 `main` commit 失去单独的验证结果，用 `git bisect` 时要知道这一点。

### 用脚本合入 stack

新增 `scripts/ci/land-stack.mjs <顶层 PR 号>`，替代手工逐个合入。

1. 沿 base 链从顶层走到 `main`，得到自底向上的 PR 列表。检查每一层的 head 都包含下一层的最终 head
   （`git merge-base --is-ancestor`），并且每层自己的提交里没有 merge commit。不满足时停下，
   提示先整理 stack。下层在上层分出之后又加过提交，或上层合并过下层，rebase 都会重放旧提交或丢掉冲突解决。
2. 对每一层，计算它在前面各层合入后落到 `main` 上的 tree，算法与 `gate` 一致，并查询记录。
3. 自底向上逐层执行。squash 合入当前层，等 GitHub 把上一层的 base 改为 `main`，
   再对上一层执行 `git rebase --onto origin/main <当前层原 head>` 和 `git push --force-with-lease`。
   rebase 只重放上一层自己的提交，不会出现 #187 那样的冲突。新 head 触发的 PR 运行若在 `gate` 命中记录，
   十几秒后变绿。
4. 全部合入后，检查 `origin/main^{tree}` 等于顶层的目标 tree，并报告结果。

`main` 在推送后前进时，第 2 步会查不到记录。这时不需要额外触发什么。第 3 步的 rebase 推送本身就是
`synchronize` 事件，PR CI 会验证真正要落地的 tree。默认只等顶层这一次运行，中间层不等结果直接合入，
它们的 tree 由 `main` 上的运行兜底。这与 `cancel-in-progress` 的取舍相同。
需要逐层都有记录时，用 `--each-layer` 让脚本在每次推送后等待该层的运行。

脚本把 GitHub 删除分支后自动改 base 的行为当作已知前提。#187 和 #188 的 timeline 里都有
`automatic_base_change_succeeded` 事件，说明仓库现有设置 `delete_branch_on_merge: true` 已经能做到。

### 真正要跑时，跑得快一些

这些改动与记录机制无关，可以先单独落地。

- 加 `concurrency` 和 `cancel-in-progress`。按上面的测量，每 7 周大约节省 381 runner 分钟。
- 把测试拆到多台 runner 上，而不是在一台 runner 上加并发。原型 PR #189 的第一版只在一台 runner 上
  对其余包用了 `pnpm -r --no-sort test`，`apps/cli/test/workspace-cli.test.ts` 里两个启动构建产物的用例
  超过 vitest 默认的 5 秒超时。这两个用例和 `client-core` 加载大量模块的测试抢 4 个 vCPU。
  第二版把 `apps/workspace` 测试、`apps/cli` 测试和其余包测试分成三个 job，再加 `static` 与 `package`，
  共 5 个 job 并行。每个 job 多付约 20 秒的 setup。第二版跑完一次耗时 5 分 18 秒，
  当前布局的中位数是 12.6 分钟。各 job 耗时见文末"测量方法"。
- 拆分后的关键路径是 `apps/workspace` 的测试，单独一台 runner 上两次分别需要 3 分 59 秒和 4 分 51 秒。还要更快时，
  可以用 vitest 的 `--shard` 把它分到两台 runner。这一项等前面几项落地后，按实测决定是否需要。
- `apps/cli/test/workspace-cli.test.ts` 那两个用例对 CPU 余量敏感，原型已经复现了超时。
  它们应改为显式的超时时间，或者改成不依赖启动速度的断言。否则以后任何调整并发的改动都可能让它们失败。
- `apps/cli` 的 `test` 脚本去掉 `pnpm --filter 'univer-workspace-cli^...' run build && pnpm build`，
  `test:package` 移到 `package` 阶段，构建只在 `package` 阶段做一次。
  动这一条之前要先确认 CLI 的 vitest 用例哪些依赖构建产物。

## 新流程下重放这次 stack

假设方案已经落地，同样三个 PR 会这样走。

1. Agent 在本地开发完三层，推送三个分支，按顺序打开三个 PR。
2. 三个 PR 的 CI 并行运行，各自测试落到当时 `main` 上的 tree。
   #186 是 `b94f522b`，#187 是 `cc3595ba`，#188 是 `1895e432`。三份记录写入 `refs/ci/verified/`。
3. 评审完成后执行 `node scripts/ci/land-stack.mjs 188`。三次 squash 合入、两次 rebase 推送，
   不触发任何完整验证。预计 1 到 2 分钟（推测，取决于 GitHub API 和改 base 的延迟）。
4. 三次 `main` push 都命中记录，`gate` 后即结束。

CI 一共跑 3 轮完整验证，都在推送时并行完成。实际发生的是 8 轮，其中 2 轮是合入时的串行等待。
如果 Agent 在推送前对三层分别执行了 `pnpm ci:verify --attest`，PR 阶段的 3 轮也可以省掉，
代价是合入后 `main` 上补跑 3 轮 Linux 验证。中间两轮会被 `cancel-in-progress` 取消，实际只剩最后一轮。

## 不选的方案

**GitHub merge queue。** merge queue 能保证合入后的 `main` 一定是测过的组合，但它为队列里的每个 PR
各建一个临时分支，各跑一次 CI。按 GitHub 文档
[Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)，
合并数量限制不会把多个 `merge_group` 构建合成一次。
一个三层 stack 进队列仍然要跑三轮，单个 PR 还要在 PR CI 之外多跑一轮。它解决的是高并发合入的冲突，
不是重复验证。以后合入频率高到 `main` 经常被并发合入弄红时，可以在本方案之上再开 merge queue。

**把 stack 顶层改到 `main` 上一次 squash，关掉下层 PR。** 顶层的 tree 已经包含所有层，
这样 `main` 上只出现一个 commit，只跑一次，不需要任何新设施，今天就能用。代价是失去分层的 PR 和 commit。
这次 stack 拆成三层，正是为了让 schema、服务端和界面分别评审、分别出现在历史里。
在记录机制落地前，这是可用的应急做法，但不应成为常规流程。

**要求分支与 `main` 保持最新。** 这会让 `main` 一前进，所有打开的 PR 都必须更新并重跑。
它保证了正确性，但把重复验证从偶发变成常态，与目标相反。

**按改动范围只测受影响的包。** `pnpm --filter "...[origin/main]"` 可以只测改动的包及其依赖方。
这个仓库的跨包耦合多，比如 `packages/unit-comparison-viewer` 要求所有副本同步，根目录还有
`scripts/*.test.mjs`。漏测的代价高于省下的时间。tree 记录已经去掉了大部分重复，这一项暂不做。

**`main` 上完全不跑 CI。** 84% 的 `main` 运行确实是重复的，但剩下 16% 是合入期间 `main` 前进造成的新组合，
只有在 `main` 上才能测到。tree 记录精确区分了这两种情况，没有必要整体关掉。

## 风险和取舍

- 本地证明在 macOS 上执行。只依赖本地证明合入的改动，可能在 `main` 的 Linux 验证中失败，`main` 会短暂变红。
  处理方式是修复后再合入一个修复 PR。每份 tree 仍然会在 Linux 上验证一次，问题不会被跳过。
- 同仓库 PR 的 workflow 文件来自 PR 分支本身。改了 `ci.yml` 的 PR 可以伪造 `verified` 记录。
  这与现在"PR 可以把自己的 CI 改成直接成功"是同一个信任边界，评审时需要看 workflow 改动。
- 中间状态的 `main` commit 可能没有单独的验证记录，`git bisect` 时要把这些 commit 当成未验证。
- `refs/ci/*` 会持续增长。ref 很小，也不会被默认拉取，但它们指向的 commit 会让已删除分支的历史一直保留在仓库里。
  数量影响 `git ls-remote` 速度，或者需要回收这些对象时，再加一个定期清理旧 ref 的 workflow。
- 一次运行若在 `verify` 成功后、`record` 写入前被取消，这个 tree 就没有记录，下次遇到时会再跑一次。
  这只多花时间，不影响正确性。
- 手动部署 workflow `push.yml` 可以在构建镜像前检查 `refs/ci/verified/<tree>` 是否存在。
  这一步很便宜，能防止把从未在 Linux 上验证过的 commit 部署出去。

## 落地顺序

每一步都能单独合入，单独验证。

1. `ci.yml` 加 `concurrency`，并按原型第二版拆成 5 个并行 job。同时修好 `workspace-cli.test.ts` 的两个超时用例。
   只改 workflow 和测试，用一次 PR 运行验证耗时。
2. 新增 `scripts/ci/verify.mjs` 和 `pnpm ci:verify`，`ci.yml` 改为调用它。CI 结果应与第 1 步一致。
3. 加入 `gate`、`record`、`ci` 三个 job，以及 stack 上层按 `main` 合并的目标 tree 算法。
   同时把仓库默认 workflow 权限改为 `read`。
   验证方法是同一 tree 推送两次，确认第二次只跑 `gate`。随后合入一个 PR，确认 `main` push 命中记录。
4. `pnpm ci:verify --attest` 本地证明。
5. `scripts/ci/land-stack.mjs`。用一个三层的测试 stack 验证全流程，统计合入耗时和 CI 轮数。
6. 可选。在 ruleset 里把 `ci` 设为必需检查，并让 `push.yml` 检查 `verified` 记录。

第 1 步与后面无关，可以马上做。第 3 步之后，重复验证就基本消失了。

## 测量方法

运行列表与耗时：

```bash
gh run list --workflow ci.yml -L 300 \
	--json databaseId,event,headBranch,headSha,conclusion,createdAt,startedAt,updatedAt > runs.json
```

判断 `main` 上的运行是否重复的方法如下。对每个 squash commit `C`，取对应 PR 的每次成功运行，用运行创建时刻的
`origin/main`（`git rev-list -1 --before=<createdAt> origin/main`）与该次运行的 head 做
`git merge-tree --write-tree`。结果等于 `C^{tree}` 即为重复。运行创建时刻与 checkout 时刻之间
`main` 若有变化，这个近似会把少数运行判错。

同一分支上有更晚创建的运行，并且它的创建时间早于这次运行的结束时间，就判定这次 PR 运行被取代。

stack 的 tree 对比：

```bash
git merge-tree --write-tree b3772004 e2c3ee56          # #187 直接合并新 main，冲突
git rebase --onto b3772004 206d581a                    # 在 e2c3ee56 上执行，得到 cc3595ba
git merge-tree --write-tree b0c83e0 e2c3ee56           # #187 推送时合并当时的 main，得到 cc3595ba
```

本地全量耗时，10 核 macOS，Node 24.19.0，pnpm 11.24.0，基于 `origin/main` 的干净 worktree：

| 步骤 | 耗时 |
| --- | --- |
| `pnpm install --frozen-lockfile`（store 已预热） | 13 秒 |
| `api:verify` | 8 秒 |
| `pnpm typecheck` | 28 秒 |
| `pnpm test` | 330 秒 |
| `pnpm build` | 21 秒 |
| `pnpm package:workspace-cli` | 13 秒 |
| `package:smoke` | 43 秒 |
| `test:production-import` | 25 秒 |
| 合计 | 481 秒 |

原型 PR #189 的并行布局各 job 耗时（含 setup 和 `pnpm install`）：

| job | 第一版（run 42236293101） | 第二版（run 42237169818） |
| --- | --- | --- |
| `static` | 58 秒 | 73 秒 |
| `test-workspace` | 4 分 26 秒 | 5 分 17 秒 |
| `test-cli` | 第一版未拆出 | 2 分 28 秒 |
| `test-rest` | 3 分 59 秒，失败 | 3 分 9 秒 |
| `package` | 3 分 34 秒 | 3 分 1 秒 |
| 整体 wall time | 4 分 26 秒 | 5 分 18 秒 |

两次运行里 `apps/workspace` 的测试步骤分别是 3 分 59 秒和 4 分 51 秒。它独占一台 runner，
差异来自 runner 本身的波动。样本只有两次，这里的数字说明量级，不是稳定的基线。

5 个 job 合计约 15 runner 分钟，比单 job 的中位数 12.6 分钟多。仓库是公开仓库，GitHub 托管 runner 不计费，
多出的成本只是并发占用。
