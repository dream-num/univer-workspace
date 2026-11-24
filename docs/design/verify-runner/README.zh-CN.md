# verify-runner：在容器里由独立 agent 执行 verify-uvw journey

> 状态：原型结论与方案草案，尚未实施。日期 2026-11-23。
> 本文记录设计依据、实测数据和已拍板的决定。执行顺序、文件清单和验收标准见[实施计划](plan.zh-CN.md)。两者不一致时，以实施计划为准。要推翻第 3 节的任何一条，先改第 3 节，再改正文。
> 标注“实测”的数字来自 2026-11-23 的一次性原型。原型运行在 Apple Silicon Mac 的 OrbStack 上，容器是 linux/arm64。原型代码没有提交，位置见附录 A。
> verify-uvw 今天没有的命令、环境变量和文件名，本文提到时都是提议，不是现状。

## 1. 结论

1. **可行，值得投入。** deepseek-flash 在 effort high 下能按 recipe 跑完 journey（实测 9 次）。它报出的每一个 FAIL 都对应真实的偏差。原型中埋入的缺陷，它在 high 和 max 下都抓到了。
2. **便宜。** 按 DeepSeek 的列表价，每条 journey 花 0.012 到 0.073 美元（off-peak）。default mode 的 6 次运行合计 0.13 美元，同样的 token 按 Sonnet 5.5 计价约 2.46 美元。
3. **Linux 容器没有图形界面，不会阻塞 verify。** Debian chromium 以 headless 方式运行，截图和 webm 录屏都正常。
4. **环境要复用。** 一个 runner 构建一次环境需要 33 到 56 秒。容器加上 `--init` 后，在 runner 内切换一个 task 约 5 秒。
5. **MCP mode 不需要 Docker-in-Docker。** gateway、executor 和 renderer 可以直接用 node 在 runner 里启动。这种方式验证 MCP 的功能行为，不验证部署形态。部署形态仍由宿主上的现有方式验证。原型的 `doctor` 没有跑两个 doctor 脚本里的功能检查，`dist` 下完整的 doctor 还要在 PR 2 中实测（6.2 节）。今天的方式命名为 `image`，新增的方式命名为 `dist`（6.3 节）。
6. **runner 镜像装上 opencode 后，M11、MR12 和 MO1 的 recipe 片段都能原样跑通。** 这三条是脚本直接执行的，经由 agent 执行的路径留到 PR 2 验收（7.4 节）。 镜像使用 opencode 内置的 `deepseek` provider，它读取 `DEEPSEEK_API_KEY`，模型为 `deepseek/deepseek-flash#high`。recipe 不用改，只需要让模型字符串可以被覆盖。
7. **runner 容器必须用 `--init` 启动。** 否则退出的子进程会变成僵尸进程。结果是 `opencode service stop` 失败，`$V down` 也要多等约 20 秒。
8. **实例由 agent 按 recipe 自己启动。** recipe 自己决定 `up` 的参数，有的还会中途重启实例，所以 runner 不替 agent 启动实例。实测 agent 启动的服务能跨 Bash 调用存活，`claude -p` 退出后也仍在，runner 可以在之后先查密钥、再停实例（4.7 节）。

## 2. 背景

### 2.1 痛点

- 不同开发者的环境不同，同一条 journey 的结果也不同。原型里有一个现成的例子。Sheet Lens 的 `seed-sales.py` 需要 openpyxl 3.1，宿主 Mac 上没有装 openpyxl，Debian bookworm 自带的 3.0.9 又太旧。
- 在当前的 Claude Code 或 Codex 会话里直接跑 verify，会占用会话的上下文窗口，也会消耗当前账号的额度。

### 2.2 目标

- 把 journey 交给一个独立的 agent，在统一的 Linux 容器里执行。
- 主会话只负责选择验证什么、判断结果。这与 `.agents/skills/verify-uvw/SKILL.md` 中 “Hand the driving to another agent” 一节的分工一致。
- 容器之间相互隔离，所以可以同时跑几个 agent。以后可以把 runner 放到云端，本期不做。

### 2.3 不做什么

- 不改变现有的验证方式。runner 不可用，或者 journey 不适合 runner 时，由宿主上的现有流程兜底。
- 不使用 Docker-in-Docker。
- 不改 recipe 的交接方式。runner 里的 agent 拿到的仍是 `$V brief` 输出的原文。

## 3. 已确认的决定

