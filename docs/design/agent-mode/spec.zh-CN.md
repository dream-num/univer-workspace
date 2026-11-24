# Agent Mode 实施规格

> 状态：方案已采纳。阶段 0 已完成，结果见 [阶段 0 结果](phase-0-results.zh-CN.md)。阶段 1 到 4 已实施，第 4 节的“今天”一栏写各项现状。日期 2026-11-23。文中标为“目标”的内容都不是现状。
> 背景、诊断、SDK 的行为和风险的展开见 [README](README.zh-CN.md)。README 只保留与本文一致的内容，范围见第 8 节。两者若仍有不一致，以本文为准。
> “今天”一栏来自对 `main`（`b5aa99a8`）的代码阅读。Collaboration SDK 的行为来自 `@univerjs-pro/collaboration-worktree-service` 1.6.1 的类型和 README，阶段 0 已在运行中复核，见 [阶段 0 结果](phase-0-results.zh-CN.md)。

## 1. 目标与愿景

### 1.1 愿景

officelab 要成为 AI 时代 office 文件协作的基础设施。agent 在其中连接、协作、传播文件，不需要人逐步放行。

Agent Mode 是其中的一种工作方式。人只出现在任务的头和尾。在头部，人把读权或角色交给 agent。在尾部，人看结果，决定任务是否完成。中间没有人。

### 1.2 要解决的问题

今天 agent 走到某一步会被拦下，再回头找人。
一个动作能不能做，取决于主体类别、会话类型、传输方式、工具集、scope、Space 类型和部署配置的组合，agent 在任务开始时算不出自己能不能走完。
任务和 agent 变多之后，人成为瓶颈。

### 1.3 目标

| 目标                | 怎样衡量                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 中间没有人          | 每个任务的人工介入次数。头部一次授权，尾部至多一次合入，中间为零                                                   |
| 人不在关键路径上    | 任务总时长里等人的占比。agent 持有 editor 角色时为零                                                               |
| 开头就知道结局      | agent 读一次 `capabilities` 就知道能走到哪一步，中途不会收到 `AGENT_NOT_ALLOWED` 或 `INTERACTIVE_SESSION_REQUIRED` |
| 上游不靠 agent 自觉 | 上游只给读权时，agent 对 Trunk 没有写入路径。这由权限判定保证，不由提示词保证                                      |

阶段 0 给出前两项的基线数字。

### 1.4 不在目标里

- 不新建 agent 运行时，不托管模型。agent 的循环跑在用户自己的工具里。
- 不建第二条写入路径。每个对 Unit 的修改仍然经过 Worktree。
- 不引入权限引擎，不新建策略对象。合入策略用现有的四个角色表达。
- 不放松第三方保护，包括租户隔离、别人的私有文件、未认领 agent 的过期和未验证标记。
- 不改 HTML View 始终读实时数据的约束。

## 2. 机制

四条规则。后面的 requirement 和模型都从它们推出。

1. agent 在自己拥有的 Space 里全权。它可以创建仓库，并且是自己创建的仓库的 owner。
2. agent 在别人的仓库里只能提议。提议是 agent 自己创建的一个 Worktree，它不改动 Trunk。
3. 提议能否落地，由上游给 agent 的角色决定。viewer 的提议由上游有编辑权的成员合入。editor 自己合入。
4. fork 是 agent 名下对一个上游仓库的整仓视图。agent 在 fork 里直接写，写入自动进入提议。

```text
upstream repo (someone else's Team Space)        agent
  Trunk  <------------- read ------------------  fork view (whole repo, stores nothing)
    ^                                              |
    |                                              | first write to a Unit
    |                                              v
    +---- merge, by whoever may edit Trunk ----  Team Worktree in the upstream repo, authored by the agent
```

## 3. 术语

本文沿用 `apps/workspace/CONTEXT.md` 的词汇。那份文件要求不说 branch 和 Task。

| 术语     | 含义                                                                                    | 是否新对象                      |
| -------- | --------------------------------------------------------------------------------------- | ------------------------------- |
| 上游     | 被提议或被 fork 的 Team Space                                                           | 否                              |
| 提议     | 作者自己不能合入的 Team Worktree                                                        | 否，是 Team Worktree 的一种情形 |
| 合入者   | 执行 Merge 的主体。目标里它可以不是作者                                                 | 否                              |
| Fork     | 一个主体对一个上游的命名视图，加上它在这个上游里先后创建的 Worktree                     | 是，见 5.2                      |
| 基线     | Unit 加入 Worktree 时 Trunk 的修订，即 SDK 的 `baselineTrunkRevision`。加入之后不再变化 | 否                              |
| 落后距离 | Trunk 的当前修订减去基线                                                                | 否，产品今天不返回它            |

## 4. Requirements

“今天”一栏写现状。“阶段”一栏指第 6 节。

### 4.1 agent 自己的空间和它持有的仓库

| 编号 | 要求                                                                                                                        | 今天                                                                                                        | 阶段 |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---- |
| R1   | agent 在自己拥有的 Space 里创建、编辑、合入和分享，不需要人的任何动作                                                       | 已有，已认领的 agent。未认领的 agent 不能把 Space 设为公开（`updateSpace` 上限） | 3    |
| R2   | agent 可以创建仓库（Team Space）。创建它的 agent 是这个仓库的 owner                                                         | 已有。agent 创建的 Team Space 由它持有（`owner_user_id`）。未认领的 agent 至多持有 3 个（`createTeamSpace` 上限） | 3    |
| R2a  | agent 在它持有的仓库里有 owner 的全部能力，包括管理成员、管理 Issue 标签、reopen 和 discard 别人的 Worktree、合入别人的提议 | 已有。agent 是 `owner_user_id`，在 Space 和 Team Worktree 上都按 owner 判定。合入别人的提议由 5.4 的“能合入”决定 | 3    |
| R2b  | 在 agent 持有的仓库里，已认领的 agent 可以被加为 viewer、editor 或 admin。在人持有的仓库里，agent 最高是 editor             | 已有。`addTeamMember` 上限按仓库所有者的类别判定 admin | 2、3 |
| R2c  | 未认领的 agent 可以持有自己的仓库。它不能成为任何仓库的成员，也不能添加成员                                                 | 已有。未认领的 agent 可以创建仓库，不能成为成员，也不能添加成员（`addTeamMember` 上限） | 3    |
| R2d  | 认领 agent 的人对它持有的每个仓库有 owner 的能力。agent 过期或被封禁时，它持有的仓库被暂停                                  | 与目标一致。认领人经 `ownsSpaceSql` 是 Space、其中 Team Worktree 和 Issue 的 owner，能 reopen、discard 别人的 Worktree；`ownerSuspendedSql` 把它连同其中的 Team Worktree 和 Issue 一起暂停 | 3    |
| R3   | 人在头部授予的 scope 在中途算数。授予了 `worktree:merge`，agent 验证后就自己合入                                            | 不算数。人的 token 会话的说明文字要求把合入留给用户，`pr_merge` 需要 `?toolsets=admin`                      | 1    |

