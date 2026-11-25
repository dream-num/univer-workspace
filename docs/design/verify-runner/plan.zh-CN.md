# verify-runner 实施计划

> 状态：已在 #558 至 #587 中实施。实施推翻了本文的几项决定：由 runner 而不是 agent 启动实例；verdict 取自 journal，而不是 `RESULT:` 行；recipe 增加了 journey 标题和元数据。从 #591 起，runner 改为 opt-in，host mode 是默认方式。runner 的现状以 `.agents/skills/verify-uvw/runner/README.md` 为准。日期 2026-11-24。
> 设计依据、实测数据和决定的来由见 [README.zh-CN.md](README.zh-CN.md)。本文只写执行顺序、文件清单、关键细节和验收标准。
> 两份文档不一致时，以本文为准，并在同一个 PR 里修正 README。

## 0. 先读这一节

### 0.1 目标

verify-uvw 的 journey 交给一个独立的 agent，在统一的 Linux 容器（runner）里执行。这样验证结果不再取决于开发者的机器，主会话的上下文和账号额度也不再被验证消耗。宿主上现有的验证流程保持不变，作为兜底。

### 0.2 必读

1. 根目录 `AGENTS.md`，尤其是 Commits and pull requests 和 Verification 两节。
2. `.agents/skills/verify-uvw/SKILL.md`、`features/README.md` 和 `references/mcp-mode.md`。
3. `.agents/skills/verify-uvw/bin/verify-uvw` 中的 `cmd_up`、`cmd_env`、`cmd_brief`、`cmd_secret_check`、`mcp_up`、`mcp_doctor`、`mcp_compose` 和 `mcp_down`。
4. `.agents/skills/verify-uvw/bin/executor-doctor.mjs`、`renderer-doctor.mjs` 和 `skill-docs.test.mjs`。
5. `apps/mcp/Dockerfile`、`apps/mcp/docker/compose.verify.yml` 和 `apps/mcp/AGENTS.md`。
6. `docs/design/workspace-mcp/local-verification.zh-CN.md` 第 1 节（R1 到 R6）。
7. 本目录的 `README.zh-CN.md`。

### 0.3 已拍板，不要再讨论

| 决定 | 内容 |
| --- | --- |
| verifier | 镜像内置 Claude Code，默认连接 DeepSeek 的 Anthropic 兼容端点，所有模型槽位都设为 deepseek-flash，effort 为 high。用户只提供 `DEEPSEEK_API_KEY`，找不到时停下来问用户 |
| MCP client | runner 镜像装 opencode，模型 `deepseek/deepseek-flash#high`。不用 Claude Code 当 MCP client |
| 并发 | 最多 3 个 runner |
| 环境复用 | 一个 runner 构建一次环境，串行执行多个 task。每个 task 使用新的 session 和新的实例 |
| 容器名 | 不随 task 改名，格式为 `uvw-verify-<batch>-r<k>` |
| Docker-in-Docker | 不用 |
| MCP 启动方式 | `image`（今天的方式：构建 `apps/mcp/Dockerfile`，用 compose 启动）和 `dist`（用 node 直接启动 `apps/mcp/dist`）。环境变量为 `VERIFY_UVW_MCP_FROM=image\|dist`，默认 `image` |
| `dist` 的范围 | 第一期只在 runner 容器内使用，宿主不开放。运行 verify 时优先使用 runner 加 `dist` |
| key | 不做额外保护。只经由环境变量传入，不写进镜像和文件 |
| mcp-oauth | 保留 MO3 和 MO4 |
| 现有流程 | 宿主上不设置新变量时，verify-uvw 的所有命令行为与今天完全相同 |

### 0.4 工作约定

- 按 `AGENTS.md` 用 `gh stack` 组织成 stacked PR，开 stack 前先 rebase 到最新的 `main`。提交信息和 PR 标题使用英文，遵循 Conventional Commits。PR body 用英文。review 才需要的细节用中文写在第一条 PR comment 里。
- checked-in 的 skill 文本不能指定宿主流程用哪个 harness 或模型。runner 镜像内置 Claude Code 和 DeepSeek 是唯一的例外，这一点要在 SKILL.md 的 runner 一节写明。
- 不提交、不打印 `DEEPSEEK_API_KEY`。它在仓库根目录的 `.env` 里。
- 不推送镜像，不发布任何东西。
- 不要一次占满所有 CPU 核。
- 原型脚本在 `/tmp/verify-runner-proto/`，可以参考，但不要直接提交。它们是一次性的，硬编码了路径和分支。

### 0.5 已实测的前提

| 前提 | 结果 | 来源 |
| --- | --- | --- |
| 未提交的改动可以做成一个不挂在任何 ref 上的 commit，容器内按 SHA 取得到 | 成立。git 2.39 用 `fetch --depth 1 file:///hostgit <sha>` 取到，`.env` 不在其中，用户的 index 和 status 没有变化 | 2026-11-23 实测 |
| 镜像里预先建好 `~/.local/share/pnpm`，新的 named volume 就归 `node` 用户所有 | 成立，可写 | 2026-11-23 实测 |
| agent 在 `claude -p` 里自己执行 `$V up`，服务能在之后的 Bash 调用中、以及 `claude -p` 退出后存活。agent 的 Bash 能读到 `DEEPSEEK_API_KEY` | 成立。退出后 `doctor` 9 ok 0 FAIL，先 `secret-check` 后 `down` 均为 ok，输出中没有 key | README 4.7 节，2026-11-23 实测 |
| `--init` 消除僵尸进程，`down` 从 20.5 秒降到 1.3–1.8 秒 | 成立 | README 4.5 节 |