| # | 事项 | 决定 | 来源 |
| --- | --- | --- | --- |
| V1 | runner 里的 agent | 镜像内置 Claude Code，默认连接 DeepSeek 的 Anthropic 兼容端点，模型 deepseek-flash。用户只需提供 `DEEPSEEK_API_KEY`。找不到 key 时停下来询问用户 | 用户，2026-11-23 |
| V2 | 默认 effort | high | 用户，2026-11-23 |
| V3 | 并发上限 | 3 个 runner | 用户，2026-11-23 |
| V4 | key 的额外保护 | 不做特殊处理，由用户自己决定 | 用户，2026-11-23 |
| V5 | 环境复用 | 一个 runner 只构建一次环境，串行执行多个 task。每个 task 使用新的 session，避免上下文膨胀 | 用户，2026-11-23 |
| V6 | 容器名 | 本期不随 task 改名。提议按 batch 和序号命名，格式为 `uvw-verify-<batch>-r<k>` | 用户，2026-11-23 |
| V7 | Docker-in-Docker | 不采用 | 用户，2026-11-23 |
| V8 | MCP 的两种启动方式 | 接受。第一期 `dist` 只在 runner 容器内使用，宿主不开放。运行 verify 时，优先用 runner 容器内的 `dist` | 用户，2026-11-23 |
| V9 | MR11 的不一致 | 单独开 Issue，已开为 #553 | 用户，2026-11-23 |
| V10 | 现有验证方式 | 不受影响，宿主流程保持为兜底 | 用户，2026-11-23 |
| V12 | 两种启动方式的命名 | `image` 和 `dist`，环境变量为 `VERIFY_UVW_MCP_FROM=image\|dist`，默认 `image` | 用户，2026-11-23 |
| V13 | mcp-oauth 的 MO3 和 MO4 | 保留。它们不需要安装 VS Code 或 Cursor | 用户，2026-11-23 |
| V11 | runner 里的 MCP client | 把 opencode 装进镜像，连同配置和 deepseek-flash#high。不用 Claude Code 当 MCP client，这样 recipe 不必处理 transcript 和协议版本的差异 | 用户，2026-11-23 |

V1 是对仓库约定的一个例外。checked-in 的 skill 和 `AGENTS.md` 不指定 harness 和模型，verify-uvw 的宿主 subagent 流程仍然保持中立。只有 runner 镜像内置 Claude Code 和 DeepSeek，这样其他开发者开箱即用。V11 中的 opencode 是被测场景的一部分，不是验证者，所以不受这条约定限制。

## 4. 原型实测

### 4.1 镜像

原型镜像 `verify-runner-proto:base` 大小为 3.74 GB，冷构建的各步骤合计约 95 秒。它包含以下内容：

- 基础镜像 `node:24-bookworm`。
- Debian 软件包：`chromium`（156）、`fonts-noto-cjk`、`ffmpeg`、`python3-openpyxl`、`lsof`、`jq` 和 `openssl`。
- npm 全局包：`pnpm@11.24.0`、`agent-browser@0.42.0` 和 `@anthropic-ai/claude-code@2.1.331`。
- 环境变量：`AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium`、`DISABLE_AUTOUPDATER=1` 和 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`。
- 以 `node` 用户运行。

正式镜像还要加上原型中临时补装的内容：

- opencode 2.0.29。npm 上的 `opencode-ai` 最新只到 1.19.6，宿主装的是 anomalyco tap 的 `opencode-v2`。Linux 版本从 `https://opencode.ai/files/bin/2.0.29/opencode-linux-arm64.tar.gz` 下载，amd64 对应 `opencode-linux-x64-baseline.tar.gz`。
- `poppler-utils`、`imagemagick` 和 `fonts-liberation`。
- 一个 `magick` shim。bookworm 带的是 ImageMagick 6，没有 IM7 的 `magick` 入口，而 recipe 用的是 `magick identify` 和 `magick <in> ... <out>` 两种写法。shim 共 4 行。第一个参数是 `identify` 这类工具名时，执行该工具，否则执行 `convert`。
- `openpyxl==3.1.5`，通过 `pip3 install --break-system-packages` 安装。
- 环境变量 `VERIFY_UVW_OPENCODE_MODEL=deepseek/deepseek-flash#high`（7.3 节）。

原型中遇到的问题如下：

- Chrome for Testing 没有 linux-arm64 构建。所以改用 Debian 的 chromium，并通过 `AGENT_BROWSER_EXECUTABLE_PATH` 交给 agent-browser。agent-browser 会自动加 `--no-sandbox`。
- Debian 的 openpyxl 3.0.9 在 `seed-sales.py` 给 `wb.defined_names` 赋值时抛出 `AttributeError`。
- pnpm store 卷挂在 `~/.local/share/pnpm` 时，Docker 以 root 身份创建 `~/.local`。之后 uvw 写 `~/.local/state/univer-exchange-license` 会报 `Permission denied`，需要先 chown。
- 容器的 PID 1 是 `sleep infinity`，它不会回收僵尸进程。实测中 opencode、agent-browser 和 esbuild 退出后都留下了 `<defunct>` 进程，`kill -0` 仍然认为它们活着。用 `docker run --init` 后，僵尸进程数为 0。

### 4.2 代码怎么进入容器

- 宿主仓库的 git common dir 以只读方式挂载到 `/hostgit`。
- 宿主用一个临时 index 把工作区写成一个快照 commit：`read-tree HEAD`、`add -A`、`write-tree`，再 `commit-tree -p HEAD`。快照包含未提交和未跟踪的文件，不包含被忽略的文件（例如 `.env`），也不创建 ref。容器内执行 `git fetch --depth 1 file:///hostgit <sha>`。实测：git 2.39 能按 SHA 取到这个未被引用的 commit，`.env` 不在其中，宿主的 index 和 `git status` 没有变化。
- 早先的草案用 `git diff --binary HEAD` 加未跟踪文件的 tar 包叠加在 `--branch <branch>` 的 clone 上。review 发现它有两个问题：detached HEAD 时 `--branch` 不可用，而且 `run.env` 的 `GIT_HEAD` 和 doctor 的 HEAD 检查记录的是基础 commit，不是被测代码。快照 commit 同时解决了这两点。
- 容器里的 clone 与宿主的工作区相互独立，agent 改不到宿主的文件。

### 4.3 deepseek-flash 能否胜任