### 4.2 参与别人的仓库

| 编号 | 要求                                                                                        | 今天                                                                                                                       | 阶段 |
| ---- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---- |
| R4   | 上游只给读权，agent 就能提议。agent 对上游的 Trunk 没有写入路径                             | 已有。Space Member 包括 viewer 都能创建 Team Worktree，把能读的 Unit 加进来，修改并 ready。已认领的 agent 可以作为 viewer 或 editor 成为 Space Member，未认领的不能（`addTeamMember` 上限） | 2    |
| R5   | 提议能否落地只由上游给 agent 的角色决定。viewer 的提议由有编辑权的成员合入，editor 自己合入 | 已有。“能合入”按 5.4 的新定义判定（`worktrees.service.ts` 的 `mayMerge`）                                                  | 2    |
| R6   | agent 在任务开始时读一次 `capabilities`，就知道自己能提议还是能合入                         | 部分。`capabilities` 按资源返回，不包含 scope 和上限（见 9.2）                                                             | 2    |
| R7   | 每次合入都记录作者和合入者                                                                  | 已有。`creator_user_id` 和 `mergedBy`                                                                                      | 2    |
| R8   | 上游的 owner 和 admin 可以丢弃任何针对本仓库的 Worktree。丢弃之后它不再阻塞永久删除         | 已有。Team Worktree 的 `discard` 对 owner 和 admin 开放，Trash 只看未结束的 Worktree                                       | 2    |

### 4.3 Fork

| 编号 | 要求                                                                         | 今天                                            | 阶段 |
| ---- | ---------------------------------------------------------------------------- | ----------------------------------------------- | ---- |
| R9   | fork 的单位是整个仓库。创建 fork 只写一行记录，不复制任何 Unit 或 Blob       | 已有。`POST /api/forks` 只写 `forks` 的一行 | 4    |
| R10  | fork 里没改过的文件显示上游 Trunk 的最新内容                                 | 已有。经 fork 读一个不在它 Worktree 里的 Unit 时读上游 Trunk（Client Core 的 `forks.readScope`）。跨 Unit 引用的限制见 5.5 | 4    |
| R11  | Unit 在第一次被写入时加入 fork 当前的 Worktree，基线取在那一刻。Unit ID 不变 | 已有。写入先经 `POST /api/forks/{forkId}/units` 把 Unit 加进 fork 的 Worktree，基线是那一刻的 Trunk 修订，Unit ID 不变 | 4    |
| R12  | 一个 fork 同一时间至多有一个未结束的 Worktree。它整体提交，结果按项记录      | 已有。部分唯一索引 `worktrees_open_fork` 保证至多一个。SDK 整体提交，结果按 Unit 记录 | 4    |
| R13  | Worktree 结束后 fork 继续可用。下一次写入开始一个新的 Worktree               | 已有。Worktree 合入或丢弃后 fork 回到 `clean`，下一次写入打开新的 Worktree | 4    |
| R14  | 提议之后、合入之前，fork 不接受写入。要继续修改，先 reopen                   | 已有。写入返回 409 `FORK_WORKTREE_NOT_DRAFT`，reopen 之后可以写 | 4    |

### 4.4 回程

| 编号 | 要求                                                                                     | 今天                                                                                | 阶段 |
| ---- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---- |
| R15  | 回程是现有的 Worktree Merge。fork 里的 Unit 和上游的 Unit 共享修订历史                   | 已有                                                                                | 2    |
| R16  | 每个来自 Trunk 的 Worktree Unit 返回落后距离和加入时间。超过阈值时标记为 stale，提示重做 | SDK 暴露基线和 Trunk 的当前修订。产品不返回                                         | 2    |
| R17  | 落后距离大于零时，验证在 merge preview 上做，不在草稿上做                                | `mergePreview` 打开方式已有。没有地方要求这样做                                     | 2    |
| R18  | HTML View 的修改覆盖写。上游的内容在草稿创建之后变了，就不覆盖                           | 已有。`replace` 草稿的 `base_etag` 不一致时只有这一页 `conflicted`，Sheet 照常合入  | 5    |
| R19  | 其他 Blob 在 fork 里的修改覆盖写，规则同 R18                                             | 已有。经 fork 替换的 Blob 是挂在 Worktree 上的文件草稿，`base_etag` 不一致时只有这一份 `conflicted`，Sheet 照常合入。只能替换，不能新增 | 5    |

### 4.5 隔离

| 编号 | 要求                                                                        | 今天                                                                                | 阶段 |
| ---- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---- |
| R20  | 读 Worktree 或 fork 里来自上游的内容，读者自己必须有上游的读权              | 已有。`authorizeProtocol` 和 `canReadUnit` 检查读者对上游 Resource 的 `openContent` | 2    |
| R21  | 上游收回 agent 的成员资格后，agent 立刻读不到、写不了 fork 里来自上游的内容 | 已有。写入要求能在上游提议，即成员资格，或上游公开读取时它的 `proposals` 设置接纳这个读者。两者都不满足后写入被拒绝。读跟随上游的读权：私有上游读不到；公开上游像对任何公开读者一样仍然可读 | 4    |
| R22  | fork 不保存任何上游数据。删除 fork 不影响上游                               | 已有。fork 只有 `forks` 的一行。删除只删这一行，它的 Worktree 留在上游，成为普通的 Team Worktree | 4    |
| R23  | 未认领 agent 的文件配额覆盖它拥有的全部 Space，仓库和 fork 的数量有上限     | 已有。`createFiles` 数它持有的全部 Space 的文件（`countOwnedFiles`），它至多持有 3 个 Team Space 和 3 个 fork | 3、4 |
| R24  | 用户、角色、Resource、Unit、Worktree 和修订都由服务端从会话和产品数据推导   | 已有，保持                                                                          | 全部 |

## 5. 方案

### 5.1 关键设计决定

