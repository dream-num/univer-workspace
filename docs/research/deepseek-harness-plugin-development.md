# DeepSeek Harness 插件构建研究

## 研究范围

- 日期：2026-08-27
- 目标：确认 `dsh-univer-work` 应如何作为可安装的 DeepSeek Harness 插件交付，并找出 Host、Web Client、Slot、配置和发布的真实接缝；2026-08-28 的首版边界已收敛为 Host-only local plugin，Web Client 结论只供后续 Change 使用。
- 源码：`/Users/shenweimin/github.com/deepseek-ai/deepseek-harness`
- 基线：`master`，commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
- Harness / CLI 版本：`0.1.1-rc.2`
- 复核：2026-08-28 再次检查官方 checkout，HEAD、分支与上述版本均未变化。
- 方法：只读检查本地源码、官方文档、内置 bundle 和 Web Client 插件。本文不包含实现或 OpenSpec 方案。

文中的源码路径均相对于上述 DeepSeek Harness checkout。

## 结论

1. `dsh-univer-work` 应作为可安装 bundle 交付，而不是要求用户修改 Harness 仓库。Host-only 首版只声明 `dsh.bundle` 并交付预构建 Host entry 与 patch；后续同一个 npm package 可以再声明 `dsh.client`，让 Web Client 注册表发现浏览器模块。
2. 首版只需要一个 package，包含 Host 插件、`cordis.patch.yml` 和构建产物。后续 tools、Skills 与重运行时仍进入同一个 package；当前没有证据支持拆成 service definition、provider、consumer 或多个 bundle。
3. 首版不提供 Web Client、Slot 或 overlay。若后续增加人机界面，优先把产品入口落在 additive Slot：用 `sidebar.footer.action` 打开 `shell.overlay`，避免替换 DSH 的 Workspace/Session 浏览器。
4. 不应占用 `sidebar.workspaces`。Harness 中的 Workspace 指本地项目与会话组织；Univer Workspace 指远端办公文档空间。名称相同，领域含义不同，而且该 Slot 是 `single`，替换后会移除现有 DSH 工作区浏览器。
5. Slot 只解决 UI 装配，不会把能力提供给模型。若要让模型读写表格或文档，需要在 Host 侧通过 `ctx.tools.register(defineTool(...))` 注册工具；工具必须声明参数和规范输出 schema，执行时遵守 `exec.signal`。耗时操作达到后台任务门槛后再使用 `ctx.jobs`。
6. 普通连接参数可以进入插件 `Config` 或 Settings namespace。API key 一类环境变量形状的秘密使用 `CredentialRef`；Workspace browser approval 返回的 Login Session cookie 属于插件拥有格式的 grant，应使用 `CredentialKey` 与 `ctx.authorization`。base profile 已装配 `credentials-local`，但 base/web 当前没有装配 authorization service；首个 Host-only shell 可以注入 `credentials` seam，后续认证 bundle 还要显式增加 authorization service row。Settings 只保存公开参数或引用/选择 id。
7. 外部 Client 插件不能假设自定义 `@Remote` 会自动出现在浏览器。当前 `api-remotes` 在构建时显式导入并挂载一组固定 contribution；外部插件的 Client→Host RPC 是后续设计前必须验证的接缝。
8. 该基线仍是 prerelease。插件应先精确对齐 `0.1.1-rc.2` 和当前 commit，不应提前承诺宽泛的 Harness 版本兼容性。
9. Harness 不会因为 npm package 中包含 `SKILL.md` 就自动注册随包 Skill。静态 Skill 应由 Host 插件声明 `inject = ['skills']` 并调用 `ctx.skills.register()`；只有确有远程发现或多个动态条目时才实现 `registerProvider()`。
10. Web profile 已组合本地 `ctx.subprocess` 与基于本地文件系统的 sandboxed `ctx.fs`。仅访问 Univer HTTP API 时不需要再引入本地执行能力；只有决定包装已安装 CLI 时才应依赖这两个 seam，并显式传递被子进程环境清洗规则移除的秘密。
11. 后续 Client Slot 贡献应使用 `ctx.slots.inject(name, callback)`，让条目等待 Slot 声明并随声明折叠/重建；直接 `register()` 不能处理声明尚未到达。当前 Client loader 的 unload 仍是 stub，因此安装、移除或 client manifest 变化以重启后状态为准。
12. 安装态 smoke 不能只测源码。Host-only 首版应从预构建 tarball 安装进隔离 profile，检查 bundle membership、dump 后的 Loader row、Host load/dispose 与启动；增加 Web Client 后再检查 `window.__DSH_BOOT__` entry 与 `/plugins/<id>/client.js`。官方 `dsh-loader-smoke` 是仓库测试支持层，不是外部插件可依赖的产品 API。