每次运行都把 `$V brief` 的原文交给 `claude -p`，所有模型槽位都设为 deepseek-flash。

| 运行 | feature 与 journey | effort | turns | 耗时 | 结果 | 核对 |
| --- | --- | --- | --- | --- | --- | --- |
| A | link-sharing LS1–LS4 | high | 31 | 181 s | PASS | 正确 |
| B | link-sharing，埋入缺陷 | high | 36 | 185 s | LS3 FAIL | 抓到缺陷 |
| B2 | 同 B | max | 32 | 385 s | LS3 FAIL | 抓到缺陷，耗时是 B 的两倍 |
| C | pull-requests | high | 66 | 327 s | ISSUES | 报告了 MCP 步骤不可达，以及 “Editor merges” 的 recipe 有误，两项均属实 |
| D | html-view | high | 57 | 489 s | HV2 FAIL | recipe 有误，属实 |
| E | auth | high | 37 | 449 s | PASS | 正确 |
| MX | mcp-executor MX1–MX4、MT1 | high | 21 | 151 s | MX3、MX4 FAIL | MX3 因为用了 `dist`，MX4 因为 recipe 有误 |
| MR | mcp-renderer MR9–MR11、MV2 | high | 72 | 325 s | MR11 FAIL | 产品不一致，见 #553 |
| MF | mcp-blobs-office MF1、MX7、MX9、MX10、MM1、MM2 | high | 33 | 162 s | PASS | 正确 |

缺陷是这样埋入的：在容器里的 clone 中，删掉 `apps/workspace/server/src/db/sqlite/access/access.repository.ts` 里 link sharing 的 `enabled = 1` 条件，然后提交。

B2 用 max，检出结果与 B 用 high 相同，耗时却翻了一倍，所以默认取 high（V2）。

工具缺失时，agent 会自己变通。例如在 MR 那次运行中，镜像里没有 poppler，agent 改用了一个独立的 PDF 解析器，并在报告里说明了这一点。所以主会话仍要按 SKILL.md 第 3 步打开证据核对，不能直接转述 PASS。

default mode 各次运行的峰值上下文在 41k 到 76k tokens 之间，所以一个 task 用一个 session 足够，不会触发压缩。

### 4.4 成本

计价方法是：取每个请求的 usage，乘以 DeepSeek 的列表价。下面两种方法都不可靠：

- 看 DeepSeek 账户余额的变化。这个账户还有其他使用方，即使这边空闲，余额也会每分钟减少约 0.3 元。
- 看 Claude Code 自己的 `total_cost_usd`。它对未知模型按 Opus 的价格计算。

deepseek-flash 的 off-peak 价格（每百万 tokens）：cache miss 0.15 美元，cache hit 0.003 美元，output 0.6 美元。工作日 UTC 01:00–04:00 和 06:00–10:00 为高峰时段，价格翻倍。

DeepSeek 会把 `claude-opus*` 这类模型名映射到更贵的 deepseek-v4-pro。所以 `ANTHROPIC_MODEL`、三个 `ANTHROPIC_DEFAULT_*_MODEL` 和 `CLAUDE_CODE_SUBAGENT_MODEL` 都要设为 flash。

| 范围 | 花费（off-peak） |
| --- | --- |
| default mode 的 6 次运行 | 每次 0.012–0.073 美元，合计 0.13 美元。按 Sonnet 5.5 的价格（2 / 0.10 / 10 美元）计算约 2.46 美元 |
| MCP 的 3 次运行 | MX 0.017 美元，MR 0.047 美元，MF 0.026 美元 |
| opencode 作为 MCP client | M11 一次 0.0014 美元，MR12 的 Sheet 部分一次 0.0006 美元。这两个数是 opencode 按自己的价格表报出的，没有独立核算 |

### 4.5 环境构建与复用

下表是 `setup-container.sh` 记录的耗时，单位为秒，pnpm store 卷已预热。

| 情形 | install | build | up、user、doctor | 合计 |
| --- | --- | --- | --- | --- |
| 单个 runner（7 次） | 19–34 | 8–12 | 6–10 | 33–56 |
| 两个 runner 同时构建（2 组） | 60–111 | 10–35 | 8–17 | 80–133 |

两个 runner 同时构建时，多出来的时间主要花在 install 上。两个 install 共用同一个 store 卷。

在 runner 内切换一个 task 的耗时如下：

| 容器 | `down` | `up`、`user`、`doctor` | 合计 |
| --- | --- | --- | --- |
| 不加 `--init` | 20.5 s | 3.7 s | 约 24 s |
| 加 `--init` | 1.3–1.8 s | 3.6 s | 约 5 s |

`down` 会等待它记录下的进程退出，而僵尸进程看起来仍然活着。所以不加 `--init` 时多出的约 19 秒，推断就是在等这些僵尸进程。

- **内存。** default mode 下每个容器占用 2.3–2.8 GiB。`dist` 下，跑完 journey 后各采样一次，为 0.5–2.5 GiB。
- **否决的方案。** 一是 `docker commit` 准备好的 runner，需要 111 秒，镜像还会增大 5 GB。二是按 lockfile 缓存依赖，它最多省下 install 的几十秒，暂不做。

每个 task 都要用一个新的实例。原型里出现过这样的情况：auth journey 让 uvw 登出了，下一个 task 的 seed 脚本随即报 `workspace-authentication-required`，直到重新执行 `$V user` 才恢复。