| 编号 | 决定                                                       | 理由                                                                                                                                                                                                   |
| ---- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1   | 提议是上游仓库里的 Team Worktree，作者是 agent             | Team Worktree 已经有 `space` 可见性、仓库内的编号、成员评审，以及 owner 和 admin 的 reopen 与 discard。User Worktree 被数据库约束固定为私有，上游看不到它                                              |
| D2   | 把“能提议”和“能合入”分成两个判定                           | 今天一个判定 `lands` 同时决定编辑草稿、加 Unit、ready 和合入，所以没有编辑权的主体什么都做不了                                                                                                         |
| D3   | fork 是 `forks` 表里的一行，不是 Space                     | fork 没有自己的 Node、成员、Issue 和 Trash。放进 `spaces`，每个接受 Space 的接口都要判断它是不是 fork                                                                                                  |
| D4   | fork 的状态不存储，由它未结束的 Worktree 推导              | 少一份要保持同步的状态。“合入后换一个 Worktree”因此不是一个操作，下一次写入发现没有未结束的 Worktree 就创建一个                                                                                        |
| D5   | 一个 fork 至多一个未结束的 Worktree，由唯一索引保证        | 两个并发的首次写入不会各建一个 Worktree                                                                                                                                                                |
| D6   | 没改过的文件直接读上游 Trunk，不记录 fork 的时刻           | 不存任何东西。基线取在第一次写入时，比 fork 的时刻离上游更近                                                                                                                                           |
| D7   | 过期只提示，不同步                                         | SDK 没有修改基线的接口。agent 重做一次的代价很低                                                                                                                                                       |
| D8   | HTML View 沿用现有草稿，其他 Blob 也用同一张草稿表 | 草稿已经有覆盖写、`base_etag` 和挂在 Worktree 上的能力，表里没有只属于 HTML 的列，所以其他 Blob 的替换复用它，不需要迁移 |
| D9   | 不建新的工具集。内容工具的 `worktree` 参数，以及只读的浏览、查找和查看工具的 `repo` 参数，接受 fork 的地址 | agent 不用学第二套工具。内容工具没有 `repo` 参数，它们用 `worktree` 或 `trunk` 指定读写的范围。写 Trunk 的工具不接受 fork 的地址，所以经 fork 没有写上游 Trunk 的路径。新增的只有创建、列出、查看和删除 fork |
| D10  | 第一版的提议只针对 Team Space                              | Personal Space 的所有者没有地方看到别人针对他的文件创建的 Worktree                                                                                                                                     |
| D11  | agent 能持有的最高角色，看仓库的所有者是人还是 agent       | `addTeamMember` 上限保护的是所有者的组织。在 agent 持有的仓库里，admin 能触及的只有这个仓库，它的所有者是 agent 和认领它的人。人想让 agent 管理一个仓库，做法是让 agent 创建并持有它，再认领这个 agent |

### 5.2 领域模型

```text
users (kind = agent) --< forks >-- spaces (type = team, the upstream)
                           |
                           | worktrees.fork_id   (at most one with processed_at IS NULL)
                           v
                       worktrees (kind = team, team_space_id = the upstream, creator = the fork owner)
                           |
                           +--< worktree_units    (source = trunk | worktree)
                           +--< html_view_drafts  (source_worktree_id)
```

新增一张表和一个列。其余都是现有的表。

`forks`：

| 列                  | 含义                                                  |
| ------------------- | ----------------------------------------------------- |
| `id`                | 主键                                                  |
| `owner_user_id`     | fork 的所有者。引用 `users`                           |
| `upstream_space_id` | 上游。引用 `spaces`，上游删除时级联删除               |
| `name`              | fork 在所有者名下的名字。`(owner_user_id, name)` 唯一 |
| `created_at`        | 创建时间                                              |

`worktrees.fork_id`：可空，引用 `forks`。fork 删除时置空，Worktree 的历史保留。

不变量：

| 编号 | 不变量                                                                                                              | 怎样保证                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| I1   | 属于 fork 的 Worktree 是 Team Worktree，它的 `team_space_id` 等于 fork 的上游，`creator_user_id` 等于 fork 的所有者 | `fork_id` 非空时要求 `kind = 'team'` 的 CHECK。其余两项在创建时由服务写入 |
| I2   | 一个 fork 至多一个未结束的 Worktree                                                                                 | `worktrees(fork_id)` 上的唯一索引，条件是 `processed_at IS NULL`          |
| I3   | fork 不拥有 Node、Resource、Unit 和 Blob                                                                            | 没有任何表引用 `forks`，除了 `worktrees.fork_id`                          |
| I4   | 处于 `ready` 而作者不能合入的 Worktree，可见性是 `space`                                                            | `markReady` 在作者不能合入时把可见性设为 `space`                          |
| I5   | Unit ID 在 Trunk、Worktree 和 fork 视图里相同                                                                       | SDK 的现有行为                                                            |

`processed_at` 是现有的列，标记 Worktree 已经 Merge 或 Discard。

产品数据库不保存快照、changeset 和修订。fork 也不保存。它们仍然只在 Collaboration 一侧。

### 5.3 状态

Worktree 的生命周期不变，由 SDK 持有。

```text
create -> draft --markReady--> ready --merge--> merging -> merged
            ^                    |
            +------ reopen ------+
draft or ready --discard--> discarded
```

合入的结果按项记录。Unit 的结果是 `merged`、`unchanged`、`removed`、`conflict` 或 `failed`。成功的 Unit 不会因为别的 Unit 冲突而回滚。HTML View 草稿的结果是 `published`、`conflicted` 或 `expired`。

fork 的状态由它未结束的 Worktree 推导：

| fork 的状态 | 条件                         | fork 视图                    | 写入                        |
| ----------- | ---------------------------- | ---------------------------- | --------------------------- |
| clean       | 没有未结束的 Worktree        | 等于上游 Trunk               | 先创建 Worktree，再写入     |
| drafting    | 未结束的 Worktree 是 `draft` | 上游 Trunk 叠加这个 Worktree | 写入这个 Worktree           |
| proposed    | 未结束的 Worktree 是 `ready` | 同上，内容冻结               | 拒绝。要继续修改，先 reopen |
| merging     | 未结束的 Worktree 在合入中   | 同上                         | 拒绝                        |

部分 Unit 冲突时，Worktree 回到 `ready`，已经成功的 Unit 留在上游。处理办法是 discard 这个 Worktree，在下一个 Worktree 里重做冲突的 Unit。

### 5.4 权限判定

判定只看四样东西：行为者是不是作者，是不是作者的认领人，在上游 Space 里的角色，以及对每个 Unit 的读权和编辑权。

两个基础条件沿用现有的计算：

- **能读全部 Unit。** 行为者对 Worktree 里每个未移除的 Unit 有 `openContent`。
- **能编辑全部 Unit。** 行为者对 Worktree 里每个 Unit 有 `editContent`。

“能合入”的定义改变：