## 1. Harness 的插件与装配模型

Harness 以 Cordis 为插件容器。Host 功能、Web 服务、工具、Client runtime 与 UI 都通过插件装配，没有额外的“核心扩展 API”。profile 选择 bundle，bundle 的 patch 再插入 Cordis 配置行。配置层的顺序为 bundle patch、profile、home、命令行；后层 patch 会替换目标配置，而不是递归合并。

证据：

- `docs/architecture.zh.md:9-37`：Cordis、bundle、profile 与 `--dump-config`。
- `docs/user/develop/framework/index.zh.md:7-63`：fiber 依赖等待与 disposer 生命周期。
- `docs/user/develop/basic/publish.zh.md:112-128`：配置层顺序与 patch 替换语义。

一个函数式 Host 插件至少导出 `name` 和 `apply`。有配置时还应导出同名的 TypeScript `Config` 类型与 Schemastery `Config` schema；依赖通过 `inject` 声明。注册工具、服务、路由和 Slot 都属于 effect，插件卸载时应由作用域清理。异步 disposer 会按注册逆序开始、但可并发完成；存在先后依赖的清理必须放进同一个 `ctx.effect()` disposer 内串行等待。

证据：

- `docs/user/develop/basic/index.zh.md:15-27`
- `docs/user/develop/basic/index.zh.md:66-103`
- `docs/user/develop/basic/config.zh.md:7-45`
- `docs/user/develop/framework/index.zh.md:40-63,78-107`

## 2. 推荐的交付形态

### 2.1 一个可安装、可后续扩展为 mixed plugin 的 package

首版包承担 Host 与 bundle 交付；Skill 与 Web Client 属于后续可选职责：

| 职责 | Manifest / 文件 | Harness 行为 |
| --- | --- | --- |
| 可安装 bundle | `package.json` 的 `dsh.bundle.patch` | `dsh plugin add` 识别该包并把它加入 profile bundles |
| Host 插件 | `main` 指向构建后的 Node 入口 | `cordis.patch.yml` 中的 row 加载该入口 |
| Web Client 模块（后续） | `exports["./client"]` 与 `dsh.client` | `ClientModuleRegistry` 扫描已启用的 Loader row，生成浏览器 boot entry |
| 随包 Skill（后续） | 发布内容中的 Markdown/资源 + Host `ctx.skills.register()` | Host 显式注册后才进入分层 Skill registry；没有 package manifest 自动发现 |
| 发布内容 | `files` 包含 `lib/`、patch 和必要资源 | npm/tarball 安装后无需访问源码 |

`apps/cli/src/plugin.ts:30-45` 通过 `dsh.bundle` 判断一个依赖是否为 bundle；`packages/client/modules/src/index.ts:429-498` 则扫描已启用 Loader row 对应 package 的 `dsh.client`。因此同一 package 同时声明二者，就能沿两条独立链路被 Host 和 Client 发现。这个组合是源码推论，正式实现时应以安装态烟测确认。

最小目录可以保持为：

```text
package.json
cordis.patch.yml
src/index.ts
tsdown.config.ts
lib/index.js
```

只有出现独立发布节奏、多个 provider 或第三方 consumer 时才值得拆包。当前目标不具备这些条件。

### 2.2 后续 mixed plugin 装配链路

```text
dsh plugin --profile web add <package>
  -> profile.bundles 加入 package
  -> 读取 dsh.bundle.patch
  -> cordis.patch.yml 插入 package row
  -> Host 加载 main，执行 apply()
  -> ClientModuleRegistry 检查同一 row 的 package.json
  -> 解析 dsh.client + exports["./client"]
  -> 生成 window.__DSH_BOOT__
  -> 浏览器加载 lib/client.js
  -> Client apply() 向 Slot 注册 UI
```