## 1. 整体结构

```text
宿主
  $V runner <task>...          bin/runner.mjs，一个进程持有全部状态
    1. 查找 key，找不到就 exit 5
    2. 检查 docker，不可用就 exit 3
    3. 预检每个 task 是否只能在宿主上跑
    4. 确保镜像 uvw-verify-runner:<Dockerfile 哈希> 存在，不存在就构建
    5. 做快照 commit（不挂 ref）
    6. 启动 N 个容器（docker run --init）
    7. 每个容器构建一次环境，然后从内存队列中领取 task
    8. 汇总，删除容器
  /tmp/verify-uvw/runner/<batch>/
    summary.md
    <task>/report.md  transcript.jsonl  result.json  runs/<run-id>/{evidence,logs,run.env}

runner 容器（uvw-verify-<batch>-r<k>）
  ~/repo            git fetch --depth 1 file:///hostgit <快照 SHA>
  pnpm install，构建 CLI（PR 2 起也构建 MCP）
  每个 task：
    清空 /tmp/verify-uvw
    claude -p "$($V brief --own <run-id> <feature> [ids])"
      agent 按 feature 文件的前置条件自己执行 up、user 和 doctor，然后跑 journey。回复时不执行 down
    对每个 run 依次执行 secret-check（证据和 transcript）、down，再把 run 目录复制到 /batch/<task>/runs/
```

五个设计点：

- **实例由 agent 启动。** `$V up` 的参数只写在 recipe 正文里。有几条 journey 还会在中途自己启动或重启实例，例如 MO3 的 `up --reuse`、mcp-auth 第 219 行的第二个实例、mcp-production、mcp-executor 第 248 行的 `MCP_SYNC_BUDGET_MS=1`，以及 agent-skills 和 sheet-lens。让 runner 来启动实例，就得在仓库里另建一套重复的启动参数。容器是一次性的，所以让 agent 照 recipe 原文执行。
- **快照是一个真正的 commit。** 用临时 index 把工作区（含未跟踪、不含已忽略的文件）写成一个以 HEAD 为父的 commit，不挂 ref。`run.env` 里的 `GIT_HEAD` 和 doctor 的 HEAD 检查记录的就是被测代码本身。不需要 patch、tar 或分支名。
- **队列在内存里。** 宿主上只有一个 `runner.mjs` 进程驱动所有容器，空闲的 runner 从数组里取下一个 task。不需要共享目录。
- **先查密钥，再停实例，最后复制。** `down` 会删掉 run 的密钥原值，之后 `secret-check` 只能按格式匹配（SKILL.md 的 Evidence 一节）。所以 agent 回复时不执行 `down`，由 `task.sh` 按这个顺序收尾。
- **报告里的路径在宿主上能直接打开。** agent 写的是容器内的 `/tmp/verify-uvw/<run-id>/...`。`runner.mjs` 生成 `report.md` 时把这个前缀替换为 `<batch>/<task>/runs/`，复制出来的目录结构与之对应。不改容器内的 `VERIFY_UVW_ROOT`，因为 recipe 和 `features/README.md` 里写死了 `/tmp/verify-uvw/`。

## 2. 数据形状

```ts
type Task = { id: string; feature: string; journeys: string[] };   // 由 "feature" 或 "feature:ID,ID" 解析；id 同时用作 VERIFY_UVW_RUN
type Batch = { id: string; sha: string; jobs: 1 | 2 | 3; tasks: Task[]; dir: string };
type TaskResult = {
  task: string;
  status: "reported" | "host-only" | "no-report" | "timeout" | "infra-error" | "secret-leak";
  result: "PASS" | "ISSUES" | null;        // 取自报告的最后一行 RESULT:
  turns: number | null;
  wallSeconds: number;
  usage: { input: number; cacheRead: number; output: number } | null;
};
```

`id` 用作 run id，必须满足 MCP mode 对 run id 的要求 `^[a-z0-9][a-z0-9_-]*$`。由 feature 名加序号生成。

退出码：

| 退出码 | 条件 |
| --- | --- |
| 0 | 每个 task 的 `status` 都是 `reported` |
| 3 | docker 不可用，或者至少有一个 task 是 `host-only`。其余 task 照常执行，`summary.md` 列出需要在宿主上跑的 task |
| 4 | 至少一个 task 是 `no-report`、`timeout`、`infra-error` 或 `secret-leak`。优先于 3 |
| 5 | 找不到 key |

## 3. PR 0：修复 recipe 漂移

独立 PR，基于 `main`。这一步不依赖 runner，用宿主流程验证。

| 项 | 改动 |
| --- | --- |
| `$RUN` 未定义 | `bin/verify-uvw` 的 `cmd_env` 增加 `export RUN=$RUN`。SKILL.md 的 Drive 一节和 `references/mcp-mode.md` 中列举导出变量的地方同步更新。受影响的位置有 `features/mcp-executor.md:98`、`features/mcp-html-view.md:102` 和 `features/mcp-blobs-office.md:148` |
| HV2 | `features/html-view.md` 的 HV2 用 curl 读页面，但没有带 cookie，页面也还没有分享。先读 recipe 和产品行为，再决定是补上 cookie，还是在前一步先分享页面。原型的 transcript 在 `/tmp/verify-runner-proto/out/vr-d/` |
| Editor merges | `features/pull-requests.md` 中，“Editor merges” 依赖一个只有 MCP 步骤才会创建的文件。改成在 default mode 下自己准备这个文件，或者把这一步移到需要 MCP 的部分。原型的 transcript 在 `/tmp/verify-runner-proto/out/vr-c/` |