|             | 定义                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| 阶段 2 之前 | 能编辑全部 Unit，并且是认领人，或者是角色为 owner、admin、editor 的作者                                       |
| 目标        | 能编辑全部 Unit，并且是作者或认领人，或者 Worktree 的可见性是 `space` 而行为者的角色是 owner、admin 或 editor |

阶段 2 已经按“目标”实现：`worktrees.service.ts` 里的 `mayMerge`、`mayPropose` 和 `capabilityRules`。下面能力表的“今天”一列是阶段 2 之前的行为。

Team Worktree 的各项能力：

| 能力                       | 今天                                                         | 目标                                        |
| -------------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| 创建 Team Worktree         | 角色不是 viewer（`createAtRoot`）                            | 任何 Space Member                           |
| `review`                   | 作者或认领人，或者可见性是 `space` 的成员。并且能读全部 Unit | 不变                                        |
| `editDraft`、`addUnit`     | `draft`，作者，能合入                                        | `draft`，作者，能读全部 Unit                |
| 把 Trunk 的 Unit 加进来    | 对这个 Resource 有 `editContent`                             | 对这个 Resource 有 `openContent`            |
| `markReady`                | `draft`，能合入                                              | `draft`，能合入，或者是能读全部 Unit 的作者 |
| `merge`                    | `ready`，能合入                                              | `ready`，能合入（新定义）                   |
| `reopen`、`discard`        | 作者或认领人，或者 owner、admin                              | 不变                                        |
| 标记移除一个 Trunk 的 Unit | 对这个 Node 有 `trash`                                       | 不变。viewer 因此不能提议删除文件           |

Trunk 一侧不需要改。Merge 把变更交给 Trunk 的协同服务，后者按合入者检查编辑权。这个检查是产品在 Trunk 服务上注册的 `requireChangesetAccess`，SDK 自己不检查合入者，阶段 0 已经在运行中确认。viewer 的提议由 editor 合入时，写入 Trunk 的身份是这个 editor。

agent 能持有的角色看仓库的所有者：

| 仓库的所有者 | agent                | 能持有的角色          |
| ------------ | -------------------- | --------------------- |
| 人           | 已认领               | viewer、editor        |
| 人           | 未认领               | 无                    |
| agent        | 创建这个仓库的 agent | owner                 |
| agent        | 其他已认领的 agent   | viewer、editor、admin |
| agent        | 未认领               | 无                    |

owner 不是 `space_members` 里的一行，它是 `spaces.owner_user_id`。现有的规则不允许把 owner 再加为成员。
认领不改变仓库的所有者。认领人通过 agent 获得 owner 的能力，`owner_user_id` 仍然是 agent。

上限（`ceilings.ts`）的改动：

| 上限                      | 今天                       | 目标                                                                                                                                                     | 阶段 |
| ------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `addTeamMember`           | 与目标一致                 | 只在三种情况下拒绝。成员是未认领的 agent。行为者是未认领的 agent。成员是 agent，要授予的角色是 admin，而仓库的所有者是人。上下文要加上角色和所有者的类别 | 2、3 |
| `createTeamSpace`         | 未认领的 agent 已持有 3 个 Team Space 时拒绝，返回 `AGENT_QUOTA_EXCEEDED` | 已认领的 agent 放行。未认领的 agent 在数量上限之内放行                                                                                                   | 3    |
| `updateSpace`（设为公开） | 只拒绝未认领的 agent。创建 Team Space 时也检查 | 已认领的 agent 放行                                                                                                                                      | 3    |
| `createFiles`             | 与目标一致                 | 数未认领 agent 持有的全部 Space 的文件                                                                                                                   | 3    |
| 新增：创建 fork           | 与目标一致。未认领的 agent 已持有 3 个 fork 时拒绝，返回 `AGENT_QUOTA_EXCEEDED` | 未认领的 agent 有数量上限                                                                                                                                | 4    |

`addTeamMember` 分两步改。阶段 2 放行人持有的仓库里的 viewer 和 editor。阶段 3 加上所有者的类别，放行 agent 持有的仓库里的 admin，并拒绝未认领的 agent 添加成员。

`writeLinkSharing` 和 `publishSpace` 只限制人的 token 会话，本文不改它们。

### 5.5 Fork 的读写路径

**读。** 给定 fork 和一个上游的 Resource：

1. 检查读者对这个 Resource 有上游的读权。没有就拒绝。
2. fork 有未结束的 Worktree，并且这个 Unit 在其中，就读 Worktree。
3. 否则读上游 Trunk。

目录列表是上游的目录，加上 Worktree 里新建的 Unit，减去标记为移除的 Unit。读者自己有一个挂在这个 Worktree 上、指向这个页面的 `pending` HTML View 草稿时，读草稿，否则读上游的 Blob。

client-core 的 `resolveReferencedRuntimeTarget` 已经按“在这个 Worktree 里就读 Worktree，否则读 Trunk”解析被引用的 Unit。

已知限制：这条规则要求宿主 Unit 本身在 Worktree 里。fork 没改过的 Unit 按 Trunk 读，所以它的跨 Unit 公式和嵌入也读 Trunk，即使被引用的 Unit 在 fork 里改过。要按 fork 的修改核对这样的 Unit，先把它加进 fork 的 Worktree（CLI 的 `unit add --worktree <fork>`，MCP 的 `unit_add`）。CLI 和 MCP 的文档写明了这一点。

**写。** 给定 fork 和一个 Unit：

1. 找到 fork 未结束的 Worktree。没有就创建一个 Team Worktree，`fork_id` 指向这个 fork。
2. Worktree 不是 `draft` 就拒绝，返回一个专门的错误码。
3. Unit 不在 Worktree 里就把它加进去。基线是此刻上游 Trunk 的修订。
4. 把变更提交给 Worktree。

每一步都从现有状态出发，重复执行得到同一个结果。第 1 步的并发由 I2 的唯一索引兜底，创建失败的一方重新读取。第 3 步由 `worktree_units` 的主键兜底。创建 Worktree 沿用现有的 Operation 和幂等键。

**一个 fork 一件事。** 并行的几件事是几个 fork。同一个所有者可以对同一个上游有多个 fork，名字不同。

### 5.6 过期

每个来自 Trunk 的 Worktree Unit 在视图里返回三样东西：基线修订，落后距离，加入时间。服务端据此给出一个标签。

| 标签    | 条件                         | agent 应该做什么                        |
| ------- | ---------------------------- | --------------------------------------- |
| current | 落后距离为零                 | 直接提议或合入                          |
| behind  | 落后距离大于零，没有超过阈值 | 标记 ready，在 merge preview 上重新验证 |
| stale   | 落后距离或年龄超过阈值       | discard，在新的 Worktree 里重做         |

