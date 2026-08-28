## Context

目标基线 `univer-workspace@081a8e7f30141b3d1dbb4a2200db426b56bfdb28` 中，`apps/cli/src/features/screenshot/screenshot.ts` 同时拥有 runtime target lookup、UnitData export、formula/Embed resource parsing、Worktree Asset rewrite、browser capture 和 PNG 写入。`features/lint/unit-layout-lint.ts` 复用 screenshot loader，并单独创建 browser runtime。`apps/cli/render-runtime` 装配 `@univer-cli/univer-render-page`，CLI build 与 artifact scripts负责生成、复制和校验这份页面。

本 Change 按既定顺序在 Changes 1–8 后实施。它直接复用 Change 4 的 Asset content resolver、Change 5 的 target/reference operations 和 Change 6 的 UnitData export operation。Changes 1–3 是传递前置，Office 与 Typst owners 只是 ordered predecessors。`apps/cli/src/features/svg/command.ts` 仍使用同一 render page 做真实字体测量，直到第 10 个 Change 迁移 SVG。

## Goals / Non-Goals

**Goals:**

- 让 Client Core 成为 Workspace render Unit assembly、browser screenshot、Slide layout lint 与 render page source 的唯一 owner。
- 让 CLI 只保留 Commander、browser setup、license/config 解析和 installable artifact delivery，同时保持 observable behavior。
- 让未来 local DSH Client Shell 能直接组合相同 owner、本机输出路径和自己的 artifact assets。
- 保持 reference/Asset 规则、每次操作的 browser close、PNG exclusive write 和 Puppeteer/render-page package gate。

**Non-Goals:**

- 不建立 renderer registry、browser pool、filesystem provider或多实现 factory。
- 不迁移 SVG compile/text measure/apply，不改变临时 SVG consumer 的 render-page path。
- 不合并 Change 4 的下载文件状态机与 screenshot PNG helper；两者覆盖、metadata 和结果合同不同。
- 不增加 screenshot 格式、force overwrite、lint rules、browser cache、并行策略或 cancellation seam。

## Diagram design

```text
Workspace CLI shell
  ├── Commander / browser setup / license
  └── render-page path + Core operations
                    │
                    ▼
private Workspace Client Core
  ├── target + UnitData + reference/Asset render loader
  ├── browser screenshot + Slide layout lint
  └── render page source + safe PNG write
                    │
                    ▼
        packaged browser + render page

future local DSH shell ────────┘
```

## Decisions

### 1. 在现有 Client Core 中增加一个 screenshot/lint owner

`@univerjs/univer-workspace-client-core` 增加 manifest-declared screenshot/lint exports，并迁入现有 Workspace render loader、capture、output 和 lint workflow。不创建 render package或通用runtime service；这些能力共享一份 render input、一个 SDK baseline 和相同两个 Node-hosted consumers。

owner直接组合 `@univer-cli/unit-screenshot`、`@univer-cli/unit-layout-lint` 与 `@univer-cli/univer-render-runtime` 的公开能力。保留当前窄的 runtime constructor substitution用于behavior tests，不增加interface、factory hierarchy或dependency container。

### 2. 直接复用 Asset、target/reference 与 UnitData export prerequisites

render loader通过Change 5的target resolution与reference scope operations选择Host和referenced Units，通过Change 6的结构化UnitData export operation读取选定revision，并通过Change 4的Asset content operation解析Worktree图片。它不导入CLI `WorkspaceContentSource`、daemon client或RPC `JsonValue`。

CLI composition把现有`runtime.export-unit-data` daemon request适配为Core operation；未来local DSH Client Shell可以直接传入content runtime owner method。apply时若任一 prerequisite public operation缺失，停止并修正前序Change，不创建第二套target、reference、Asset或runtime owner。

### 3. render Unit assembly 与现有资源语义整体迁移

Host导出后继续解析`UNIVER_EXTERNAL_REFERENCE_PLUGIN`与`UNIVER_EMBED_RESOURCE_PLUGIN`。formula Unit IDs去重并排序，跳过Host自身，只接受Sheet/Base；active Embed child去重，排除Host及formula重复，忽略soft-deleted descriptor。Resource JSON、source Unit identity、ResourceRef与loaded Unit identity/type继续执行当前严格校验和错误码。

Trunk Host返回装配后的render Unit，不解析Workspace Asset。Worktree Host把Host、formula references和Embed children交给`resolveUnitScreenshotImageAssets`，Asset resolver绑定同一Worktree，并只修改render copy。上传或源数据写入不属于此路径。

### 4. browser runtime 接受显式 Shell inputs并按操作关闭

Core operation接收明确的`renderPageRoot`、license、browser environment与可选AbortSignal，并在每次capture或lint调用时创建一个`createUniverRenderRuntime`实例。`finally`始终等待close；不引入跨调用pool、全局singleton或新的browser ownership model。