Client 扫描规则见 `docs/subsystems/client-modules.zh.md:5-65` 和 `packages/client/modules/src/index.ts:125-219,429-564`。只有已启用的 Loader row 会进入扫描，单独发布 `./client` 并不会让模块自动出现。

### 2.3 patch 的约束

官方 bundle 示例要求 `cordis.patch.yml` 中 row 的 `name` 与 package 名一致。包名还会成为 Web boot entry 的 `id`，浏览器构建包装器也必须使用相同 module id。名称应在以下位置保持一致：

- npm package name
- `cordis.patch.yml` row name
- `dsh.client` 对应的 Client module id
- `window.__ModuleLoader__.load({ id })` 中的 id

官方最小 bundle 和安装流程见 `docs/user/develop/basic/publish.zh.md:9-110`。

## 3. Web Client 构建与依赖

Harness 浏览器不直接执行常规 ESM bundle。内置 Client 构建会产出 `window.__ModuleLoader__.load({ id, factory })` 包装器，运行时在 factory 内通过 `require(...)` 请求模块。仓库内部使用 `packages/client/tsdown.client.ts` 的 `clientBundle()` 生成该格式，但这个 preset 没有作为公共 package 发布。

证据：

- `packages/client/tsdown.client.ts:1-123`
- `packages/client/ui-workspace/lib/client.js:1`
- `docs/cookbook/adding-a-settings-card.zh.md:92-100`

外部插件因此需要在自己的构建配置中复现最小包装器，不能从源码路径导入 Harness monorepo 的私有 preset。实现前需要同时核对五类依赖：

| 层 | 含义 | 是否决定启动顺序 |
| --- | --- | --- |
| Client `export const inject` | Cordis Client 服务依赖 | 是，缺失时 fiber 等待 |
| `dsh.client.inject` | package 之间的说明性关系 | 否 |
| `dsh.client.external` | 请求加载非 baseline Client module | 影响模块图与到达顺序 |
| 构建产物中的 `require(...)` | 浏览器运行时真实请求 | 是，缺模块会加载失败 |
| npm dependencies / peerDependencies / devDependencies | 安装与构建依赖 | 不等于 Cordis 服务依赖 |

当前浏览器 baseline 包含 React、React JSX runtime、React DOM、Cordis、`ui-slots` 和 `ui-primitives`；Client runtime 自身会预加载。依据为 `packages/client/web/src/platform.ts:7-17`。非 baseline 模块必须按当前 `dsh.client.external` 语义声明，模块图会拓扑排序并拒绝循环，见 `packages/client/modules/src/index.ts:178-219`。

内置 `ui-workspace` 的真实产物请求了 runtime/client、ui-primitives、React 和 JSX runtime，可作为构建产物的最小对照，不应照抄其业务依赖。

## 4. Univer 客户端入口应使用哪些 Slot

Slot catalog 的生成文件 `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` 是当前基线的事实来源。

| Slot | 类型 | 对 dsh-univer-work 的判断 |
| --- | --- | --- |
| `sidebar.footer.action` | `list`、additive | 推荐作为 Univer 入口按钮，不接管现有 sidebar |
| `shell.overlay` | `list`、additive | 推荐承载后续工作台或全屏浮层，并处理 pointer-through 约束 |
| `settings.plugin.item` | keyed、additive | 适合按插件 namespace 提供连接设置卡片 |
| `settings.section` | `list`、additive | 需要独立设置页面时再使用 |
| `sidebar.workspaces` | `single` | 不推荐；已经由 DSH Workspace 浏览器占用，替换语义过重 |
| `conversation.hero.workspace` | `single` | 不推荐；已经承载 DSH Workspace picker |
| `sidebar` | `single` | 高风险；替换后连同内部 Workspace、Settings 席位一起消失 |

相关 catalog 位置：

- `settings.plugin.item`：`slot-catalog.ts:1396-1428`
- `settings.section`：`slot-catalog.ts:1477-1522`
- `shell.overlay`：`slot-catalog.ts:1551-1589`
- `sidebar`：`slot-catalog.ts:1592-1615`
- `sidebar.footer.action`：`slot-catalog.ts:1670-1712`
- `sidebar.workspaces`：`slot-catalog.ts:1741-1764`

