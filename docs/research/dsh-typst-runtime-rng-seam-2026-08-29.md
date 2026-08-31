# Typst Doc materialization 的 runtime RNG seam 调查

## 研究范围

- 日期：2026-08-29
- 问题：精确发布版 `@univerjs/core@1.0.0-beta.2` 与 `@univer-cli/headless-univer@1.0.0-beta.2` 是否提供受支持的、per-runtime RNG/ID 注入，使真实 Doc Facade materialization 在不修改 Host `Math`/`crypto` 的条件下可重复。
- 证据限制：只使用 npm 官方 registry 元数据与 tarball、DreamNum 官方 GitHub source/tag/release、当前安装的精确 package manifest/public types/发布 bundle，以及本机官方 checkout 中能与发布版对应的 commit。未使用二手资料。
- 本文只给出可行性与上游 API 建议，不修改实现或 OpenSpec。

## 截至 2026-08-29 的发布状态复核

不存在 beta.2 之后可安装的、同时包含 `@univerjs/core` 与 `@univer-cli/headless-univer` 的精确单一 SDK release。npm 官方 registry 的 `versions` 对象给出以下结果：

| Package | 当前 dist-tags | `versions` 中 beta.2 之后的 `1.0.0-*` | beta.2 发布时间 |
| --- | --- | --- | --- |
| `@univerjs/core` | `latest=0.25.1`, `alpha=1.0.0-alpha.8`, `insiders=1.0.0-insiders.20260813-7c9aa50`, `beta=1.0.0-beta.2` | 无 | `2026-08-22T09:49:29.554Z` |
| `@univer-cli/headless-univer` | `latest=beta=1.0.0-beta.2` | 无；该 package 只发布了这一个 version | `2026-08-25T08:22:04.465Z` |