验收：在宿主上用现有流程，让一个 subagent 跑 `$V brief html-view HV2`、`$V brief pull-requests`，以及一条使用 `$RUN` 的 MCP journey（例如 `mcp-blobs-office`）。这些 step 都应当 PASS，或者只剩与本 PR 无关的 FAIL，并在 PR comment 中说明。

## 4. PR 1：runner，覆盖 default mode

基于 `main`，作为 stack 的底层。

### 4.1 文件

| 文件 | 内容 |
| --- | --- |
| `.agents/skills/verify-uvw/runner/Dockerfile` | runner 镜像（4.2 节） |
| `.agents/skills/verify-uvw/runner/task.sh` | 在容器内执行一个 task（4.4 节）。它从快照的 `~/repo` 里运行，所以修改它不需要重建镜像 |
| `.agents/skills/verify-uvw/bin/runner.mjs` | 宿主一侧的编排（4.3 节） |
| `.agents/skills/verify-uvw/bin/runner.test.mjs` | 单元测试（4.7 节） |
| `.agents/skills/verify-uvw/bin/verify-uvw` | 新增 `runner` 命令，直接 `exec node "$BIN/runner.mjs" "$@"`。新增 `brief --own`（4.5 节） |
| `.agents/skills/verify-uvw/features/README.md` | `(host only)` 标记的规则（4.6 节） |
| `.agents/skills/verify-uvw/features/*.md` | 给 MCP mode 的 feature 加上 H1 标记（4.6 节） |
| `.agents/skills/verify-uvw/SKILL.md` | 新增 “Run journeys in the runner” 一节，并把 `runner` 列进命令清单。改写 “Hand the driving to another agent” 末段，删掉 “Default mode also runs on Linux. MCP mode and `uvw` stories need macOS.”，改为说明 runner 的适用范围，并写明 runner 镜像内置 Claude Code 和 DeepSeek 是 “names no model” 的例外 |
| `DREAMNUM.md` | 按它自己的规则判断 DeepSeek API 是否算新的外部依赖，需要就同步更新 |

`skill-docs.test.mjs` 要求 `bin/verify-uvw` 读取的每个 `VERIFY_UVW_` 变量都写在 SKILL.md 或 references 里。本 PR 新增的 `VERIFY_UVW_RUNNER` 要写进 SKILL.md 的 runner 一节。

### 4.2 镜像

以原型的 `/tmp/verify-runner-proto/Dockerfile` 为起点，做以下改动：

```dockerfile
FROM node:24-bookworm
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-noto-cjk fonts-liberation ffmpeg python3-pip lsof jq openssl \
    && pip3 install --break-system-packages openpyxl==3.1.5 \
    && rm -rf /var/lib/apt/lists/*
RUN npm i -g pnpm@11.24.0 agent-browser@0.42.0 @anthropic-ai/claude-code@2.1.331 && npm cache clean --force
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium \
    DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic \
    ANTHROPIC_MODEL='deepseek-flash[1m]' ANTHROPIC_DEFAULT_OPUS_MODEL='deepseek-flash[1m]' \
    ANTHROPIC_DEFAULT_SONNET_MODEL='deepseek-flash[1m]' ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-flash \
    CLAUDE_CODE_SUBAGENT_MODEL=deepseek-flash CLAUDE_CODE_EFFORT_LEVEL=high \
    CLAUDE_CODE_AUTO_COMPACT_WINDOW=786432 VERIFY_UVW_RUNNER=1
USER node
RUN mkdir -p /home/node/.local/share/pnpm
WORKDIR /home/node
```

要点：

- 镜像里先以 `node` 用户建好 `~/.local/share/pnpm`，新的 named volume 就归 `node` 所有，不再需要原型里那一步 root chown（已实测）。
- 镜像里没有任何 key。`ANTHROPIC_AUTH_TOKEN` 和 `DEEPSEEK_API_KEY` 在每个 task 的 `docker exec` 中传入。
- 镜像 tag 为 `uvw-verify-runner:<Dockerfile 内容 sha256 的前 12 位>`。`runner.mjs` 发现该 tag 不存在时才执行 `docker build`。冷构建约 95 秒。
- `node:24-bookworm` 与 `apps/mcp/Dockerfile` 使用同一个 Debian 版本，所以 chromium 和字体与 MCP 生产镜像一致。不要换成别的发行版。
- `claude` 输出的 `[claude-code:unrecognized_model]` 警告是因为它不认识 `deepseek-flash`，不影响运行。

### 4.3 `runner.mjs`

用法：

```bash
$V runner [--jobs N] [--keep] <feature[:ID,ID]>...
```

- `--jobs` 默认取 task 数和 3 中较小的那个，超过 3 时报错。
- `--keep` 在结束时保留容器，便于排查。

执行步骤：