CLI继续用`resolveUniverLicense(env)`决定bundled/override license，用upstream command dependencies提供browser install/probe/resolve，并把原`env`与packaged render-page path传给Core。Core不读取CLI config、license module或process-global path。保留上游runtime对字体、图片、Puppeteer executable和signal的现有处理，不重新实现浏览器协议。

### 5. render page source 归 Core，installable asset 归各 Client Shell

当前`apps/cli/render-runtime`页面移动到`packages/client-core`，继续挂载同一个preset Univer、要求`#app`和license bootstrap，并保持1600×1000容器、relative Vite base与无sourcemap构建。Client Core build生成一份稳定的render-page目录；它不提供猜测consumer安装布局的runtime path resolver。

CLI build/package显式从Client Core build产物复制页面到既有`dist/render-runtime`，所以`main.ts`的路径和第10个Change前的SVG consumer无需改变。未来另一个installable Client Shell同样复制该资产并显式传入自己的路径。这把实现owner与artifact布局分开，又不发布private Core。

### 6. PNG writer 原样迁移，不借用 Blob/Asset download abstraction

screenshot output继续以calling process cwd解析默认`screenshots`或显式目录，递归创建目录，逐项拒绝含path component、`.`和`..`的name，并在写入前检查已有outputs。每张图片先写同目录`0600` exclusive temp file，再hard-link到不存在的destination，最后清理temp；并发出现destination时保留竞争方文件。

当前多图片写入不是事务：后续图片失败不会删除已经提交的前序图片。本 Change保留该行为，不增加rollback或`--force`。Change 4的download helper要求remote metadata、stream byte count和可选replacement，复用它会改变screenshot contract，因此不合并。

### 7. Slide lint 复用同一 loader与browser owner

layout lint继续先通过共享loader得到render Unit，再在启动browser前拒绝非Slide类型。它把Slide UnitData与formula references交给`createUnitLayoutLint`，返回target-neutral findings，并在success/failure后关闭runtime。

CLI command仍由`@univer-cli/unit-layout-lint-command`拥有arguments、JSON/text presentation，并强制`--worktree`。Core不新增Trunk lint命令语义；它只拥有framework-neutral Slide input与operation。

### 8. 核心测试迁入 package，Shell 和 artifact tests保留

`workspace-screenshot.test.ts`中的Host/reference/Embed/Asset assembly、capture close与PNG safety cases，以及`workspace-unit-layout-lint.test.ts`中的Slide gate/runtime close cases迁入Client Core。补齐现有直接覆盖不足的malformed resource、unsafe basename、destination race和runtime failure close cases，但不复制Commander harness。

CLI保留screenshot/lint scope/options、browser setup、license override、presentation与built entrypoint cases。package workflow继续externalize `puppeteer-core`与`@puppeteer/browsers`；owner解析必须来自Client Core声明的render runtime dependency，不能依赖pnpm偶然hoist。verify与installed smoke检查copied render page、browser dependency closure和arbitrary-cwd startup。

## Risks / Trade-offs

- **前序 Changes 的 operations 名称与计划不同** -> apply首步读取真实exports并直接适配；缺失时停止，不建立平行owner。
- **移动render page使SVG真实字体测量失去资产** -> CLI保持原`dist/render-runtime`位置并运行现有SVG tests；第10个Change再迁移SVG owner。
- **license或browser environment误入Core全局状态** -> 只用operation/owner初始化的显式值，Core不导入CLI config或license module。
- **reference解析迁移改变顺序或Asset请求** -> 将现有fixtures和exact call assertions随owner迁移，并补充malformed与self/dedup cases。
- **browser failure泄漏进程** -> success、failure与aborted cases都断言`close()`完成；不引入pool。
- **private package资产未进入CLI tarball** -> dependency-first build、artifact verify与安装smoke直接检查`dist/render-runtime/index.html`和assets目录。

## Migration Plan

1. 确认Changes 4、5、6已完成，并记录Asset content、target/reference与UnitData export的真实public names。
2. 在Client Core中迁移render Unit loader、screenshot/lint owner与核心tests。
3. 移动render page source并让Client Core build生成唯一页面资产。
4. 将CLI screenshot/lint composition切到package exports，保留commands、browser setup、license解析与daemon adapter。
5. 调整CLI build/package复制Core render page，保留SVG临时consumer和Puppeteer external dependencies，删除无调用方的CLI implementation。
6. 执行Client Core、CLI、SVG regression、workspace与实际安装artifact compatibility gate。

没有持久化数据、Session或远程state迁移。失败时可以整体恢复CLI feature/render-page owner与imports；截图输出和Workspace Unit无需转换。

## Open Questions

无。会改变行为、实现路径或task breakdown的决定均已由既定边界和本Change设计确定。