两个 `versions` key 集合的 `1.0.0-*` 交集只有 `1.0.0-beta.2`，因此它是最新可安装的统一 cohort。registry 的 `time` 对象可能保留已删除或未再可安装版本的历史时间；本调查只把同时存在于 `versions` 的条目当作已发布升级候选。官方 registry 元数据：[`@univerjs/core`](https://registry.npmjs.org/%40univerjs%2Fcore)、[`@univer-cli/headless-univer`](https://registry.npmjs.org/%40univer-cli%2Fheadless-univer)；对应 npm 页：[`@univerjs/core` versions](https://www.npmjs.com/package/@univerjs/core?activeTab=versions)、[`@univer-cli/headless-univer`](https://www.npmjs.com/package/@univer-cli/headless-univer)。

官方 GitHub tag 也没有提供更新的 Core release：`dream-num/univer` 的最新 `v1.0.0-*` tag 是 annotated tag `v1.0.0-beta.2` (`73ba893935ab6e48303cd62aedd8199286ecf16c`，peeled commit `53698c4268df5fbd89e08805edadb5ef27b6bf53`)；[官方 releases](https://github.com/dream-num/univer/releases) 当前最新稳定 release 仍是 `v0.25.1`。`dream-num/univer-cli-sdk` 官方 remote 没有 tags；其与 headless beta.2 tarball 对应的官方 checkout commit 是 `38586cd61099e770edf8b8aa6a15a6733b392403` (`chore: sync Univer SDK to 1.0.0 beta.2 (#31)`)。GitHub tag/release 用于交叉核对源坐标，可安装性仍以 registry `versions` 与 tarball 为准。

本次从 npm 官方 registry 重新下载了两个 beta.2 tarball，并遍历 Core 全部 public `.d.ts`、headless public `.d.ts` 和 headless runtime bundle。检索的 public identifier 包括 `IRandomIdService`、`RandomIdService`、`IRandomService`、`randomIdGenerator`、`randomIdService`、`idGenerator`、`seed`、`rng`、`getRandomValues`、`createRandomId`、`generateRandomId`、`StandardHeadlessUniverFactoryOptions` 与 `IUniverConfig.override`。结果与已安装包一致：Core 只有两个普通 random-ID 函数；headless options 只有 `license` 和 `embedPluginConfig`；factory 只构造 `new Univer({ locale, locales })`。官方 [`v1.0.0-beta.2` Core source](https://github.com/dream-num/univer/blob/v1.0.0-beta.2/packages/core/src/shared/random-id.ts) 也直接读取 Host `crypto.getRandomValues`，缺失时回退 Host `Math.random`。

所以没有可通过“升级到 beta.2 后某个已发布统一版本”解锁的 API。直到 Core 与 headless 以同一精确 release 发布下文建议的 per-runtime ID generator seam，Task 2.2 的 blocker 仍然存在。

## 结论

没有。两个 `1.0.0-beta.2` 发布包都没有受支持的 public per-runtime RNG/ID injection。

`@univerjs/core` 公开 `createRandomId()` 与 `generateRandomId()` 两个普通函数；它们每次直接解析 Host `crypto.getRandomValues`，没有 crypto 时回退 Host `Math.random`。Core 虽公开 `IUniverConfig.override`，但 override 只能替换已经由 `IdentifierDecorator` 标识的依赖，而发布类型和代码中不存在 RNG/ID service identifier。`Univer.__getInjector()` 被标记为 `@ignore`，不能作为受支持的注入合同。[Core random public types](../../node_modules/.pnpm/@univerjs+core@1.0.0-beta.2_react@19.2.8_rxjs@7.8.2/node_modules/@univerjs/core/lib/types/shared/random-id.d.ts#L16-L17)、[Core random implementation](../../node_modules/.pnpm/@univerjs+core@1.0.0-beta.2_react@19.2.8_rxjs@7.8.2/node_modules/@univerjs/core/lib/es/index.js#L9493-L9539)、[IUniverConfig](../../node_modules/.pnpm/@univerjs+core@1.0.0-beta.2_react@19.2.8_rxjs@7.8.2/node_modules/@univerjs/core/lib/types/univer.d.ts#L26-L91)、[DependencyOverride](../../node_modules/.pnpm/@univerjs+core@1.0.0-beta.2_react@19.2.8_rxjs@7.8.2/node_modules/@univerjs/core/lib/types/services/plugin/plugin-override.d.ts#L17-L23)。

`@univer-cli/headless-univer` 的 `StandardHeadlessUniverFactoryOptions` 只有 `license` 与 `embedPluginConfig`。factory context 的 `unitId`/`unitType` 在发布实现中也没有进入 RNG 或 `Univer` config；factory 仅创建 `new Univer({ locale, locales })` 并注册标准 plugins。[published headless types](../../node_modules/.pnpm/@univer-cli+headless-univer@1.0.0-beta.2_react@19.2.8_rxjs@7.8.2/node_modules/@univer-cli/headless-univer/dist/index.d.ts#L50-L63)。本机官方 `univer-cli-sdk` checkout 的 commit `38586cd61099e770edf8b8aa6a15a6733b392403` 是同步整个 SDK cohort 到 `1.0.0-beta.2` 的提交；该 commit 的 `packages/headless-univer/src/index.ts` 与发布类型、factory 行为一致。

因此 Node VM 只把 compiler program 放进独立 context 并不能解决真实输出的 ID 随机性。程序调用的是 Host 创建的 Facade；Facade、commands 与 Core data model 中的词法 `generateRandomId` 仍读取 Host random intrinsics。

## 真实调用链

精确 `@univer-cli/doc-typst-facade@1.0.0-beta.2` 对最小 Doc 生成的 JavaScript 不含 `Math`、`crypto` 或 `random`。它调用 `univerAPI.createDocument(...)`，再通过 `insertText`、`appendParagraph` 等 Facade 方法组装内容。官方 `univer-cli-sdk` commit `38586cd61099e770edf8b8aa6a15a6733b392403` 的 `packages/doc-typst-facade/src/doc-typst-pages-translator.ts:12079-12184` 记录了相同 codegen；该 package 在此 commit 之前最后一次源码修改为 `1204971e8fc0a5c62c267f6224c3482a93cfee53`。

运行时路径如下：

```text
compiler-generated program
  -> FUniverDocsMixin.createDocument(data)
  -> IUniverInstanceService.createUnit(UNIVER_DOC, data)
  -> DocumentDataModel / createDocumentSnapshot
  -> getDocsEmptySnapshot
  -> createParagraphId + createSectionId
  -> lexical generateRandomId
  -> Host crypto.getRandomValues, fallback Host Math.random

generated document.insertText / appendParagraph
  -> FDocument.insertParagraph / appendParagraph
  -> buildPlainTextInsertBody
  -> createParagraphId
  -> lexical generateRandomId
  -> Host random intrinsics
```

发布证据：

- Docs Facade 的 `createDocument(data)` 直接调用 `IUniverInstanceService.createUnit`：[published `@univerjs/docs@1.0.0-beta.2` Facade](../../node_modules/.pnpm/@univerjs+docs@1.0.0-beta.2_react@19.2.8_rxjs@7.8.2/node_modules/@univerjs/docs/lib/es/facade.js#L1948-L1951)。
- `DocumentDataModel` 建立缺省 Doc snapshot；缺省 paragraph 与 section 分别调用 `createParagraphId`、`createSectionId`，后两者调用 `generateRandomId(12)`：[Core bundle `src/docs/paragraph-id.ts`](../../node_modules/.pnpm/@univerjs+core@1.0.0-beta.2_react@19.2.8_rxjs@7.8.2/node_modules/@univerjs/core/lib/es/index.js#L12910-L12935)、[`section-break-id.ts` 与 `empty-snapshot.ts`](../../node_modules/.pnpm/@univerjs+core@1.0.0-beta.2_react@19.2.8_rxjs@7.8.2/node_modules/@univerjs/core/lib/es/index.js#L12944-L13005)、[`document-data-model.ts`](../../node_modules/.pnpm/@univerjs+core@1.0.0-beta.2_react@19.2.8_rxjs@7.8.2/node_modules/@univerjs/core/lib/es/index.js#L16240-L16390)。
- `appendParagraph` 转到 `insertParagraph`；`buildPlainTextInsertBody` 为每个插入段落调用 `createParagraphId`：[Docs Facade helper](../../node_modules/.pnpm/@univerjs+docs@1.0.0-beta.2_react@19.2.8_rxjs@7.8.2/node_modules/@univerjs/docs/lib/es/facade.js#L17-L38)、[`appendParagraph`](../../node_modules/.pnpm/@univerjs+docs@1.0.0-beta.2_react@19.2.8_rxjs@7.8.2/node_modules/@univerjs/docs/lib/es/facade.js#L1825-L1860)。
- 同一发布 Facade 的 header/footer、section 路径还直接调用 `generateRandomId` 或 `createSectionId`，所以只修 paragraph 不能覆盖一般 Typst 文档：[Docs Facade imports and call sites](../../node_modules/.pnpm/@univerjs+docs@1.0.0-beta.2_react@19.2.8_rxjs@7.8.2/node_modules/@univerjs/docs/lib/es/facade.js#L1-L30)。

本地受控复现实验对同一 compiler output 连续创建两个全新标准 headless runtime，没有替换任何 Host descriptor。完整 snapshots 不相等；字段路径相同，但 `body.paragraphs[0..1].paragraphId` 与 `body.sectionBreaks[0].sectionId` 的值均不同。相反，当前 Workspace 测试只有在 materializer 临时替换 Host `Math.random`/`crypto.getRandomValues` 时才得到相等 snapshots。这个结果定位的是 Facade/Core Host call path，不是 compiler VM 内的随机调用。

## 最小上游 seam

最小可维护方案由 Univer SDK 拥有一个 per-`Univer` ID generator service，再由 headless factory 提供显式选项。建议的 public contract 是：

1. `@univerjs/core` 新增并从 root export `IRandomIdService`（名称可由上游确定），方法保持现有语义，例如 `createId(size?: number, alphabet?: string): string`；默认实现继续使用当前 crypto/Math 算法。
2. 在 Core `createUniverInjector()` 的固定 dependencies 中注册该 identifier，使现有 public `IUniverConfig.override` 可以按 runtime 替换它。不要通过 mutable module singleton、Host descriptor patch 或 Node-only `AsyncLocalStorage` 给浏览器 Core 制造隐式作用域。
3. `@univer-cli/headless-univer` 给 `StandardHeadlessUniverFactoryOptions` 增加一个窄的 optional `randomIdGenerator`/`randomIdService`，并在构造 `Univer` 时用 Core override 安装它。省略选项必须保留现有随机行为。
4. 将真实 Doc materialization 能触达的 ID 分配点改为消费这个 service：Core 的 `docs/data-model/{document-data-model,empty-snapshot}.ts`、`docs/{paragraph-id,section-break-id}.ts`；Docs 的 `facade/{utils,f-document,f-document-section}.ts`、header/footer 与 section commands；以及 `convertMarkdown`/rich-text 路径触达的 Core paragraph、list、range ID builders。普通、非 runtime helper 可以继续用现有 exported `generateRandomId` 作为默认值。

这是一条 seam，而不是为 Typst 新建 Facade 或重写 document model。每个 headless runtime 持有独立 generator state；同一种子可复现，两个并发 runtime 不共享序列，Browser/CLI 省略选项时不变。上游需要用至少以下集成矩阵锁定合同：两个并发 `Univer` 使用不同 provider；同 seed 的真实 `createDocument` + insert/append/Markdown/header/footer/section/save 输出完全相等；Host descriptors 和另一 runtime 的序列不变；省略 provider 继续使用 crypto/Math。

本机 `univer` checkout 的 HEAD 是 `fc73e517950593e46074b465563b488c9e246397`（2026-08-08），早于 `@univerjs/core@1.0.0-beta.2` 的发布基线，不能当作该 tarball 的匹配 commit。上面的 Core 结论因此以已安装 beta.2 的 manifest、types 与带 first-party region path 的发布 bundle为权威；checkout 只用于确认模块物理位置，不能用于声称发布 commit identity。

## Compiler-emitted stable IDs 是否可行

作为独立小修不可行。beta.2 compiler codegen没有发出 `paragraphId`、`sectionId` 或 `listId`；它调用的 public `createDocument`、`insertText`、`appendParagraph` 等 signatures 也没有 explicit ID 参数。Host 在初始 Doc、插入段落、section/header/footer 和 Markdown/rich-text conversion 中分配 ID。只把稳定 ID 加到 compiler 的局部对象，无法覆盖这些调用点。

上游可以选择另一条更大的路线：compiler 直接生成带全套稳定 ID 的完整 `IDocumentData`，并避免所有会再分配 ID 的 Facade mutations；或者为每个相关 Facade mutation增加 explicit ID 参数并让 compiler 全面传入。两种方案都把 compiler 耦合到 paragraph、section、segment、list、range 等完整持久化身份合同，改动面大于一个 per-runtime service，并容易漏掉不同文档特性触发的 ID 分配。因此本调查不推荐用 compiler stable IDs 解当前阻塞；它只适合作为未来 compiler/data-contract 的独立设计。

## 解锁的决定

`add-dsh-typst-generation-tools` 不能在当前 `1.0.0-beta.2` baseline 内同时满足“真实 Doc Facade materialization deterministic”“并发 per-invocation”“不修改 Host Math/crypto”“只用公开 API”。继续 Task 2.2 前应先取得上游 Core + headless 的 per-runtime ID generator seam，并升级到包含该 seam 的单一精确 SDK release；否则必须修订 OpenSpec，明确放弃其中至少一个约束。Node VM 本身不能解除这个 blocker，Workspace 仓库也不应通过 private injector、module patch、Facade reimplementation 或 compiler ID partial patch 绕过上游所有权。