1. **查找 key。** 先查环境变量 `DEEPSEEK_API_KEY`，再查仓库根目录 `.env` 中的 `DEEPSEEK_API_KEY=` 行。都没有时打印 “DEEPSEEK_API_KEY not found; set it or add it to .env”，以 exit 5 退出，此时还没有启动任何容器。
2. **检查 docker。** `docker info` 失败时以 exit 3 退出，并提示改用宿主流程。
3. **预检。** 对每个 task，在宿主上执行 `$V brief --own <id> <feature> [ids]`，只看退出码，丢弃输出。退出码为 3 的 task 标为 `host-only`，不进入队列。全部 task 都是 `host-only` 时，以 exit 3 退出，不启动容器。
4. **生成 batch id。** 格式为 `<yyyymmdd-hhmmss>-<4 位随机>`，输出目录为 `${VERIFY_UVW_ROOT:-/tmp/verify-uvw}/runner/<batch>`。
5. **做快照 commit。** 以下命令都用一个临时目录里的 `GIT_INDEX_FILE`，不碰用户的 index：
   ```bash
   GIT_INDEX_FILE=$tmp/index git read-tree HEAD
   GIT_INDEX_FILE=$tmp/index git add -A
   tree=$(GIT_INDEX_FILE=$tmp/index git write-tree)
   sha=$(git commit-tree "$tree" -p HEAD -m "verify-runner snapshot <batch>")
   ```
   不创建 ref。这个 commit 只是对象库里一个未被引用的对象，git 默认两周后才会清理。`.env` 被忽略，所以不会进入快照。`summary.md` 记下 `sha` 和 `git rev-parse HEAD`。
6. **启动容器。** 共 N 个：
   ```bash
   docker run -d --init --name uvw-verify-<batch>-r<k> --label uvw-verify.batch=<batch> --shm-size=1g \
     -v "$(git rev-parse --path-format=absolute --git-common-dir)":/hostgit:ro \
     -v uvw-verify-runner-pnpm-store:/home/node/.local/share/pnpm \
     -v <dir>:/batch <image> sleep infinity
   ```
7. **构建环境。** 每个容器执行一次，日志写到 `/batch/r<k>-setup.log`：
   ```bash
   git config --global --add safe.directory '*'
   git init -q ~/repo && cd ~/repo && git fetch -q --depth 1 file:///hostgit <sha> && git checkout -q FETCH_HEAD
   pnpm install --frozen-lockfile
   pnpm --filter 'univer-workspace-cli...' build
   ```
   任何一步失败，这个 runner 就退出，它还没领取的 task 留给其他 runner。所有 runner 都失败时，以 exit 4 退出。
8. **执行 task。** 每个 runner 是一个 async 循环，从同一个数组里 `shift()` 取 task，然后执行 `docker exec -e ANTHROPIC_AUTH_TOKEN -e DEEPSEEK_API_KEY <c> bash ~/repo/.agents/skills/verify-uvw/runner/task.sh <task-id> <feature> [ids]`。`-e` 后面只写变量名，值放在 Node `spawn` 的 `env` 选项里，这样 key 不会出现在宿主的 `ps` 和日志里。
9. **扫描 key。** 每个 task 结束后，在 `<dir>/<task>/` 下搜索 key 的原值。找到就把该 task 标为 `secret-leak`。不自动删除，交给用户处理。
10. **生成报告。** 从 `transcript.jsonl` 中取最后一条 `type == "result"` 的记录，字段为 `.result`、`.num_turns` 和 `.usage`。不要使用 `total_cost_usd`，它按 Opus 的价格计算。`.result` 中的 `/tmp/verify-uvw/` 替换为 `<dir>/<task>/runs/` 之后写入 `report.md`，其余字段写入 `result.json`。
11. **汇总。** 生成 `summary.md`，每个 task 一行，包括 task、status、RESULT、turns、耗时和 token。然后按 label 删除本 batch 的容器，`--keep` 时保留。收到 SIGINT 或 SIGTERM 时，同样按 label 清理。
12. **退出码** 按第 2 节。

### 4.4 `task.sh`（容器内）

```bash
task=$1 feature=$2; shift 2
out=/batch/$task; mkdir -p "$out/runs"
cd ~/repo; V=.agents/skills/verify-uvw/bin/verify-uvw
rm -rf /tmp/verify-uvw
$V brief --own "$task" "$feature" "$@" > "$out/brief.txt" || exit 3
timeout 1800 claude -p "$(cat "$out/brief.txt")" --output-format stream-json --verbose --max-turns 150 \
  --dangerously-skip-permissions > "$out/transcript.jsonl" 2> "$out/claude.stderr"
echo $? > "$out/claude.exit"
for r in /tmp/verify-uvw/*/run.env; do
  [ -e "$r" ] || continue; id=$(basename "$(dirname "$r")")
  { VERIFY_UVW_RUN=$id $V secret-check; VERIFY_UVW_RUN=$id $V secret-check "$out"; } > "$out/secret-check-$id.txt" 2>&1
  VERIFY_UVW_RUN=$id $V down >/dev/null 2>&1
  cp -r "/tmp/verify-uvw/$id" "$out/runs/$id"
done
```

- `secret-check` 必须在 `down` 之前，见第 1 节。第二次 `secret-check` 扫描 transcript 所在目录。
- 上一个 task 的 run 在它自己的 `task.sh` 里已经 `down` 过，所以开头的 `rm -rf` 只清理残留。
- 已知限制：recipe 里另设 `VERIFY_UVW_ROOT` 启动的 run（例如 sheet-lens 和 mcp-production），不在 `/tmp/verify-uvw` 下，这个循环找不到。宿主上的 key 原值扫描仍然覆盖它们。容器在 batch 结束时删除，它们的进程随之结束。