### 4.6 key 是否泄漏

key 只通过 `docker exec -e` 传入。所有 transcript 和证据都扫描过，没有发现 key，`$V secret-check` 也全部通过。

### 4.7 agent 自己启动实例（实测）

review 之后，设计改为由 agent 自己执行 `up`（5.4 节）。这依赖一个前提：agent 在一次 Bash 调用中启动的服务，要能在之后的 Bash 调用中、以及 `claude -p` 退出后继续存活。MO3 的 recipe 提醒过 “Keep the launching shell alive”，说明有的 harness 会在调用结束时杀掉子进程。

实测方法：在 runner 容器里，给 deepseek-flash 一份模拟 `brief --own` 的文本。它要求 agent 在三次独立的 Bash 调用中分别执行 `up`、`user` 和 `doctor`，再跑 link-sharing 的 LS1，回复时不执行 `down`。`claude -p` 退出后，由宿主一侧依次执行 `doctor`、`secret-check` 和 `down`。

| 项 | 结果 |
| --- | --- |
| 服务跨 Bash 调用存活 | 是。`up`、`user` 和 `doctor` 分三次调用，LS1 PASS |
| `claude -p` 退出后服务仍在 | 是。退出后 `doctor` 9 项 ok，0 项 FAIL |
| agent 的 Bash 能看到 `DEEPSEEK_API_KEY` | 是。opencode 在 agent 内部可以读到 key |
| 先 `secret-check` 后 `down` | 证据和 transcript 目录都是 ok，输出中没有 key，没有僵尸进程 |
| 成本与耗时 | 18 turns，80 秒。usage 为未命中 30k、命中 389k、输出 4.7k token，按非高峰价约 $0.009 |

`$V up` 用 `nohup ... &` 启动服务，容器的 PID 1 是 `--init` 的 tini，所以这个结果符合预期。

## 5. runner 的形态（提议）

执行细节见[实施计划](plan.zh-CN.md)第 1 至 4 节。本节只说明设计。

### 5.1 命令

```bash
$V runner [--jobs N] [--keep] <feature[:ID,ID]>...
```

`N` 默认取 task 数和 3 中较小的一个（V3）。一次调用就是一个 batch。

### 5.2 一个 batch 一份快照

一个 batch 只取一份代码快照：HEAD 的 SHA，加上 4.2 节的叠加内容。容器内用 `git fetch --depth 1 file:///hostgit <sha>` 取代码，HEAD 处于 detached 状态时也能用（已实测）。batch 内的所有 runner 都用这一份快照。runner 用 `docker run --init` 启动，容器名格式为 `uvw-verify-<batch>-r<k>`（V6）。

### 5.3 宿主上只有一个编排进程

宿主上由一个 `bin/runner.mjs` 进程持有全部状态，task 队列放在内存里。每个 runner 先构建一次环境（取代码、install、build），然后循环执行以下步骤：

1. 领取一个 task。
2. 清空容器内的 `/tmp/verify-uvw`。
3. 新开一个 `claude -p` session，输入 `$V brief --own` 的输出，参数为 `--max-turns 150`，超时 30 分钟。
4. 对残留的 run 执行 secret-check 和 `down`，再把证据、transcript 和报告复制到宿主的 `<batch>/<task>/`。

### 5.4 实例由 agent 启动

早先的草案是让 runner 按 task 的参数启动实例，再告诉 agent 不要执行 `up`。review 时发现这条路走不通，有两个原因：

- `$V up` 的参数只写在 recipe 的正文里。runner 要知道这些参数，就得在仓库里另建一份重复的启动参数。
- 有几条 journey 会在中途自己启动或重启实例：MO3 的 `up --reuse`、mcp-auth 的第二个实例、mcp-production、MX 中 Typst job 用的 `MCP_SYNC_BUDGET_MS=1`，以及 agent-skills。

容器是一次性的，所以改为让 agent 自己管理实例。runner 用的 brief 变体 `$V brief --own <run-id> <feature> [ids]` 告诉 agent：按 feature 文件的前置条件自己执行 `up`、`user` 和 `doctor`，回复之前对自己启动的每个 run 执行 `down`。宿主上的 brief 不变，仍然要求 agent 不要执行 `up`。

### 5.5 key

- runner 先查环境变量 `DEEPSEEK_API_KEY`，再查仓库根目录的 `.env`。两处都没有时，在启动任何容器之前以退出码 5 退出，由主会话询问用户。
- key 只在每个 task 启动时通过 `docker exec -e` 传入，不写进镜像，也不写进容器的文件系统。Claude Code 和 opencode 都从环境变量读取它。
- 每个 task 结束后，runner 在复制出来的文件中搜索 key 的原值。仓库根目录的 `.env` 必须被 `.gitignore` 忽略。

### 5.6 退出码

| 退出码 | 含义 | 主会话的处理 |
| --- | --- | --- |
| 0 | 每个 task 都产出了报告 | 逐个阅读报告和证据 |
| 3 | runner 不可用，或者 task 不适合在 runner 里执行 | 改在宿主上跑 |
| 4 | 基础设施故障、超时、没有报告，或者证据中发现 key | 查看 runner 日志，或者改在宿主上跑 |
| 5 | 找不到 key | 询问用户 |

### 5.7 适用范围