stale 是提示，不拦截合入。两个阈值是服务端的常量：落后距离 100 个修订，年龄 7 天。推导见 [阶段 0 结果](phase-0-results.zh-CN.md) 7.1 节。

落后距离大于零时验证必须在 merge preview 上做，因为 OT 只保证变更能叠在一起，不保证结果正确。agent 按旧数据算出的合计可以没有冲突地合入，数字却是错的。

### 5.7 HTML View 和 Blob

HTML View 沿用 `html_view_drafts`。它满足覆盖写的规则：`replace` 草稿记下目标当时的 ETag，草稿可以挂在一个 Worktree 上，Worktree 合入后发布，目标的 ETag 变了只有这一页进入 `conflicted`，同一 Worktree 的 Sheet 照常合入，Worktree 被 discard 也进入 `conflicted`。

发布跟着合入权走。每次合入，包括 token 会话的合入，都在开始时固定挂着的 pending 草稿，把它们的 ID 存进 merge Operation，以合入者的身份发布这一组，重放和重试也只发布这一组，合入权因此包括页面：合入者要能写每份草稿的目标。人在 Browser 里合入时带上自己评审过的草稿 ID，和固定的一组不一致就得到 409 `PAGES_CHANGED`，什么都不改变，评审 N 就合入 N。Team Worktree 的作者在它的 Team Space 里提议页面，和提议 Unit 一样只要读权。草稿作者自己写不了目标时，页面代码要人看过才上线：这样的 Worktree 只能由人在 Browser 里带着评审过的草稿 ID 合入，CLI、PAT、OAuth 的合入，以及不带草稿 ID 的 Browser 合入，得到 409 `PAGE_REVIEW_REQUIRED`，什么都不改变。作者自己能写目标的草稿在任何合入中发布。每个 Worktree 最多挂 20 份 pending 草稿。

经 fork 改页面，就是把 HTML View 草稿挂在 fork 的 Worktree 上。草稿的 `source_worktree_id` 是这个 Worktree，所以草稿的预览和 dry run 按 fork 的范围读数据：在 Worktree 里的 Sheet 读 Worktree，其他读上游 Trunk。已发布的页面读 Trunk，合入之后 Trunk 里就是 fork 的修改。干净的 fork 只改页面时，`POST /api/forks/{forkId}/worktree` 打开 fork 的 Worktree。Collaboration SDK 能把没有 Unit 的 Worktree 标记 ready 并合入，这样的 pull request 合入时只发布页面。

草稿 7 天过期。提议等待超过 7 天，页面要由 agent 重新保存。

其他 Blob 也用 `html_view_drafts`，没有新表和迁移。`PUT /api/forks/{forkId}/blob-resources/{resourceId}/content` 带 `If-Match`、Idempotency-Key 和原始字节，像 Unit 写入一样打开 fork 的 Worktree，把新字节存成挂在这个 Worktree 上的 `replace` 草稿，上游在合入前不变。页面要走 HTML View 草稿，这个路由对 `.univer.html` 返回 403 `HTML_VIEW_DRAFT_REQUIRED`。文件草稿（视图里 `page` 为 false）和页面一起计数、一起列出，合入时按上面同一套规则发布：上游的 ETag 在草稿之后变了，这一份 `conflicted`，上游字节不变；作者自己写不了这个文件时，要人在 Browser 里带着评审过的草稿 ID 合入。Browser 的评审面板列出文件草稿的名称、大小和下载链接，不预览；内容路由把它作为附件返回。同一个 Idempotency-Key 在字节还没收完时再次请求得到 409，这个判断只看数据库里的行。只能替换已有的文件，fork 不新增文件。

### 5.8 接口

- HTTP contract 的来源是 `apps/workspace/contracts/http`。阶段 2 给 Worktree Unit 加上 5.6 的三个字段和标签。阶段 4 加上 fork 的创建、列出、读取和删除，以及经 fork 写入 Unit 的 `POST /api/forks/{forkId}/units`。阶段 5 加上为页面草稿打开 fork Worktree 的 `POST /api/forks/{forkId}/worktree`，以及经 fork 替换其他 Blob 的 `PUT /api/forks/{forkId}/blob-resources/{resourceId}/content`。
- MCP 和 CLI 不新建工具集。内容工具的 `worktree` 参数（CLI 的 `--worktree`）接受 fork 的地址，读走 5.5 的读路径，写走 5.5 的写路径。MCP 的 `space_browse`、`space_find`（CLI 的 `space browse`、`space find`）按 5.5 列出 fork 的目录，MCP 的 `repo_view` 显示 fork 的上游。其他指向仓库的参数只接受仓库，遇到 fork 的地址就报错，错误里给出上游和 pull request 编号。还没接 fork 的内容工具（如 `export`）同样报错，要求改用 fork 的 Worktree ID。新增的只有创建、列出、查看和删除 fork：MCP 的 `fork_create`、`fork_list`、`fork_view`、`fork_delete`，CLI 的 `uvw fork create|list|view|delete`。
- MCP 网关的说明文字由授予的 scope 和 `capabilities` 决定走哪个变体，不再按主体类别写死。

### 5.9 归属

本文的全部改动都在本仓库：产品模型、权限判定、上限、HTTP contract、MCP 和 CLI。

修订、OT、快照和 Worktree 的合同归 Collaboration SDK。下面五项本仓库不实现，第一版也不依赖它们。阶段 0 之后带着测量数据向上游提需求。

| 能力                                     | 没有它的代价                                                   |
| ---------------------------------------- | -------------------------------------------------------------- |
| 同步基线                                 | 过期只能重做                                                   |
| 把 Unit 拿出 Worktree，或者部分合入      | 一个 fork 只能是一件事。冲突的 Unit 要重做                     |
| 草稿快照                                 | Worktree 存在越久，加载越慢                                    |
| 删除和回收                               | Worktree 的数据只增不减                                        |
| 撤回一次合入                             | 尾部只能通过再提一个修正来纠错                                 |
| 合入的 OT 移出主线程，或分段让出事件循环 | 大的合入让整个服务停顿，约 4 µs × 草稿 changeset 数 × 落后距离 |

## 6. 分期与完成标准

依赖关系：阶段 0 最先。阶段 1、2、3 互不依赖。阶段 4 依赖阶段 2。阶段 5 依赖阶段 4。

每个阶段的完成标准都包含三条，下面不再重复：

- `pnpm verify` 通过。
- 改了 `apps/workspace/contracts/http` 时，`pnpm --filter @univerjs/univer-workspace api:verify` 通过，使用它的 server、Browser、CLI、MCP 工具、测试和文档在同一个改动里更新。
- 行为在真实应用里用 `verify-uvw` 走通，并留下记录。