### 4.5 `brief --own`

`cmd_brief` 增加一个变体：`$V brief --own <run-id> <feature> [journey-id...]`。它不调用 `load_run`，因为此时还没有实例。输出文本与现有 brief 的区别：

- 开头一句：“This container is disposable and yours. Start the instance yourself.”
- 每个 shell 的开头一行改为 `export VERIFY_UVW_ROOT=/tmp/verify-uvw VERIFY_UVW_RUN=<run-id>; V=...; eval "$($V env 2>/dev/null)"`。`up` 之前 `$V env` 会失败，`2>/dev/null` 让这一行仍然可用。
- 步骤：
  1. 阅读 Drive 和 Evidence 两节，以及 `features/README.md`。
  2. 按 feature 文件的前置条件执行 `$V up`、`$V user` 和 `$V doctor`。doctor 有 `FAIL` 时停止，并报告这些行。recipe 要求另开 run 或重启实例时，照做。
  3. 执行指定的 step。未指定 step 时，带 `(host only)` 标记的 journey 在报告中写 `<id>: SKIP (host only)`。
  4. 回复。不要对 `<run-id>` 执行 `down`，runner 会在检查证据之后停掉它。
- 报告格式与现有 brief 相同，最后一行为 `RESULT: PASS|ISSUES`。
- 保留 “Do not edit files in the repository” 和 “When the product differs from the recipe, do not work around it”。

退出码 3 的条件：feature 的 H1 带 `(host only)`，或者指定的 journey 全部带标记。

宿主流程仍然使用不带 `--own` 的 brief，文本和行为都不变，忽略标记。

### 4.6 `(host only)` 标记

- 规则：feature 文件的 H1，或者某条 journey 的 `###` 标题，以 ` (host only)` 结尾，就表示它不能在 runner 里跑。这条规则写进 `features/README.md` 的 Feature entry contract。
- 这是判断 “能否在 runner 里跑” 的唯一依据。`runner.mjs` 的预检和 `brief --own` 都只读它。
- PR 1 中还没有 `dist`，所以给所有 MCP mode 的 feature 的 H1 加上标记。用 `grep -l 'VERIFY_UVW_MCP=1' features/*.md` 列出，共 15 个，包括 agent-handoff、agent-skills 和 sheet-lens。PR 2 把这些标记从 H1 移到具体的 journey 上。

### 4.7 测试

在 `runner.test.mjs` 中用 `node:test` 覆盖：

- 参数解析：`feature`、`feature:ID,ID`、`--jobs 4` 报错、task id 的生成和去重。
- key 的查找顺序：环境变量优先于 `.env`。`.env` 中带引号的值、注释行和缺失的情况。
- 退出码的映射，包括 4 优先于 3。
- 从 stream-json 中提取 report 和 result，以及路径前缀的替换。fixture 用原型的一份 transcript，截短并去掉其中的数据。
- `(host only)` 标记的解析：H1 带标记、journey 带标记、指定的 journey 全部带标记。

verify-uvw 的测试目前没有接入 CI，用 `node --test .agents/skills/verify-uvw/bin/*.test.mjs` 运行，包括 `skill-docs.test.mjs`。要不要接入 CI 由用户决定，在 PR comment 中提出。

### 4.8 验收

以下每一项都要在 PR comment 中给出命令和结果：

1. `$V runner link-sharing:LS1,LS2,LS3,LS4 auth` 以 exit 0 结束。两个 task 的 RESULT 都是 PASS。`report.md` 中的证据路径在宿主上能直接打开，`runs/*/evidence` 中有截图和 cli 记录，`secret-check-*.txt` 都是 ok。
2. 效果检查：在一个临时分支上删掉 `apps/workspace/server/src/db/sqlite/access/access.repository.ts` 中 link sharing 的 `enabled = 1` 条件，不要提交到 PR，然后执行 `$V runner link-sharing`。LS3 应当报 FAIL。这一步证明 runner 能抓到真实缺陷，也证明快照带上了未提交的改动。
3. `--jobs 3` 跑 3 个 task，记录总耗时和每个容器的构建耗时。参考值：单个 runner 构建 33–56 秒，并发构建 80–133 秒，task 切换约 5 秒。
4. `$V runner mcp` 以 exit 3 退出，没有启动容器。
5. 清空 `DEEPSEEK_API_KEY` 并临时移走 `.env` 后，以 exit 5 退出，`docker ps` 中没有新容器。
6. 停掉 docker 后，以 exit 3 退出。
7. 在执行过程中按 Ctrl-C，之后 `docker ps -a --filter label=uvw-verify.batch` 为空。
8. 宿主流程没有变化：在改动前后，分别在宿主上执行 `$V up`、`user`、`doctor` 和 `down`，比较 doctor 输出的检查项和结果，pid、端口和 run id 除外。再跑一次不带 `--own` 的 `$V brief link-sharing`，文本应与 `main` 相同。
9. 跑完之后，`git status` 和 `git stash list` 与开始前相同，`git for-each-ref refs/` 中没有新的 ref。
10. 跑完之后，容器内 `ps -eo stat | grep -c '^Z'` 为 0（用 `--keep` 检查）。

## 5. PR 2：`dist` 启动方式和 MCP

基于 PR 1。

### 5.1 文件