内置 `@deepseek-ai/dsh-client-ui-workspace` 负责 DSH 的 Workspace picker、侧栏项目和会话浏览。它在 `packages/client/ui-workspace/src/client/index.ts:38-131` 通过 `slots.inject()` 注册 UI。其 `README.zh.md:5-19` 也把 Workspace 定义为 DSH 项目与会话上下文。Univer 的远端文档工作区不应复用这一名字对应的 Slot。

如果产品要求把 Univer 永久放进主内容区，当前 catalog 没有一个通用的 additive center-page Slot。此时需要在后续 proposal 中明确选择 overlay、独立 settings section，或承担替换现有单席位容器的成本，不能通过 Slot 名称猜测行为。

## 5. Host 能力、模型工具与后台任务

Client 入口只提供用户界面。模型请求只会看见 Host 侧通过 `ctx.tools` 注册的工具。若目标包括让模型查询 Univer Workspace、读取文档或修改表格，应让 Host service 持有连接与业务逻辑，再让工具调用该 service。Client 若也需要相同能力，应复用同一个 Host owner，而不是在浏览器和工具中复制协议实现。

工具的最小结构是 `ctx.tools.register(defineTool(...))`。`defineTool` 需要 `parameters`、`output.schema`、`output.render` 和 `execute`：参数在执行前校验，`execute` 返回符合 `output.schema` 的规范 JSON 值，`render` 再生成模型可见内容。工具应把 `exec.signal` 传给网络或其他可取消工作；schema 无法表达的非空、正数和跨字段约束仍由工具检查。只有导入、导出、渲染等操作确实超过同步请求窗口时，才改用 `ctx.jobs.start()` 并返回 `{ kind: "background", jobId }`。

证据：

- `docs/user/develop/basic/tool.zh.md:7-36`
- `docs/cookbook/adding-a-tool.zh.md:7-55`
- `packages/core/tools/src/schema.ts:482-617`
- `docs/subsystems/jobs.zh.md:24-60`

当前用户只确定“新的客户端入口”，因此工具与 Jobs 不属于首版自动范围。它们应由后续能力需求触发。

### 5.1 随包 Skills

`dsh.bundle` 和 `dsh.client` manifest 都不声明 Skill。Web/base profile 已加载 `ctx.skills`、filesystem provider 和面向模型的 `skill` consumer，但外部包内的任意 `SKILL.md` 不会因此被扫描。filesystem provider 只扫描项目、用户、custom 与显式 bundled roots。

一个固定、随 `dsh-univer-work` 版本发布的 Univer Skill，最小接法是让同一个 Host 插件声明 `inject = ['skills']`，读取随包 Markdown 后调用 `ctx.skills.register({ name, description, content, source, resourceBase? })`。该注册缺省同时允许模型和用户调用，并返回随 fiber 清理的 disposer。只有条目来自远程目录、需要异步发现或会动态增减时，才实现 `ctx.skills.registerProvider(control => ({ name, list, get }))`；远程初始化属于 `list()`，并应响应 lookup signal 和 registration control signal。

证据：

- `packages/bundle/base/cordis.patch.yml:237-248`
- `docs/subsystems/skills.zh.md:9-17,64-85,178-219`
- `packages/skill/skill/src/index.ts:95-120,385-459`
- `packages/skill/skill-filesystem/src/index.ts:45-89,129-143`
- `packages/skill/tool-skill/src/index.ts:24-26,71-161`

这意味着 package smoke 还应创建一次真实 agent Skill catalog 或直接从 Host registry 读取摘要，证明随包 Skill 是由插件注册成功，而不是只证明文件进入 tarball。

## 6. Settings 与 Credentials

插件有两种配置入口：

1. Cordis `Config`：适合 profile patch 或启动配置，支持 schema、默认值、校验和配置热更新。
2. Host Settings namespace：适合浏览器读写，使用 revision 防止覆盖并发修改。

公开的服务地址、默认 Workspace id 等可以是普通设置。Credentials 有两个不同键空间：