### 6.1 阶段 0：测量和复核

不改任何行为。

交付：

- 按主体类别统计 `INTERACTIVE_SESSION_REQUIRED`、`AGENT_NOT_ALLOWED` 和网关 scope 错误的次数，用现有的 prom-client 计数器和 `mcp.tool_call` 事件，不加表。
- 一个可以重复运行的脚本，在隔离实例里测量 SDK。

完成标准：

| 编号 | 标准                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| A0.1 | 脚本给出落后距离为 0、10、100、1000 时合入的成功率、冲突率和耗时                                                                           |
| A0.2 | 脚本给出草稿变更数量为 10、100、1000 时 Worktree 的冷加载时间                                                                              |
| A0.3 | 脚本给出每个活跃 Worktree 占用的内存，以及草稿连接对 License 编辑连接配额的占用                                                            |
| A0.4 | 脚本逐条确认或推翻这些判断：加入是浅引用，基线不变，`ready` 冻结，合入后 Unit 冻结，部分冲突后 Worktree 回到 `ready`，非作者可以执行 Merge |
| A0.5 | 结果写进本目录的一份文档，给出 5.6 的两个阈值和每个主体同时未结束的 Worktree 数量上限                                                      |
| A0.6 | A0.4 有任何一条被推翻时，停下来修订本文，再开始阶段 2                                                                                      |

### 6.2 阶段 1：头部的授权在中途算数

交付：

- 授权里带 `worktree:merge` 时，网关的说明文字使用“验证后自己合入”的变体。这个变体今天只给 agent 主体。
- `pr_merge` 不再要求 `?toolsets=admin`。
- 分散在 Skill 和工具说明里的“先问用户”约束收到一处，由授权决定是否出现。
- CLI 会话可以续期，或者 CLI 可以用 PAT。

完成标准：

| 编号 | 标准                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------- |
| A1.1 | 人的 PAT 带 `worktree:merge`。agent 通过 MCP 创建 Worktree、修改、ready、合入，全程没有浏览器里的动作 |
| A1.2 | 人的 PAT 不带 `worktree:merge`。说明文字仍然把合入留给用户，`pr_merge` 返回 scope 错误                |
| A1.3 | CLI 会话在第 8 天仍然可用，不需要浏览器批准                                                           |

### 6.3 阶段 2：提议

这是整个方案的核心，改的是权限判定。它不需要数据库迁移。

交付：5.4 的“能合入”新定义和能力表，上限表里标为阶段 2 的部分，I4，5.6 的字段和标签，以及文档。

要更新的文档：`apps/workspace/CONTEXT.md` 里 Worktree 和 Team Worktree 的定义（它们写明只有作者或认领人合入），`apps/workspace/contracts/http/concepts.md`，`apps/workspace/docs/data-model.md`。

完成标准。设 S 是人持有的私有 Team Space，H 是 S 的 admin，A 是 H 以外的人认领的 agent，E 是 S 的 editor。

| 编号  | 标准                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A2.1  | H 把 A 加为 viewer 成功。把未认领的 agent 加为成员，或把 A 加为 admin，返回 `AGENT_NOT_ALLOWED`                                       |
| A2.2  | A 通过 MCP 在 S 里创建 Team Worktree，加入一个 Sheet，修改，ready。全程没有人的动作。读回 Trunk，内容没有变                           |
| A2.3  | A2.2 之后，这个 Worktree 的可见性是 `space`，`capabilities.merge` 对 A 是 false，A 调用合入返回 403                                   |
| A2.4  | E 在 S 的 pull request 列表里看到这个 Worktree，合入成功。Trunk 有这次修改。作者是 A，`mergedBy` 是 E                                 |
| A2.5  | A 的提议里包含一个新建的 Sheet。E 合入后，它出现在 S 里                                                                               |
| A2.6  | H 把 A 的角色改为 editor。A 创建、修改、ready、合入，全程没有人的动作                                                                 |
| A2.7  | A 是 viewer 时，直接写 Trunk 的每一条路径都被拒绝                                                                                     |
| A2.8  | 不是 S 成员的主体看不到这个 Worktree，也读不到其中的 Unit                                                                             |
| A2.9  | H discard A 的 Worktree 成功。之后永久删除它引用的文件成功，不再返回 `ACTIVE_WORKTREE_RESOURCE_REFERENCE`                             |
| A2.10 | Trunk 在 Unit 加入之后前进了 n 个修订。Worktree Unit 返回的落后距离是 n。超过阈值时标签是 stale                                       |
| A2.11 | 有一组测试覆盖 5.4 的整张能力表：六种行为者（作者、认领人、owner、admin、editor、viewer）乘以每项能力，在 SQLite 和 PostgreSQL 上都跑 |
| A2.12 | 今天能合入自己 Worktree 的每一种主体，改动之后仍然能合入。User Worktree 的行为不变                                                    |

不做：

- Personal Space 的文件上的提议。
- public-read 的非成员提议。
- viewer 提议删除文件。
- 一个 Worktree 有多个作者。

### 6.4 阶段 3：agent 持有仓库

交付：5.4 上限表里标为阶段 3 的部分，以及角色表里仓库所有者是 agent 的三行。

完成标准。设 A 是 C 认领的 agent，B 是别人认领的 agent，U 是未认领的 agent，P 是 C 以外的人。

| 编号 | 标准                                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| A3.1 | A 通过 MCP 创建 Team Space R。A 是 R 的 owner。A 在 R 里创建文件、合入，并把 R 设为公开。全程没有人的动作                                   |
| A3.2 | A 把 B 加为 R 的 admin 成功。B 在 R 上的 `capabilities` 和人作为 admin 时相同。A 把 P 加为 editor 成功                                      |
| A3.3 | 在人持有的 Team Space 里，把任何 agent 加为 admin 返回 `AGENT_NOT_ALLOWED`                                                                  |
| A3.4 | 把 U 加为 R 的成员返回 `AGENT_NOT_ALLOWED`。U 在自己创建的仓库里添加任何成员返回 `AGENT_NOT_ALLOWED`                                        |
| A3.5 | C 在自己的 Space 列表里看到 R，并且对 R 有 owner 的能力，包括管理成员、改可见性和 discard 别人的 Worktree。R 创建在认领之前或之后，结果相同 |
| A3.6 | A 被封禁后，R 被暂停，成员 B 读不到 R 的内容                                                                                                |
| A3.7 | U 创建 Team Space 的数量达到上限后，下一次创建返回 `AGENT_QUOTA_EXCEEDED`                                                                   |
| A3.8 | U 在它持有的全部 Space 里的文件合计超过 20 个时，创建返回 `AGENT_QUOTA_EXCEEDED`                                                            |
| A3.9 | U 不能把 Space 设为公开。U 过期后，它持有的 Team Space 和 Personal Space 一样被暂停                                                         |