| 文件 | 内容 |
| --- | --- |
| `.agents/skills/verify-uvw/bin/mcp-processes.mjs` | 角色表，以及 `start`、`stop`、`exec` 和 `logs` 四个子命令 |
| `.agents/skills/verify-uvw/bin/mcp-processes.test.mjs` | 一致性测试和角色表的单元测试 |
| `.agents/skills/verify-uvw/bin/verify-uvw` | `VERIFY_UVW_MCP_FROM`。`up`、`doctor`、`down` 和 `mcp_compose` 按启动方式分派。`OPENCODE_MODEL` 可覆盖 |
| `.agents/skills/verify-uvw/bin/executor-doctor.mjs`、`renderer-doctor.mjs` | 拆成容器形态检查和功能检查两部分（5.5 节） |
| `.agents/skills/verify-uvw/bin/mcp-call.mjs` | 使用 `dist` 时从日志文件读取 gateway 和 executor 日志（第 131 行一带） |
| `.agents/skills/verify-uvw/bin/mcp-oauth-opencode.sh` | 凭据的导出和导入加上 `console-*` 判断 |
| `.agents/skills/verify-uvw/runner/Dockerfile` | 安装 opencode、poppler-utils、imagemagick 和 `magick` shim。设置 MCP 相关的环境变量 |
| `.agents/skills/verify-uvw/runner/task.sh` 和 `runner.mjs` 的构建步骤 | 构建环境时也构建 MCP |
| `features/*.md` | 把 `(host only)` 标记从 MCP feature 的 H1 移到具体 journey（5.6 节）。M1 的通过条件按启动方式区分 |
| `references/mcp-mode.md`、`features/mcp.md` 的 Gotchas、SKILL.md | 说明两种启动方式。`VERIFY_UVW_MCP_FROM` 和 `VERIFY_UVW_OPENCODE_MODEL` 写进 `references/mcp-mode.md`，满足 `skill-docs.test.mjs` |
| `docs/design/workspace-mcp/local-verification.zh-CN.md` | 修订第 1 节的 R1 和 R5 |
| `docs/design/workspace-mcp/README.zh-CN.md` | 在 D13 后补充一句：`dist` 只是功能验证的补充 |

### 5.2 `VERIFY_UVW_MCP_FROM`

- 默认值为 `image`，行为与今天完全相同。
- 设为 `dist` 且 `VERIFY_UVW_RUNNER` 不为 1 时，`up` 报错退出：“the dist start mode runs only inside the verify runner”。
- 使用 `dist` 时，`up` 的行为：
  - 跳过 `mcp-engine.mjs` 检查。
  - 像检查 CLI 那样检查 `apps/mcp/dist` 是否比 `src` 新，过期时打印修复命令 `pnpm --filter '@univerjs/univer-workspace-mcp...' build`。`up` 本身不负责构建。
  - staging 目录直接 `mkdir` 加 `chmod 700`，不用 `mcp_up` 里那一步 `docker run` chown（`bin/verify-uvw:111-112`）。进程与 verify-uvw 是同一个用户。
  - 为每个内部角色选一个空闲端口（5.3 节），写入 `run.env`。`run.env` 中写入 `MCP_FROM=dist`。
  - 通过 `mcp-processes.mjs start` 按 renderer、executor、可选的 executor-b、gateway 的顺序启动，每个角色都等到 `/healthz` 通过。
- 渲染用的浏览器取自环境变量 `UNIVER_RENDER_BROWSER`，由 runner 镜像设置，与 `apps/mcp/Dockerfile` 相同。没有这个变量时报错，不要写死路径。

### 5.3 `mcp-processes.mjs`

- 角色表是唯一的数据源，记录每个角色的 `MCP_ROLE` 和环境变量。环境变量的取值逐项对照 `compose.verify.yml`，并沿用 `mcp_compose` 中的条件：renderer 开关、`MCP_PRODUCTION`、executor 数量和 allowlist。
- 端口：gateway 用 `VERIFY_UVW_MCP_PORT`，与今天相同。executor、renderer 和 executor-b 在 `up` 时各自选一个空闲端口（`net.createServer().listen(0, '127.0.0.1')` 取得后关闭），记录在 `run.env` 中。不要用固定偏移。固定偏移会与文档中的并行 run 冲突，例如 SKILL.md 第 172 行用 3931，mcp-auth.md 第 219 行用 3933。
- 角色之间的地址：compose 里的 `http://executor:3000` 这类服务名，换成 `http://127.0.0.1:<该角色端口>`。Workspace 的 transport 目标从 `http://host.docker.internal:<server port>` 换成 `http://127.0.0.1:<server port>`。
- 进程用 `env -i` 启动，只传 `PATH`、`HOME` 和角色表中的变量，与 compose 下每个容器只看到自己的环境一致。工作目录为 `apps/mcp`。pid 写入 `$RUN/mcp-<role>.pid`，日志写入 `$RUN/logs/mcp-<role>.log`。
- `exec <run> <role> -- <cmd...>`：在 `apps/mcp` 下，用该角色的环境执行命令。`mcp_compose exec` 和两个 doctor 脚本都走这里。
- `MCP_EXECUTOR_ALLOWED_USER_IDS` 为空时不传。传空字符串会让 executor 的配置校验失败。
- 停止时先发 SIGTERM，最多等 5 秒，再发 SIGKILL。
- 一致性测试：从 `compose.verify.yml` 的文本中逐个服务提取 `environment:` 下的变量名集合，与角色表比对。仓库根目录下解析不到 YAML 库，不要为此新增依赖，按缩进做文本解析即可。