- default mode 的 feature 中，原型实测了 link-sharing、pull-requests、html-view 和 auth。grep 的结果显示 agent-trajectory、create-document、issues 和 page-theme-wiki-repository 也适用，但没有实测。
- `uvw` story 需要 macOS 的 `sandbox-exec`，只能在宿主上跑。
- MCP mode 的 journey 用 `dist` 在 runner 里跑，是否适用由 journey 上的标记决定（6.6 节）。

## 6. MCP 的两种启动方式

### 6.1 为什么需要 `dist`

今天的 MCP mode（`image`）由 `mcp_up` 构建 `apps/mcp/Dockerfile`，再用 `apps/mcp/docker/compose.verify.yml` 启动 gateway、executor 和 renderer，可选再启动 executor-b。要在 runner 里这样做，就需要 Docker-in-Docker，而 V7 已经否决了它。

三个角色其实是同一个程序 `node --disable-sigusr1 dist/main.js`，只是 `MCP_ROLE` 不同。镜像额外提供的依赖只有 chromium 和字体，而 runner 镜像里已经有了。所以 `dist` 直接用 node 启动 `apps/mcp/dist`。

### 6.2 原型结果

原型用一个约 100 行的一次性补丁实现 `dist`，见附录 A 的 `process-engine.sh`。实测结果：

- MCP app 构建耗时 11 秒，MCP mode 下 `up` 耗时 19 秒。
- 补丁自带的 `doctor` 17 项 ok，0 项 FAIL。dev session、PAT 交换、metrics token、staging 目录权限和日志里的密钥扫描都通过了。但这个 `doctor` 没有调用 `executor-doctor.mjs` 和 `renderer-doctor.mjs`。这两个脚本的第一步就是 `docker inspect`，后面还有 RPC bearer 拒绝、executor probe、`Executor doctor` PR 和 `Doctor` Sheet、renderer `measureText` 等功能检查。所以 `dist` 下完整的 doctor 还没有实测过，实施计划 5.5 节给出了拆分方法。
- 三个角色的常驻内存在 128 到 306 MB 之间。
- MR9 的截图中，中文和拉丁文都渲染正确。

### 6.3 命名

今天的方式叫 `image`，新增的方式叫 `dist`，环境变量为 `VERIFY_UVW_MCP_FROM=image|dist`，默认 `image`（V12）。名字说的是跑哪个产物：`image` 跑 `apps/mcp/Dockerfile` 构建的镜像，`dist` 用 node 直接跑 `apps/mcp/dist`。这个名字与在哪台机器上跑、是否在容器里都无关，也直接对应 6.6 节的规则：“改了镜像的输入，就要用 `image` 验证”。

考虑过但没有采用的名字：

- `container` 和 `process` 不直观，因为 runner 本身就是容器，`dist` 的进程也跑在容器里。
- `compose` 和 `direct` 中，`compose` 是工具名，看不出它多证明了什么。
- `isolated` 和 `colocated`，以及 `full` 和 `lite`，都看不出怎么运行。
- `prod` 和 `dev` 会与现有的 `VERIFY_UVW_MCP_PRODUCTION` 冲突。gateway 的生产模式和开发模式在两种方式下都可以使用。
- `engine` 已经被 `bin/mcp-engine.mjs` 和 `doctor` 用来指代 Docker Desktop 或 OrbStack。

### 6.4 定位

| | `image` | `dist` |
| --- | --- | --- |
| 用途 | 部署形态验证 | 功能行为验证 |
| 能证明 | 一，Dockerfile 构建的镜像能启动并提供服务，包括 `pnpm deploy --prod` 装的生产依赖、`COPY` 的布局，以及镜像内的 chromium 和字体。二，compose 拓扑成立：renderer 在 `internal: true` 网络上，没有到 Workspace 的路由，worker 的环境里没有 token，gateway 用与 origin 不同的 transport URL 访问 Workspace。三，容器生命周期正常，包括停止、重启和副本（`compose.verify.yml` 没有设置资源限制，所以资源限制不在其中制 | 工具经过真实的 gateway、executor 和 renderer 链路时的行为。认证（dev session、PAT 交换、gateway 的 OAuth client）、Workspace 和渲染也都是真实的 |
| 证明不了 | 没有额外缺口 | 镜像本身、每个容器的独立环境、网络隔离和容器生命周期 |
| 运行位置 | 宿主，需要 macOS 加 Docker Desktop 或 OrbStack（R5） | 第一期只在 runner 容器内 |

部署之前，只有 `image` 会真正运行 MCP 镜像。CI 的 verify 任务不构建 MCP 镜像。`.github/workflows/push.yml` 是手动触发（`workflow_dispatch`）的部署流程，它会构建并推送 `colla-workspace-mcp`，但不运行 journey。

### 6.5 优先级与默认值

1. 运行 verify 任务时，优先在 runner 容器内用 `dist`（V8）。这样覆盖面广，可以并行，成本也低。
2. 只有两种情况要在宿主上用 `image` 补跑。一是 journey 带有 `(host only)` 标记，二是改动涉及部署形态（6.6 节）。
3. 第一期宿主不开放 `dist`（V8）。宿主上不设置变量时，MCP mode 的行为与今天完全相同。
4. runner 不可用时，宿主上的 `image` 兜底。

### 6.6 范围

**按改动划分。** 改动涉及以下任一项时，要在宿主上用 `image` 补跑。runner 发现 batch 快照涉及这些路径时会打印提示，但不拒绝执行。