- `CredentialRef` 是 POSIX 环境变量名，适合 API key 等可从环境、托管 store 或 `.env` 解析的秘密。消费方按操作重新 `resolve()`，不得跨操作缓存；`describe()` 不返回秘密明文，环境变量覆盖的 ref 也可能不可写。
- `CredentialKey` 形如 `<owner-plugin>/<id>`，适合 OAuth、device flow 等由插件拥有 payload 格式的 grant。插件通过 `ctx.authorization.registerFlow()` 声明获取方式；flow 的 `run()` 必须在本次 attempt 内通过 `ctx.credentials.modifyRecord()` 提交记录，否则 `begin()` 以 `NOT_COMMITTED` 失败。每个 key 同时只允许一个 attempt，取消信号和 flow dispose 都会撤销它。

若未来增加独立的预置 token 认证，`CredentialRef` 足以承载该 secret。当前 Workspace CLI 的浏览器批准登录返回 Login Session cookie，因此 DSH 等价流程应使用 `CredentialKey + authorization flow`，并由 Client/Host 交互面调用 `begin()`；不能把 cookie 当普通 Settings 字段或模型 tool 参数保存。

当前 base profile 已装配 `@deepseek-ai/dsh-credentials-local`，并把它列为 base bundle 依赖；`dsh-univer-work` 的 Host-only shell 可以只声明 `inject = ['credentials']`，无需拥有或重复装配 credential provider。相反，base/web patch 与 bundle dependencies 当前都没有 `@deepseek-ai/dsh-authorization`。若后续 Change 加入浏览器批准登录，bundle 必须把该包作为依赖并插入一个 authorization service row，再让 credential owner 注册 flow；这属于后续认证 Change，不是首个 Host-only shell 的隐含基础设施。

证据：

- `docs/user/develop/basic/config.zh.md:7-100`
- `docs/subsystems/credentials.zh.md:5-50,60-180`
- `packages/credentials/credentials/README.zh.md:15-59`
- `packages/credentials/authorization/README.zh.md:5-46`
- `packages/credentials/authorization/src/index.ts:119-170,178-218,258-310,356-434`
- `packages/bundle/base/cordis.patch.yml:75-96`
- `packages/bundle/base/package.json:41-66`
- `packages/host/apiproxy/README.zh.md:61`

注册 Settings namespace 不会自动产生设置表单。插件若需要浏览器设置界面，必须同时发布 Client 卡片，并以同一个 namespace key 注册到 `settings.plugin.item`。官方的完整配对方式见 `docs/cookbook/adding-a-settings-card.zh.md:5-100`；运行时只显示 Host namespace 与 Client card 的交集，见 `packages/client/ui-settings-plugins/README.zh.md:5-25`。

首版如果可以接受 profile 配置，最省的路径是只实现 `Config`，暂不实现 Settings UI。需要用户在浏览器内修改连接信息时再增加 namespace、card 和 Credentials 选择器。

## 7. Client→Host 通信的边界

Harness 的类型化 Remote 由 `TypertRemoteService` 承载。内置贡献不是动态扫描出来的：`packages/api/remotes/src/client/index.ts:1-130` 在构建时显式导入固定 Remote contributions，再逐个调用 `ctx.remote.$mount()`。gateway 对 contribution 与 codec 做严格校验，见 `packages/api/gateway/src/client/index.ts:73-250`。

这带来一个直接约束：外部 mixed plugin 即使声明新的 `@Remote`，也不能假设 Web Client 会自动得到对应 namespace。可行路径可能包括：

- 外部包自带生成后的 contribution 与 codec，并在自己的 Client 插件中显式 `$mount()`；
- 复用 Harness 已有的公开 Host API；
- 在安全和同源策略允许时由浏览器直接访问 Univer 服务。

第一条是对现有装配代码的推论，不是官方外部插件模板；第三条还取决于 Univer 服务的 CORS 和认证模型。后续设计必须先做一个最小 Client→Host 往返验证，再决定数据面放在 Host 还是浏览器。不要先铺设一套自定义 RPC 框架。

### 7.1 Local filesystem / execution world