### 5.4 verify-uvw 的分派

- `mcp_compose` 根据 `MCP_FROM` 分派：
  - `logs`：读取日志文件。
  - `ps -q <svc>`：返回存活的 pid。
  - `exec -T <svc> <cmd>`：调用 `mcp-processes.mjs exec`。`renderer-call` 依赖这个行为。
  - `up -d --force-recreate --no-deps --wait <svc>`：重启该角色。

  这样 `renderer-call`、`renderer-restart`、`mcp-allow-users`、`mcp-gateway-restart` 和 `mcp-logs` 都不用改。
- `mcp_down` 使用 `dist` 时，停止所有角色，并删除 staging 目录。
- 原型的一次性实现在 `/tmp/verify-runner-proto/process-engine.sh`，可以参考。它用 `declare -f` 改名覆盖原函数，这种写法不要用在正式实现里。

### 5.5 doctor 的拆分

`executor-doctor.mjs` 和 `renderer-doctor.mjs` 现在各自是一个 try 块，第一步就是 `docker compose ps` 和 `docker inspect`。在 `dist` 下第一步失败，后面的功能检查全部跳过。被跳过的有：

- executor RPC 拒绝缺失和错误的 bearer。
- executor probe 经 transport 访问 Workspace HTTP、ticket 和协作 WebSocket。
- 经 MCP 工具创建 `Executor doctor` PR 和 `Doctor` Sheet。`features/README.md` 把它们写成 MCP mode 的基线。
- renderer 的 `measureText` 探测和 bearer 拒绝。
- 日志中的 license 值扫描。

README 6.2 节的 “doctor 17 ok” 来自 `process-engine.sh` 自己的 `mcp_doctor`，它根本没有调用这两个脚本。所以 `dist` 下的完整 doctor 还没有实测过。

改法：

- 两个脚本都增加 `from` 参数和 `transport` 参数（期望的 Workspace transport URL）。
- 容器形态检查（容器存在且 healthy、镜像摘要、容器环境变量、无发布端口、renderer 只在 internal 网络上）只在 `from === 'image'` 时执行。
- 功能检查对两种方式都执行。其中 `node(service, code)` 在 `image` 下仍然是 `docker compose exec`，在 `dist` 下调用 `mcp-processes.mjs exec`。
- `dist` 下不执行的每一项检查，各输出一行以 `skip` 开头的说明，写明原因（“dist start mode has no container”）。
- `features/mcp.md` 的 M1 目前要求每一项 MCP 检查都是 `ok`。改为：`image` 下要求全部 `ok`，`dist` 下允许 `skip` 行，但功能检查必须 `ok`。

### 5.6 `(host only)` 标记的落点

PR 2 删掉 PR 1 加在 MCP feature H1 上的标记，改为标在具体的 journey 上。第一批（实施时用 `grep -n 'docker ' features/*.md` 和 `grep -n 'agent-up' features/*.md` 复核）：

- `mcp-security`：H1 保留标记。它测的就是容器边界。
- `mcp.md` 的 M10 和 M12。
- `mcp-executor.md` 的 MX3、MX11、MX12 和 MX13。MX3 直接调用 `docker stop`，后三条经由 `mcp-resilience.mjs` 调用 `docker kill`、`docker logs` 和 `host.docker.internal`。
- `mcp-auth.md` 中用到 `$V agent-up` 的那条 journey（第 249 行）。`agent-up` 在 Linux 上没有测过。

本期不新增 `mcp-stop` 和 `mcp-start`，也不移植 `mcp-resilience.mjs`。

### 5.7 opencode

- 在镜像中，按 `TARGETARCH` 从 `https://opencode.ai/files/bin/2.0.29/opencode-linux-arm64.tar.gz` 或 `opencode-linux-x64-baseline.tar.gz` 下载 opencode，解压到 `/usr/local/bin`。npm 上的 `opencode-ai` 最新只到 1.19.6，不要用 npm 安装。
- 设置环境变量 `VERIFY_UVW_OPENCODE_MODEL=deepseek/deepseek-flash#high`。opencode 内置的 `deepseek` provider 读取 `DEEPSEEK_API_KEY`，不需要配置文件。
- `bin/verify-uvw` 中改为 `OPENCODE_MODEL=${VERIFY_UVW_OPENCODE_MODEL:-console-deepseek/deepseek-flash#high}`。
- `mcp-oauth-opencode.sh` 中，只有当 `MCP_OPENCODE_MODEL` 以 `console-` 开头时，才执行 `opencode auth export 'OpenCode Console'` 和 `opencode auth import`。
- `story.mjs` 也导出 `OpenCode Console` 凭据。没有 feature 调用 `$V story`，story 留在宿主上，本期不改。
- 镜像中再加：
  - `poppler-utils` 和 `imagemagick`。
  - `/usr/local/bin/magick` shim。bookworm 的 ImageMagick 6 没有 `magick`，而 recipe 用了 `magick identify` 和 `magick <in> ... <out>` 两种写法：
    ```sh
    #!/bin/sh
    case "$1" in identify|compare|composite|conjure|convert|mogrify|montage|stream) t=$1; shift; exec "$t" "$@";; esac
    exec convert "$@"
    ```
  - 环境变量 `UNIVER_RENDER_BROWSER=/usr/bin/chromium` 和 `VERIFY_UVW_MCP_FROM=dist`。