- `apps/mcp/Dockerfile` 或 `apps/mcp/docker/`。
- `apps/mcp/package.json`，或者 `pnpm-lock.yaml` 中 MCP 的生产依赖。
- `apps/mcp/scripts/`。
- mcp-security 覆盖的隔离要求（architecture 文档第 10 节）所依赖的代码。

**按 journey 划分。** 下表中的“实测”指在 runner 里用 `dist` 跑过，“grep”指只检查过 recipe 中有没有 docker 命令和外部依赖。

| feature | 在 runner 里用 `dist` | 依据 |
| --- | --- | --- |
| mcp | M11 可以原样运行，只需覆盖模型字符串（7.3 节）。M1 要求每一项 MCP 检查都是 ok，需要按启动方式区分通过条件。M10（Production refusal）用了 `docker run --network none`，M12 列出的是 docker 资源，两条都标为 host only | 实测加 grep |
| mcp-blobs-office | 跑过的 6 条全部 PASS，其余 9 条预计可用 | 6 条实测，其余 grep |
| mcp-executor | MX1、MX2 和 MT1 可用。MX4 失败的原因在 recipe，与启动方式无关。MX3 直接调用 `docker stop`。MX11、MX12 和 MX13 经由 `mcp-resilience.mjs` 依赖 `docker kill`、`docker logs` 和 `host.docker.internal`。这四条都标为 host only | 实测加 grep |
| mcp-renderer | MR9、MR10 和 MV2 可用。MR11 的问题见 #553。MR12 的 Sheet 部分可以原样运行 | 实测 |
| mcp-oauth | MO1 可以原样运行，只要 `mcp-oauth-opencode.sh` 中的两行按 provider 分支（7.3 节）。MO2 由脚本驱动。MO3 需要访问外网 HTTPS，拉取 `claude.ai` 和 `vscode.dev` 发布的 CIMD 文档。MO4 只用 curl | MO1 实测，其余 grep |
| mcp-auth 的其余 journey、mcp-html-view、mcp-issues-prs、mcp-space-files、mcp-skills-api | 预计可用 | grep |
| mcp-production | 需要 `dist` 版本的 `mcp-allow-users` 和 `mcp-gateway-restart`，由 `mcp_compose` 的分派提供 | grep |
| mcp-auth | 用到 `$V agent-up` 的那条 journey 标为 host only，`agent-up` 在 Linux 上没有测过 | grep |
| mcp-security | 只能用 `image` | 它测的就是容器边界 |

**编码方式。**

- 标记写法：feature 的 H1 或 journey 的 `###` 标题以 ` (host only)` 结尾。只有这一种标记，它是判断能否在 runner 里跑的唯一依据。
- runner 使用的 `$V brief --own` 读取这个标记，把带标记的 journey 列为跳过。指定的 journey 全部带标记时，以退出码 3 退出。宿主上的 brief 忽略这个标记。这样就不再需要原型里的 grep 判断。

**本期不缩小 host only 的范围。** 早先的草案想新增 `$V mcp-stop` 和 `$V mcp-start`，让 MX3 在两种方式下都能跑。review 发现 `mcp-resilience.mjs` 还依赖 `docker kill`、按 compose label 读日志和 `host.docker.internal` 回调，这两个命令覆盖不了。只为 MX3 一条 journey 加两个命令不值得，所以本期 MX3 和 MX11 到 MX13 都留在宿主上。

### 6.7 `dist` 的实现要点

- 角色表放在一个 JS 模块中，例如 `bin/mcp-processes.mjs`。它管理每个角色的环境变量、端口、启动、停止、状态查询、pid 文件和日志 `logs/mcp-<role>.log`。gateway 用 `MCP_PORT`，其余角色在 `up` 时各选一个空闲端口并写入 `run.env`。固定偏移（+1、+2、+3）会与文档中的并行 run 冲突，例如 SKILL.md 用 3931，mcp-auth.md 用 3933。
- 加一个一致性测试，从 `compose.verify.yml` 的文本中提取每个服务的环境变量名集合，与角色表比对。仓库根目录下解析不到 YAML 库，不为此新增依赖。
- 用 `dist` 时，`mcp_compose` 的 `logs`、`ps`、`exec` 和 `up` 由这个模块实现。这样 `renderer-call`（实测可用）、`mcp-allow-users`、`mcp-gateway-restart` 和 `renderer-restart`（未实测）都不用改。
- `mcp-call.mjs` 改为从文件读取 gateway 和 executor 的日志。
- `executor-doctor.mjs` 和 `renderer-doctor.mjs` 拆成容器形态检查和功能检查。功能检查经由角色表的 `exec` 在两种方式下都执行，容器形态的检查在 `dist` 下输出明确的 `skip` 行，不能输出 `ok`。
- staging 目录在 `dist` 下直接 `mkdir` 加 `chmod 700`，不用 `docker run` 改属主。
- 原型中踩到两个坑：
  - `MCP_EXECUTOR_ALLOWED_USER_IDS` 为空字符串时，executor 的配置校验会拒绝启动，所以为空时不要传这个变量。
  - `exec` 的工作目录必须是 `apps/mcp`，因为 `renderer-call.mjs` 会引用 `./dist/shared/frame.js`。

### 6.8 与已评审决定的关系

`docs/design/workspace-mcp/local-verification.zh-CN.md` 第 1 节规定，推翻其中任何一条之前，都要先修改那一节。本方案涉及以下几条：