Harness 把文件系统与进程定义为同一个 execution world 的两项独立 service。`ctx.fs.resolve()` 产生稳定 target，传给进程或其他 OS 能力时应使用 `ctx.fs.processPath(target)`，不能把 opaque `targetKey` 当路径。`ctx.subprocess.resolveExecutable()` 与 `spawn()` 在同一 world 解析和执行命令；相对可执行路径包含分隔符时会拒绝。

默认 base/web composition 已挂载 `@deepseek-ai/dsh-subprocess-local` 与继承 `LocalFileSystem` 的 `@deepseek-ai/dsh-fs-sandbox`，所以 `dsh-univer-work` 不需要再提供一套 fs/subprocess provider。若 Host 直接复用 Workspace 的 HTTP/client-core 能力，则这两个 service 都不属于依赖。只有决定调用安装在本机的 `univer-workspace-cli` 时，Host 才声明 `inject = ['fs', 'subprocess']`，通过 `resolveExecutable()` 找 CLI，并为 `spawn()` 显式给出 argv、cwd、stdio、grace、signal 与所需 env。

本地 subprocess 会从继承环境删除名称含 `KEY`、`PASSWORD`、`SECRET`、`TOKEN` 的变量以及全部 `DSH_*`，再合并 spec 的显式 `env`。这可以防止 Harness secret 隐式泄漏，也意味着包装 CLI 时不能假设 token 自动继承。对只需远端 HTTP 的插件，进程包装比进程内 client 多一层认证转交与生命周期，当前没有采用它的必要证据。

证据：

- `packages/fs/fs/src/index.ts:1-8,80-135`
- `packages/fs/fs-sandbox/src/index.ts:1-28,51-70`
- `packages/subprocess/subprocess/src/index.ts:37-66,74-140`
- `packages/subprocess/subprocess-local/src/index.ts:30-59,79-135,146-183`
- `packages/bundle/base/cordis.patch.yml:81-86,163-176,441-445`

## 8. 本地开发、安装与发布

### 8.1 源码联调

Harness 支持 `--patch <absolute-source-path>` 临时加载本地源码，适合在目标 checkout 中验证 Host 插件。patch 不会改变 Node module resolution 的基准目录，因此外部包依赖仍应从自身 package 安装。依据为 `docs/user/develop/basic/index.zh.md:46-64`。

### 8.2 安装态验证

可安装插件必须从预构建 tarball 走一次真实 profile 装配，而不是把源码 checkout 当最终证明：

```sh
pnpm pack
DSH_HOME=<isolated-home> dsh plugin --profile web add ./dsh-univer-work-<version>.tgz
DSH_HOME=<isolated-home> dsh --profile web --dump-config
DSH_HOME=<isolated-home> dsh --profile web
```

`dsh plugin` 使用 pnpm 安装依赖并重新计算 profile bundles；相对路径以执行命令时的当前目录为基准。bundle membership 改变后需要重启 Host。Host-only smoke 至少断言：profile manifest 的 `dsh.profile.bundles` 包含本包、dump 中出现本包 layer 与 Loader row、Host 能 load/dispose 并启动。增加 Web Client 后，再断言 HTML 的 `window.__DSH_BOOT__` 包含本包 id、`GET /plugins/<id>/client.js` 返回构建产物而非 404，并在浏览器中观察目标 Slot 条目。

官方 `@deepseek-ai/dsh-loader-smoke` 的 `lib` mode 用 plain Node 和 package exports 模拟 installed consumer，可借鉴隔离 cwd/DSH_HOME、截止时间和完整 stdout/stderr 诊断的做法；其 README 明确标注它是测试支持基础设施而非产品 API，外部插件不能把它加入运行时或测试依赖。实现依据为 `apps/cli/src/plugin.ts:47-157`、`apps/cli/reference/README.zh.md:41-63`、`docs/subsystems/client-modules.zh.md:5-11,55-65`、`packages/test-support/loader-smoke/README.zh.md:5-11` 和 `packages/test-support/loader-smoke/src/index.ts:94-121,124-211`。

### 8.3 dispose 与 Slot 声明生命周期

Host 与 Client 的 `ctx` 注册都归各自 Cordis fiber。工具、Skill、authorization flow、事件监听和自定义 effect 会在 fiber dispose 时撤销；对 Web Slot，贡献方应使用：

