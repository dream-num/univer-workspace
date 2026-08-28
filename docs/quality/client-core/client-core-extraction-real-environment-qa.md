# Client Core 真实环境补充 QA

日期：2026-08-28

分支：`refactor-cli-core`

对应最终产品树：`f90023ca61ed593993ce5e252329492542ed9aa8`

## 结论

真实环境补充 QA 通过，0 个产品 finding。此前 `environment-unavailable` 只表示验收时 `127.0.0.1:3020` 没有运行 Server；它没有代表真实环境已验证。本轮启动源码 Server，并让当前构建的 Workspace CLI 连接真实 HTTP、SQLite、Collaboration、Blob storage、worker、系统 Chrome 与 native runtime。

测试使用系统临时目录中的全新数据库、Blob 目录和 `UNIVER_HOME`。账号凭据只通过隐藏 TTY 输入；报告、源码、fixture 和仓库文件均未记录凭据或 Login Session。结束时 CLI 已 logout、daemon 已停止、Worktree 已 discarded、QA Node 已清理，整个临时目录随后移入系统 Trash，原路径已不存在。

## 环境

- Server：`http://127.0.0.1:3020`，从 `apps/workspace/server/src/main.ts` 启动。
- Product 与 Collaboration 数据库：两个独立的临时 SQLite 文件。
- Blob storage、CLI config、Session、cache、daemon socket 与所有输出：系统临时目录。
- Browser：系统 Google Chrome，由 `screenshot setup` 解析，没有下载浏览器。
- CLI：`apps/cli/dist/main.js`，连接上述 Server；安装包闭包仍由最终 fresh gate 的隔离安装 smoke 单独证明。

## 真实行为证据

| 切面 | 执行结果 |
| --- | --- |
| Auth | 临时 Server 注册测试 User；CLI 隐藏输入登录、`whoami`、`logout` 均成功；logout 后 `whoami` 按预期返回 `workspace-authentication-required`。 |
| Space / Node | Personal Space list 与空 root browse 成功；Group create、child create、rename、move to root、find、recursive browse 与 Trash 成功，read-back 与目标一致。 |
| Worktree / Unit / open | 创建 private User Worktree；创建 Sheet、Slide、Doc 与 Office-imported Sheet 类型的 Worktree-local Unit；list/get 与 review URL 成功；`ready → reopen → discard` 状态转换及 read-back 成功。 |
| Runtime target / reference | Worktree target 的 workbook 与 range inspection 成功；worker 从 Worktree revision 加载 Unit，后续操作继续使用相同 Worktree/Unit scope。 |
| Content runtime | `execute` 在 Sheet `A1` 写入测试值并提交 revision 2；随后 `inspect range` 从真实 Server 读回同一值。daemon status 可见，结束时正常 stop。 |
| Blob | 上传仓库内现有 Markdown 文件，metadata/read-back 为 ready；download 与源文件逐字节相同，输出权限为 `0600`。 |
| Asset / embedded image | SVG apply 中的 data-URL PNG 被 content workflow 外部化为 Worktree Asset；`asset download` 得到 68-byte PNG，SHA-256 与 Server metadata 一致，输出权限为 `0600`。 |
| Office exchange | 将真实 Worktree Sheet 导出为 XLSX，再把该 XLSX 导入同一 Worktree；导出文件非空，导入创建新的 Sheet Worktree-local Unit。 |
| Typst | 最小 bundle 经 native compiler 编译，0 diagnostic；materialize 后创建 Doc Worktree-local Unit，并输出 program 与 diagnostics 文件。 |
| Screenshot | `screenshot setup` 解析系统 Chrome；Sheet `A1` 生成非空 PNG；Slide 第 1 页生成非空 PNG。 |
| SVG | 使用 `univer-render-runtime` 真实字体测量编译 SVG，apply 提交 Slide revision；生成代码写入临时文件。 |
| Slide lint | 对已 apply 的 Slide 第 1 页运行三个 layout rule，coverage 包含目标页，0 finding。 |

## 清理与边界

- 所有普通 QA Group 与 Blob Node 均通过 CLI 移入临时实例的 Trash，root browse 的剩余 Node 数为 0。
- Worktree 最终状态为 `discarded`，未 merge 到 Trunk。
- CLI logout 后本地 Session 不再可用于认证；daemon stop 返回 `stopped`。
- Server 停止后，整个临时目录已移入系统 Trash，仓库与原临时路径均未保留数据库、Blob、Session 或输出。系统权限不允许本次进程访问 Trash 内容；永久删除需要由本机用户清空 Trash。
- 本轮没有测试 Team Space 权限、多人协作冲突、Worktree merge/Activation 或远程部署 TLS。这些行为不属于本次单账号 local profile smoke，也没有用本轮结果替代既有自动化、隔离安装和完整 package gate。

QA 脚本曾有两次参数读取错误：把 Node ID 字段读成 `.node.id`，以及使用 CLI 不接受的 `index:0`。修正为现有 JSON contract 的 `.node.nodeId` 与 1-based `index:1` 后对应真实命令通过；两次均未形成产品 finding。