- **R1**（一律用本机 opencode，模型 `console-deepseek/deepseek-flash#high`）：client 仍是 opencode，只需补充一句：runner 用内置的 `deepseek` provider，模型为 `deepseek/deepseek-flash#high`。
- **R5**（只支持 macOS Docker Desktop）：补充一种情形，runner 在 Linux 上用 `dist`。
- **D13**（`docs/design/workspace-mcp/README.zh-CN.md`：用本机 Docker 模拟远程 MCP Server）：`image` 继续承担这个角色，`dist` 只是功能验证的补充。

## 7. 真实 agent client：runner 里的 opencode

### 7.1 背景

M11 检查真实 agent 能调用 `whoami`。MR12 检查 `screenshot` 返回的图片能到达模型，并且模型描述正确。MO1 检查 opencode 只凭 MCP URL 就能完成浏览器 OAuth 登录。

这三条在宿主上都用 opencode，模型是 `console-deepseek/deepseek-flash#high`。这个 provider 来自宿主上的 OpenCode Console 账号凭据。`$V user` 会为每次运行写一个只含 `opencode.json` 的目录。MO1 会先导出 OpenCode Console 凭据，再把它导入一个隔离的 opencode。

### 7.2 runner 里怎么配置

- 把 opencode 2.0.29 装进镜像（4.1 节）。
- 不需要自定义 provider。opencode 内置的 `deepseek` provider 读到 `DEEPSEEK_API_KEY` 后会自动启用，并列出 `deepseek/deepseek-flash` 和 `deepseek/deepseek-v4-pro`。
- variant 确实生效。用 `#bogus` 时 opencode 以退出码 1 失败，用 `#high` 和 `#max` 都正常运行，step 中有 reasoning tokens。
- 运行目录仍用 `$V user` 写的 `opencode.json`，其中只有本次 run 的 MCP server 和权限设置。

### 7.3 需要改的地方

1. `bin/verify-uvw` 中的模型字符串改为可以覆盖，只改一行：`OPENCODE_MODEL=${VERIFY_UVW_OPENCODE_MODEL:-console-deepseek/deepseek-flash#high}`。镜像设置 `VERIFY_UVW_OPENCODE_MODEL=deepseek/deepseek-flash#high`。
2. `bin/mcp-oauth-opencode.sh` 中有两行改为：只在模型的 provider 是 `console-*` 时，才导出和导入 OpenCode Console 凭据。runner 里的 provider 直接从环境变量读取 key，所以把 XDG 目录隔离起来也不受影响。
3. runner 容器用 `--init` 启动（4.1 节）。

recipe 文本不用改。

### 7.4 结果（实测）

| journey | 运行方式 | 结果 |
| --- | --- | --- |
| M11 | recipe 原文，只覆盖了 `MCP_OPENCODE_MODEL` | exit 0，耗时 4 秒，两条 `jq -e` 断言都成立，事件 `client_name` 为 null |
| MR12 的 Sheet 部分 | 从 recipe 中原样截取的 35 行 | 脚本 exit 0，耗时 23 秒，没有 `MISSING`，所有断言成立。`magick identify` 读出了 1760x576 的 PNG。回答列出了全部单元格文本，四种颜色的位置与 fixture 一致 |
| MO1 | `mcp-oauth-opencode.sh`，含 7.3 节的两行改动 | 在加了 `--init` 的容器中 exit 0，耗时 17 秒。consent 页面显示了四个 scope，callback 只授予 `read write publish`。两条事件都是 `auth_kind: oauth` 且 `outcome: ok`。没有加 `--init` 时，所有断言也都通过，只有清理阶段的 `opencode service stop` 因为僵尸进程失败 |
| `secret-check` | 运行后的证据目录 | ok |

没有测的部分：MR12 的 deck 部分（它依赖 MR10 创建的 deck），以及 MO2 到 MO4。

上表三条都是由脚本直接执行 recipe 片段，没有经过 agent。由 agent 自己调用 opencode 的路径还没有跑过，只确认了 agent 的 Bash 能读到 `DEEPSEEK_API_KEY`（4.7 节）。实施计划 PR 2 的验收覆盖这条路径。

### 7.5 放弃的方案

原型也测过让容器里的 Claude Code 当 MCP client，M11 和 MR12 的 Sheet 部分都能跑通。但它的 transcript 结构与 opencode 不同。它还使用 modern 协议（2026-07-28），gateway 的事件中会带 `client_name: "claude-code"`，而 M11 断言这个字段为 null。所以采用它就要改 recipe，或者再加一层统一证据格式的 helper。V11 选择了 opencode，这些改动都不需要。

## 8. 原型发现的问题