不做：

- agent 在人持有的仓库里做 admin。
- 转移仓库的所有权。
- 未认领的 agent 互为成员。

### 6.5 阶段 4：fork

交付：5.2 的表、列和不变量，5.5 的读写路径，5.3 的状态，fork 的创建、列出、读取和删除，以及未认领 agent 的 fork 数量上限。

这个阶段有数据库迁移。迁移只增加表、列和索引，用 `verify-db-migration` 验证，SQLite 和 PostgreSQL 各一份。`apps/workspace/docs/data-model.md` 在同一个改动里更新。

完成标准。沿用阶段 2 的 H、A、E 和 S，A 是 S 的 viewer。

| 编号  | 标准                                                                                                                         |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| A4.1  | S 有 500 个文件。A 创建 fork 之后，产品数据库只多出 `forks` 的一行，Collaboration 数据库没有新增的行                         |
| A4.2  | A 通过 fork 的地址浏览，看到 S 的完整目录                                                                                    |
| A4.3  | E 修改了一个 A 没有碰过的文件。A 通过 fork 读到的是修改之后的内容                                                            |
| A4.4  | A 通过 fork 第一次写入一个 Unit。`worktree_units` 只多出一行，它的基线等于写入那一刻上游 Trunk 的修订。Unit ID 和上游相同    |
| A4.5  | 对同一个没有未结束 Worktree 的 fork 并发发起两次首次写入，结果只有一个未结束的 Worktree，两次写入都在其中                    |
| A4.6  | A 提议之后再通过 fork 写入，被拒绝并返回专门的错误码。A reopen 之后写入成功                                                  |
| A4.7  | E 合入之后，fork 没有未结束的 Worktree，A 通过 fork 读到的内容等于上游 Trunk。A 再次写入时得到一个新的 Worktree              |
| A4.8  | Worktree 里两个 Unit，一个能合入，一个冲突。合入之后前者在上游，后者不在。A discard 之后在新的 Worktree 里重做后者并合入成功 |
| A4.9  | H 移除 A 的成员资格。A 通过 fork 读写上游的任何文件都被拒绝                                                                  |
| A4.10 | A 删除 fork。上游没有变化，已经结束的 Worktree 的历史还在                                                                    |
| A4.11 | A 对 S 创建第二个名字不同的 fork。两个 fork 各有自己的 Worktree，互不影响                                                    |
| A4.12 | 上一个发布版本的数据库经过启动迁移后，结构和全新安装一致，已有的 Worktree 行为不变                                           |

不做：

- fork 自己的文件。agent 不打算提交的文件放在它自己的 Space 里。
- fork 的 fork。
- 在 fork 里修改 HTML View 和其他 Blob。它们属于阶段 5。

### 6.6 阶段 5：fork 里的 HTML View 和 Blob

- fork 视图读挂在 Worktree 上的 HTML View 草稿。已做到：MCP 的 `html_view_read` 带 `worktree`（Worktree ID 或 fork 地址）时，返回调用者挂在这个 pull request 上的这个页面的 pending 草稿，没有就返回上游页面。
- 页面运行时按 fork 的范围读数据。已做到，见 5.7。MCP 的 `html_view_save` 带 `worktree` 把草稿挂到 fork 的 Worktree，`dryRun` 按同样的范围取样。CLI 不存页面草稿：`html-view validate --worktree <fork>` 按 fork 的范围校验，`html-view create` 拒绝 fork。
- token 会话合入时，草稿的发布跟着合入权走。已做到，作者自己写不了目标的草稿仍要人在 Browser 里合入，见 5.7。
- 其他 Blob 的覆盖写。已做到，见 5.7。MCP 的 `blob_replace` 和 `blob_download`、CLI 的 `blob replace` 和 `blob download` 带 `worktree`（`--worktree`），只接受 fork 地址：替换存成 fork 的 pull request 上的文件草稿，下载返回调用者挂在这个 pull request 上的这个文件的 pending 草稿，没有就返回上游文件，ETag 都是上游的。

完成标准的骨架：A 在 fork 里修改一个 HTML View 和它绑定的 Sheet，提议。E 合入后页面发布，显示新的数据。上游的页面在草稿创建之后被别人改过时，这一项的结果是 `conflicted`，上游的页面不变，同一个 Worktree 里的 Sheet 照常合入。

### 6.7 阶段 6：任务和验收

只写范围，见 README 第 7、8 节。Issue 和 Worktree 的关联，验收页，Worktree 上的检查状态，仓库声明的不变量，检查通过后自动合入，按 agent 的预算。

### 6.8 第一版的完成标准

阶段 0 到 4 完成，并且下面三个故事在真实应用里各走通一次，留下记录。

**故事 1：上游只给读权。**
H 把 A 加为 S 的 viewer。A 创建 fork，修改三个 Sheet，新建一个 Doc，提议。E 打开 Worktree 评审，合入。
人的动作只有两次：加成员，合入。A 没有收到任何一次 `AGENT_NOT_ALLOWED` 或 `INTERACTIVE_SESSION_REQUIRED`。

**故事 2：上游允许 agent 自己合入。**
H 把 A 加为 S 的 editor。A 创建 fork，修改，验证，合入。
人的动作只有一次：加成员。

**故事 3：agent 持有的仓库里，agent 之间协作。**
A 和 B 是两个已认领的 agent。A 创建仓库 R，把 B 加为 viewer。B 创建 fork，修改，提议。A 评审，合入。
人的动作为零。

三个故事里，1.3 的前两项指标都有数字，并且和阶段 0 的基线放在一起对比。

已达到：三个故事在 `5e4dceb3` 上各走通一次，记录和指标见 [验收结果](acceptance-results.zh-CN.md)。

## 7. 通用约束

来自根 `AGENTS.md` 和 `apps/workspace/AGENTS.md`，每个阶段都适用。

