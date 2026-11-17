# Workspace 存储迁移与恢复

[English](storage-migration.md) | 简体中文

## 从 SQLite 和本地目录迁移到 PostgreSQL 和 S3

在一个停机窗口内完成 **SQLite + 本地目录 → PostgreSQL + S3**。源产品库必须为 V24。如果版本较旧，先按 [SQLite 升级步骤](#sqlite-升级与恢复)升至 V24，停掉升级后的实例再切换。先准备专用的空 PostgreSQL 数据库、私有桶和空前缀。目标配置、凭据和桶权限见 [Workspace 配置指南](configuration.zh-CN.md#部署组合)。

使用阿里云 OSS 区域 Endpoint 时，目标桶须从未开启版本控制。迁移命令读取桶的版本控制状态（`oss:GetBucketVersioning`），然后对普通上传和分片完成请求使用 OSS 的禁止覆盖请求头。

1. 停止所有 Workspace 写入实例，保留同一时间点的两个 SQLite 数据库（包括仍存在的 WAL 或 journal）和文件目录备份。验收前保持用户流量关闭。
2. 为迁移进程设置目标 PostgreSQL + S3 环境变量。用 `DATABASE_FILE`、`COLLABORATION_DATABASE_FILE` 和 `BLOB_DIRECTORY` 指向现有源数据。默认路径见[数据库和文件存储配置](configuration.zh-CN.md#数据库)。源目录可以只读挂载。为临时目录预留两个 SQLite 副本所需的空间；协同库需要升级时，还需容纳其暂存文件和备份。
3. 使用已安装依赖的源码部署时，在仓库根目录执行以下命令。脚本读取 Workspace 的 `.env`。

   ```bash
   cd apps/workspace
   node --env-file-if-exists=.env --import tsx server/src/storage-migration/main.ts
   ```

   使用 Workspace 镜像时，从同一镜像运行一次性容器。下面的 `workspace.env` 使用目标数据库和 S3 的配置；源数据卷挂在默认路径。使用与目标部署相同的网络和凭据。

   ```bash
   docker run --rm --network workspace --env-file ./workspace.env \
     -v univer-workspace-data:/app/univer-workspace/.data:ro \
     univer-workspace node dist/server/storage-migration/main.js
   ```

4. 等待命令成功退出并打印提交行数。用目标配置启动一个实例，通过 HTTP 登录原账号，核对已有文档、Worktree、历史、评论和附件，核对已有电子表格的单元格值，编辑文档并上传一个文件。重启实例，回读单元格、编辑和上传结果后再开放流量。

命令在私有临时副本上读取 V24 产品数据、准备协同库，原库及日志文件保持只读。它按原对象键复制本地文件并从 S3 回读校验 SHA-256，并将 Sheet 数据块复制到 `sheet-blocks/` 子目录，逐块回读比对 MessagePack 字节。产品库、四个协同组件、块索引及各修订快照的块引用在一个 PostgreSQL 事务中提交。Worktree 内新建的 Unit 在 SQLite 中的基线占位值 `1` 会转换为 PostgreSQL 的 `NULL`，主线派生的 Unit 保留真实基线。草稿修订号、初始快照和合并数据一并保留。

**中断与回退。** 失败时保持源实例停写。目标可能已有空表和部分 S3 对象，数据库导入事务会整体回滚。修复原因后用相同源数据和目标重跑；命令校验并复用内容一致的对象，遇到不匹配对象、无关对象或非空目标业务表会报错。包含目标 SDK 无法保存的旧协同资源数据也会报错。若连接在提交时中断，先检查目标数据再决定恢复服务或重试。恢复流量前可以停止目标实例，恢复原配置并启动源实例；恢复流量后回退需要另行迁回新增数据。

### 容量与进度

临时盘要能容纳两个 SQLite 副本、日志文件及协同库升级所需的暂存文件和备份。PostgreSQL 需要为导入的表、索引和事务 WAL 预留空间。脚本逐行读取 SQLite，每行向 PostgreSQL 发一次写入请求并核对返回值。普通文件按流读取，缺失对象上传后会从 S3 全量回读。对象键清单和文件校验记录的内存占用随对象数增长，单个最大 Sheet 块或数据库行也要能放入内存。估算停机窗口时，使用有代表性的备份、实际网络和空目标先演练一次。

脚本打印当前阶段和表名。复制和导入时，每隔约十秒在完成下一项后报告已校验文件数、Sheet 块数、字节数或已暂存行数。最终以 PostgreSQL 提交结果为准。

| 退出码 | 含义与操作 |
| --- | --- |
| 0 | `Migration committed` 给出已提交的行数及已校验的对象数。可以启动一个实例做 HTTP 验收。 |
| 1 | 本轮没有提交数据库导入。按阶段和错误排查，保持源端停写；已校验的 S3 对象可以复用。 |
| 2 | 未收到确定的提交结果。重跑或恢复流量前，先核对 PostgreSQL 目标库。 |
| 3 | 数据库已经提交，清理资源时出错。保留目标数据，排查清理错误。 |

进程被强杀或容器消失且没有最终状态时，也要先检查目标库再决定是否重跑。

## SQLite 升级与恢复

保留 SQLite 的部署由服务启动时升级。当前产品库版本为 V24，支持从 V0 至 V23 自动升级。

1. 停止所有 Workspace 写入实例，备份同一时间点的产品库、协同库和本地文件目录，保留 SQLite 的 WAL 和 journal 文件。容器运行期间避免从宿主机打开数据库。Kubernetes 升级期间使用单副本和 `Recreate` 策略。
2. 启动一个新实例。为升级前备份、协同库暂存副本和临时组件备份预留空间。服务先升级产品库，再检查协同库的组件版本。需要升级协同库时，服务获取排他锁并在原库旁创建 `<collaboration-file>.pre-sdk-migration-<timestamp>-<uuid>.bak`，暂存副本通过结构、外键和完整性检查后才替换原库。
3. 确认启动成功，通过 HTTP 核对文档和 Worktree，再恢复流量。保留备份直到验收完成。需要回退时，停止新实例，恢复同一批次的产品库、协同库和文件，再启动旧版本。

各版本的结构变化和历史数据映射见[数据模型](data-model.md#一次性自动迁移边界)。