```ts
ctx.slots.inject('sidebar.footer.action', () =>
  ctx.slots.register({ name: 'sidebar.footer.action', id: 'dsh-univer-work' }, UniverAction))
```

`slots.inject()` 在 Slot 尚未声明时等待，声明到达时同步注册，声明折叠时 dispose，重新声明时重跑；贡献方 fiber 卸载也会取消等待或移除条目。直接 `slots.register()` 到尚未声明的 Slot 会抛错。内置 Workspace Client 采用同一模式，并测试 `fiber.dispose()` 后全部条目消失。

当前 Client runtime 仍记录 `loader.unload` 为未实现，且 client package metadata（包括“不是 client package”的否定结论）会缓存到进程退出。因此不能把“运行中安装/移除 npm package 后立即卸载浏览器模块”写入首版合同；安装态测试应在全新 Host 进程中执行。

证据：

- `docs/user/develop/framework/index.zh.md:26-63,78-107`
- `packages/client/runtime/README.zh.md:11-17,93-97`
- `packages/client/ui-workspace/src/client/index.ts:38-57,111-131`
- `packages/client/ui-workspace/tests/apply.client.spec.ts:57-78,159-168`
- `docs/subsystems/client-modules.zh.md:55-65`

### 8.4 发布选择

| 来源 | 要求 | 初期判断 |
| --- | --- | --- |
| npm / 预构建 tarball | 包中包含 `lib/` | 最简单，安装时不需要构建授权 |
| GitHub source | package 必须有自包含 `prepare` | pnpm 还要求 `allowBuilds`，应固定 commit SHA |

官方约束见 `docs/user/develop/basic/publish.zh.md:153-178`。对首版而言，预构建 npm package 或 tarball 比安装时编译更少出错。若项目明确要求直接从 GitHub 安装，再补齐 `prepare` 和允许构建的安装说明。

## 9. 实现前后的最小验证清单

实现 Host-only 首版前：

- 确认目标 Harness 仍为 `0.1.1-rc.2` 或重新研究差异。
- 记录后续 Client Core connection 与 credential resolver 由 Host plugin 持有；首个 shell 不实现认证或 authorization flow。

实现后：

- typecheck、单元测试和 build 全部通过。
- 运行 `npm pack --dry-run`，确认 patch 与 Host 产物进入包。
- 从生成的 tarball 用隔离 `DSH_HOME` 执行真实 `dsh plugin add` 和 `dsh --dump-config`。
- 通过真实 DSH composition 验证 Host load/dispose，且异步清理在 dispose 返回前完成。

内置生命周期测试可参考 `packages/client/ui-workspace/tests/apply.client.spec.ts:57-78,159-168`，但最终验收必须覆盖安装后的组合路径，因为 bundle、Client 扫描和 Slot 分属不同运行阶段。

## 10. 尚未解决的问题

1. 后续 Web Client 应使用 overlay 工作台，还是替换 Harness 主内容区。当前 Slot 能支持前者，后者需要明确所有权迁移。
2. 首版已确定直接消费同仓 private `@univerjs/univer-workspace-client-core`，不调用 CLI 进程，也不导入 `apps/cli/src/*`。
3. 若后续增加 Web Client，外部插件能否以稳定方式自带 Typert Remote contribution，需要最小原型验证。
4. 首个 Host-only shell 可注入 base 已装配的 `credentials` seam，但不读取或创建 Login Session；后续浏览器批准登录需要另一个 Change 装配 authorization service，并确定 Univer grant 的 `CredentialKey` payload 与 owner。
5. `0.1.1-rc.2` 之后的 `dsh.client` manifest、Slot catalog 和 Settings API 可能变化。升级 Harness 时应重新生成兼容性结论。

## 对后续工作的约束

后续 proposal 应先收敛到一个 intent：交付可安装、可加载、可卸载的 Host-only local `dsh-univer-work` package，建立对 `@univerjs/univer-workspace-client-core` package exports 的构建边界，并记录后续 credential-backed Workspace connection 由 Host plugin 持有。Credentials/authorization、Skills、Web Client、Slot、Settings UI、业务 tools、Jobs、自定义 Remote 与 CLI 子进程包装不进入首个 Change。