- 产品数据和协同数据分开存储。产品数据库不保存快照、changeset 和修订。
- 没有事务跨越产品数据库、Collaboration Service 和 `BlobStore`。跨边界的写入通过持久化的 Operation、幂等和恢复收敛。
- 服务端从会话和产品数据推导用户、角色、Resource、Unit、Worktree 和已确认的修订，不接受客户端传入。
- 只通过已发布包的公开导出使用 Collaboration SDK。不在本仓库复制或包装它的合同。
- HTML View 始终读实时数据，不加快照、静态导出和内联的数据副本。
- 不手改生成的文件。改 contract 之后重新生成。
- 数据库改动先读 `apps/workspace/AGENTS.md`。`main` 随时可能被部署，所以迁移只增不删。
- 仓库职责、公开合同或数据分类有变化时，在同一个改动里更新 `DREAMNUM.md`。
- 文档只描述已经存在的东西。本文合入之后，每个阶段完成时把对应的“目标”改写成现状。

## 8. 背景文档的范围

[README](README.zh-CN.md) 是背景，不是规格。它保留现状和诊断（第 2、3 节），原则（第 4 节），SDK 的行为（6.2、6.3），fork 语义的图示（6.4），过期（6.5），风险（6.10），以及阶段 6 的背景（第 7、8 节）。

讨论中出现过、后来被本文推翻的做法，已经从 README 删除。实施时不要按它们做：

- 提议不是 agent 的 User Worktree，也不迁移 User Worktree 的私有约束。提议是上游仓库里的 Team Worktree（D1）。
- fork 不是 Space，没有自己的成员、分享设置和公开设置（D3）。
- 不按 Unit 单独授权。一个 Team Worktree 里的 Unit 都属于同一个 Space。
- 不为“上游收到的提议”新建查询，不改 Trash 的永久删除规则。
- 一个 Worktree 只有一个作者。几个 agent 不共同编辑同一个 Worktree。
- stale 只提示，没有年龄和落后距离的硬上限。
- 第一版（阶段 0 到 4）在 fork 里只能修改 Unit。HTML View 和其他 Blob 属于阶段 5。
- 不用“分支”或 branch 指 Worktree 或 Worktree Unit。

## 9. 评审时要定的，和实施前要确认的

### 9.1 本文已经按默认做法写下、需要评审确认的决定

1. **agent 能持有的角色看仓库的所有者。** 已经定下的有两条。在人持有的仓库里，已认领的 agent 可以是 viewer 或 editor，不能是 admin，未认领的 agent 不能成为成员。agent 创建的仓库由它持有，它在其中是 owner。本文在此之上加了两条默认做法。在 agent 持有的仓库里，其他已认领的 agent 也可以是 admin。未认领的 agent 不能添加成员，所以它持有的仓库里只有它自己。
2. **public-read 的非成员能否提议，由仓库的 `proposals` 设置决定。** 默认是 `members`，只有成员能提议，因为零成本的身份可以向公开仓库批量提议。owner 或 admin 可以改为 `accountable`，能读仓库的人和已认领的 agent 也能提议，或者改为 `anyone`，未认领的 agent 也能。设置只在仓库公开读取时生效。非成员提议者不会成为成员，只能写自己的提议，不能合入，在一个仓库里最多同时有 3 个未处理的提议，也看不到别人的提议。设置改回 `members` 或关闭公开读取后，它的草稿像被移出成员一样冻结，ready 的提议留给成员审阅、合入或放弃。
3. **第一版的提议只针对 Team Space。** Personal Space 的文件保持现状。
4. **viewer 不能提议删除文件。**
5. **stale 只提示，不拦截合入。**
6. **未认领的 agent 可以创建仓库和 fork，数量有上限。** 上限的数值在阶段 3 和阶段 4 开工时定。
7. **fork 的地址。** 默认是 `<所有者>/<name>`，和所有者的仓库共用命名空间，创建时在同一个事务里检查 `spaces` 和 `forks` 两张表。另一个选择是用一种不会和仓库地址冲突的形式，这样不需要跨表检查。
8. **改写 `CONTEXT.md` 里 Worktree 的定义。** 它今天写明只有作者或认领人合入。阶段 2 让上游的 editor 也能合入。
9. **`PRODUCT.md` 的第一条原则不改。** 阶段 2 到 4 不触及“每个改动在落地前被看见”。agent 持有 editor 是所有者主动的选择。

### 9.2 实施前要确认的假设

| 假设                                                                                           | 影响                                                                        | 在哪里确认           |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------- |
| 5.3 和 README 6.2 对 SDK 的全部判断                                                            | 整个 fork 的形态                                                            | A0.4，已确认         |
| 非作者执行 Merge 时，SDK 和 Trunk 的中间件都接受                                               | R5                                                                          | A0.4，已确认         |
| viewer 提交草稿变更时，协同网关除了 `editDraft` 和上游的 `openContent` 之外没有别的编辑权检查  | R4                                                                          | 阶段 2，不成立。Worktree 的 `commitChangeset` 中间件还按 Unit 级的 Edit 要求 `editContent`。阶段 2 把草稿里这一项改为 `openContent`，对象级的内容保护不变 |
| viewer 创建的新 Unit 在合入时由谁通过目标位置的校验，创建之后归谁                              | A2.5                                                                        | 阶段 2，已确认。加入时作者只需是成员并且目标存在。合入时按合入者校验（`validateAllTargets`，以及 `activateLocalUnit` 事务里的 `requireTarget`）。Node 的 `created_by` 是作者，它不带来任何权限 |
| `capabilities` 是否已经把 scope 和上限算进去                                                   | R6 要做多少                                                                 | 阶段 2，已确认没有。它只看用户、角色、可见性、状态和每个 Unit 的访问。scope 在 MCP 网关按工具执行，Worktree 模块不调用上限 |
| 在 Worktree 里，跨 Unit 的公式读另一个也在这个 Worktree 里的 Unit 时，读的是草稿还是 Trunk     | fork 里几个改过的 Sheet 互相引用时是否一致                                  | 阶段 0，已确认读草稿 |
| 现有工具带上 pull request 参数写入一个 Trunk 的 Unit 时，是否已经自动把它加进 Worktree         | 5.5 写路径的第 3 步是新增还是已有                                           | 阶段 4，已确认没有。写入不在 Worktree 里的 Unit 返回 `WORKSPACE_UNIT_NOT_FOUND`，第 3 步由 fork 的写入路由新增 |
| 认领人对 agent 持有的 Team Space 有 owner 的能力。agent 过期或被封禁时，这个 Team Space 被暂停 | R2d。规则按 Space 的所有者写，读代码推出                                    | 阶段 3，原来部分成立：Team Worktree 按 `team_owner_user_id` 判定 owner，认领人没有。阶段 3 改为 `ownsSpaceSql` 后成立 |
| Space 的所有权不能转移                                                                         | 5.4 的角色表假设仓库的所有者是人还是 agent 不会变。没有找到转移所有权的代码 | 阶段 3，已确认。没有代码修改 `spaces.owner_user_id`，认领也不改它 |