| # | 问题 | 类型 | 证据 | 处理 |
| --- | --- | --- | --- | --- |
| 1 | MCP `lint` 拒绝 Board Unit，而 `uvw lint` 接受 | 产品不一致 | MR 那次运行 | #553 |
| 2 | 有的 recipe 用了 `$RUN` 却没有定义，`$V env` 也不导出它 | recipe 漂移 | 用到但未定义的位置：`features/mcp-executor.md` 第 98 行（MX4）、`features/mcp-html-view.md` 第 102 行、`features/mcp-blobs-office.md` 第 148 行。`bin/verify-uvw` 中 `cmd_env` 的 export 列表里没有 `RUN` | 让 `$V env` 导出 `RUN`，一行修好全部 |
| 3 | HV2 的 curl 没有带 cookie，页面也还没有分享 | recipe 漂移 | 运行 D | 修 recipe |
| 4 | pull-requests 的 “Editor merges” 依赖一个只有 MCP 步骤才会创建的文件 | recipe 漂移 | 运行 C | 修 recipe |
| 5 | MX3 直接调用 `docker stop` 和 `docker start` | 绑定了 `image` | MX 那次运行 | 6.6 节 |
| 6 | 原型镜像缺少 poppler-utils、imagemagick 和 fonts-liberation，而且 bookworm 的 ImageMagick 没有 `magick` 命令 | 镜像 | MR 那次运行、MR12 | 正式镜像补上，并加 shim |
| 7 | 宿主 Mac 没有 openpyxl，Debian 自带的版本又太旧 | 环境差异 | Sheet Lens 的 seed 脚本 | 镜像固定 3.1.5 |
| 8 | 容器没有 init，子进程退出后成为僵尸进程 | runner | MO1 清理失败，`down` 慢了约 19 秒 | `docker run --init` |
| 9 | runner 里没有 OpenCode Console 凭据 | runner | MO1 的凭据导出 | 7.3 节第 2 条 |
| 10 | `executor-doctor.mjs` 和 `renderer-doctor.mjs` 第一步就调用 docker，`dist` 下其后的功能检查全部跳过 | `dist` 的缺口 | 独立 review，读代码确认 | 实施计划 5.5 节 |
| 11 | `down` 会删掉 run 的密钥原值，之后 `secret-check` 只能按格式匹配 | runner 收尾顺序 | SKILL.md 的 Evidence 一节 | 先 secret-check，再 down，最后复制 |

## 9. 风险与限制

- `dist` 通过，不代表生产镜像可用。改动涉及部署形态时，宿主上用 `image` 的验证不能省。
- runner 会把 brief、recipe、命令输出、截图和读到的部分源码发给 DeepSeek API。
- key 存在于 agent 进程的环境变量里，agent 能读到它。`secret-check` 只能事后发现泄漏，不能阻止泄漏（V4）。
- agent 遇到工具缺失时会自行变通（4.3 节），所以主会话必须核对证据。
- runner 用的模型字符串和 provider 都与宿主不同。宿主经由 OpenCode Console，runner 直连 DeepSeek API。两边的模型同为 deepseek-flash，但请求路径不同。
- 只在 linux/arm64 上实测过，amd64 没有测。
- recipe 里另设 `VERIFY_UVW_ROOT` 启动的 run（sheet-lens、mcp-production），不在 runner 收尾时的 `secret-check` 范围内。宿主上的 key 原值扫描仍然覆盖它们。
- 快照 commit 是对象库里一个不挂 ref 的对象。git 默认两周后才清理，batch 期间不受影响。
- DeepSeek 的价格、模型名映射，以及两个兼容端点的行为（例如工具结果中的图片）都可能变化。镜像要固定 Claude Code 和 opencode 的版本，升级时重跑本文的检查。
- runner 镜像为 3.74 GB，还要再加上 pnpm store 卷。opencode 二进制的压缩包约 97 MB。

## 10. 待决事项

| # | 事项 | 推荐 |
| --- | --- | --- |
| Q1 | runner 的代码放在哪里 | `.agents/skills/verify-uvw/runner/`，因为只有 verify-uvw 使用它 |
| Q2 | 镜像怎么分发 | 第一期在本地构建，冷构建约 95 秒，另需下载 opencode。以后再考虑推送到 registry |
| Q3 | DeepSeek API 是否要记入 `DREAMNUM.md` | 在 PR 1 中按 `DREAMNUM.md` 的规则判断 |
| Q4 | verify-uvw 的 `bin/*.test.mjs` 是否接入 CI。目前没有任何 CI 任务运行它们 | 在 PR 2 中提出，由用户决定 |

## 11. 实施拆分

共分三个 stacked PR：PR 0 修复 recipe 漂移，PR 1 实现 runner，PR 2 实现 `dist` 和 MCP。各 PR 的文件清单、关键细节和验收标准见[实施计划](plan.zh-CN.md)。

## 附录 A. 原型文件

原型文件都在本机的 `/tmp/verify-runner-proto/` 下，没有提交，`/tmp` 被清理后会丢失。

| 文件 | 作用 |
| --- | --- |
| `Dockerfile` | 原型镜像 |
| `setup-container.sh` | 用 `--init` 启动容器，然后 clone、install、build，再执行 `up`、`user` 和 `doctor` |
| `setup-mcp.sh` | 在上一步的基础上打上 `dist` 的补丁，并以 MCP mode 启动 |
| `process-engine.sh` | `dist` 的一次性补丁 |
| `run-journey.sh` | 在容器内用 `claude -p` 执行 `$V brief` |
| `opencode/oc.tgz` | opencode 2.0.29 的 linux-arm64 二进制 |
| `mr12-sheet.sh` | 从 MR12 recipe 中原样截取的 Sheet 部分 |
| `claude-client.sh`、`ds-env.sh` | 已放弃的 Claude Code client 实验（7.5 节） |
| `own-test.sh`、`own-brief.txt` | 4.7 节的实测：agent 自己启动实例 |
| `out/` | 每个容器的 transcript、证据、日志和耗时。`out/own/` 是 4.7 节的结果 |