- 构建环境时增加 `pnpm --filter '@univerjs/univer-workspace-mcp...' build`。实测约 11 秒，所以不区分 batch 里有没有 MCP 任务，一律构建。

### 5.8 测试

- `mcp-processes.test.mjs`：
  - 一致性测试。给 `compose.verify.yml` 加一个变量而不改角色表时，测试应当失败。
  - 角色表的条件分支：renderer 关闭、production 模式、两个 executor、allowlist 为空。
  - 选出的端口互不相同，且不等于 gateway 端口。
- 扩展现有的 `mcp-mode.test.mjs`：`dist` 加上非 runner 环境时，`up` 拒绝启动。
- `skill-docs.test.mjs` 通过，即新的变量都有文档。

### 5.9 验收

1. **doctor 先单独验收。** 在 runner 容器里（`--keep` 保留一个容器，`docker exec` 进去），用 `VERIFY_UVW_MCP=1` 执行 `up`、`user` 和 `doctor`。功能检查全部 `ok`，`skip` 行只出现在容器形态检查上，`Executor doctor` PR 和 `Doctor` Sheet 存在。
2. 在 runner 中以 exit 0 跑完以下 task，并逐项核对报告：
   ```bash
   $V runner mcp-blobs-office mcp-executor:MX1,MX2,MX4,MT1 mcp-renderer:MR9,MR10,MR11,MR12,MV2 mcp:M1,M2,M11 mcp-oauth
   ```
   预期结果：
   - MR11 会因为 #553 报 FAIL，这是已知问题。
   - MX4 在 PR 0 之后应当 PASS。
   - mcp-oauth 全部四条都跑，包括 MO3 的 `up --reuse` 和 MO4。MO3 需要访问外网 HTTPS，原型没有在 runner 里测过它，结果如实报告。
   - M11、MR12 和 MO1 这次由 agent 自己调用 opencode。原型里这三条是直接执行 recipe 片段，没有经过 agent。
   - 其余 journey 都应当 PASS。原型中的实测结果见 README 4.3 节和 7.4 节。
3. `$V runner mcp-security` 以 exit 3 退出。`$V runner mcp-executor:MX3` 也以 exit 3 退出。
4. 宿主上的 `image` 方式没有变化：在改动前后，分别在宿主上用 `VERIFY_UVW_MCP=1` 执行 `up`、`user` 和 `doctor`，doctor 输出的检查项和结果一致，pid 和 run id 除外。再跑一次 `mcp-blobs-office` 的 MF1 和 `mcp-executor` 的 MX3，结果应为 PASS。
5. 在宿主上设置 `VERIFY_UVW_MCP_FROM=dist` 后执行 `up`，应当报错退出，并且没有启动任何进程。
6. 完成 `local-verification.zh-CN.md` 第 1 节的修订：
   - R1 补充 runner 使用的模型字符串。
   - R5 补充 runner 在 Linux 上使用 `dist` 的情形。

## 6. 原型踩过的坑

| 坑 | 处理 |
| --- | --- |
| Chrome for Testing 没有 linux-arm64 版本 | 用 Debian 的 chromium，并设置 `AGENT_BROWSER_EXECUTABLE_PATH` |
| bookworm 的 openpyxl 3.0.9 会让 `seed-sales.py` 失败 | 用 pip 安装 3.1.5 |
| named volume 让 `~/.local` 变成 root 所有 | 在镜像中预先建好目录（4.2 节） |
| `/hostgit` 的属主与容器用户不同，git 拒绝操作 | `git config --global --add safe.directory '*'` |
| 不加 `--init` 时子进程成为僵尸进程，`opencode service stop` 失败，`down` 要多等约 19 秒 | 始终用 `docker run --init` |
| DeepSeek 会把 `claude-opus*` 映射到更贵的 v4-pro | 所有模型槽位都设为 flash（4.2 节） |
| 账户余额还有其他使用方在消耗 | 成本按 usage 计算 |
| `MCP_EXECUTOR_ALLOWED_USER_IDS=""` 会让 executor 无法启动 | 为空时不传 |
| `renderer-call.mjs` 引用 `./dist/shared/frame.js` | `exec` 的工作目录设为 `apps/mcp` |
| 手工截取 recipe 片段执行时没有 export `V` | 子脚本中找不到 `$V`。截取片段执行时要先 `export V` |
| `up` 打印 “CIMD: claude.ai resolves to fake-IP” | 这是本机 DNS 代理造成的，只影响 MO3。MO3 在 runner 中的表现还没有实测 |
| 镜像缺少 poppler、imagemagick 和 fonts-liberation | 见 4.2 节和 5.7 节 |

## 7. 不在本期范围

- 宿主上使用 `dist`。
- 镜像推送到 registry，以及在云端运行 runner。
- 让容器名跟随 task 变化。
- `mcp-stop` 和 `mcp-start`，以及把 `mcp-resilience.mjs` 移植到 `dist`。MX3 和 MX11 到 MX13 本期标为 host only。
- `$V story`（`uvw` story 需要 macOS 的 `sandbox-exec`）和 `agent-up`。
- 修复 #553。

## 8. 交付时汇报

每个 PR 合并之前，在第一条 PR comment 中用中文写明：

- 验收项逐条的命令和结果。
- 与本文不一致的地方，以及理由。
- 没有验证的部分。
- 留给用户决定的事项。至少包括：verify-uvw 的测试是否接入 CI，以及 `DREAMNUM.md` 的判断结果。
