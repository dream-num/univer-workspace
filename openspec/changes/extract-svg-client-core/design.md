## Context

目标基线 `univer-workspace@081a8e7f30141b3d1dbb4a2200db426b56bfdb28` 中，`apps/cli/src/features/svg/command.ts` 一次性完成本地 SVG/relative asset 读取、`@univer-cli/svg-facade` 编译、可选 page wrapper、真实或估算字体测量、`--out` 写入、Worktree apply 和 Commander presentation。`text-measurer.ts` 把 SVG styled runs 映射为一行无边界 Univer Doc，再通过 `@univer-cli/univer-render-runtime` 取得真实 metrics。

本 Change 按既定顺序在 Changes 1–9 后实施。它直接复用 Change 6 的 Slide content execution operation，以及 Change 9 已归入 Client Core 的 browser runtime dependency、render page source和installable asset contract。Changes 1–5 由这两个 prerequisites 传递提供；Office 与 Typst owners 是 ordered predecessors，不是 SVG code dependencies。

## Goals / Non-Goals

**Goals:**

- 让 Client Core 成为 SVG source/asset compile、文本测量、page program 与 apply workflow 的唯一 owner。
- 让 CLI 只保留 Commander validation、Shell inputs、本地输出文件和 presentation，并保持 observable behavior。
- 让未来 local DSH Client Shell 直接复用同一 SVG owner、本机路径与自己交付的 render page。
- 以一次完整 source/package checkpoint 验收十个提取 Changes，并删除最后的迁移 shim 与重复 owner。

**Non-Goals:**

- 不包装或重写 `@univer-cli/svg-facade` compiler、built-in estimator 或 render protocol。
- 不建立 compiler、renderer、filesystem registry，或只有一个实现的 factory/interface hierarchy。
- 不把 `--out`、diagnostic presentation、Commander errors 或 Client Shell artifact path resolution移入Core。
- 不在checkpoint中补做前序Change、扩大CLI功能或开始`apps/dsh-univer-work`。

## Diagram design

```text
Workspace CLI shell
  ├── Commander / output file / presentation
  └── render-page + license + environment
                    │
                    ▼
private Client Core SVG owner
  ├── local SVG + relative assets -> facade code
  ├── estimated or browser text measurement
  └── page wrapper -> shared Slide execution
                    │
                    ▼
         Draft Worktree Slide Unit

final checkpoint -> Client Core + CLI + installed artifact
```

## Decisions

### 1. 在现有 Client Core 中增加一个 SVG owner

`@univerjs/univer-workspace-client-core` 增加 manifest-declared SVG exports，并迁入现有 compile input/result、text measurer、page wrapper 与 apply workflow。不创建第二个 package；SVG 与 Changes 6、9 共享同一两个 Node-hosted consumers、SDK baseline 和 package lifecycle。

owner直接组合现有 `@univer-cli/svg-facade` public compiler、built-in estimator 与 page wrapper。保留当前窄的 compiler/runtime/execution function substitution用于behavior tests，不增加registry、service container或Client Shell基类。

### 2. Core 继续读取本机 SVG 与 relative assets

compile operation 接受 SVG source path，使用现有 Node文件读取语义加载UTF-8 source，并按source directory解析compiler请求的relative asset。首版两个Workspace Agent Clients都运行在Node-hosted local profile；为一个具体实现增加filesystem provider只会扩大API。

`--out`仍由CLI command在operation返回后写入，Core不拥有generated-code destination、目录创建或overwrite policy。这样source/asset compile workflow有一个共享owner，同时CLI文件呈现保持不变。本 Change不复用Change 4的Blob/Asset transfer abstraction；后者拥有远程metadata与原子download合同，不适用于compiler的同步local reads。

### 3. 真实测量复用 Change 9 的 browser delivery owner

未选择估算时，SVG owner只在compiler首次请求measure时，以显式`renderPageRoot`、license和environment惰性创建`createUniverRenderRuntime`。一次顶层compile最多创建一个runtime，所有line measurement复用它，并在`finally`中等待close；无文字SVG和估算模式都不启动browser。

`createWorkspaceSvgTextMeasurer`的现有styled-run映射整体迁入Core：拼接data stream、保持run offsets，将px字号乘以`0.75`映射到Univer style，并返回first-line ascent/descent与actual width。它直接依赖runtime的窄`measureText`结构，不新增公共renderer interface。

估算模式直接复用`builtinTextMeasurer`，并在compiler lints后追加当前固定的placement lint。它不静默fallback：真实runtime失败仍失败，只有调用方明确选择估算才绕过browser。

### 4. 一次编译结果驱动 raw、page 与 apply 三种结果

每个顶层operation只调用compiler一次。没有page时返回raw code；有page时使用同一compiled code、viewport和调用方选择的`replace`或`add`构造page program。返回值继续包含code、warnings、lints、textMeasure、viewport以及可选page/mode/applied字段。

apply把该page program原样交给Change 6的Slide-only content execution operation，并透传Worktree和Unit identity。Core不解析runtime target、不访问daemon、不重写commit算法，也不在unknown或failure后重新compile/execute。CLI仍负责拒绝`--apply`缺少page/worktree/unit等Commander option组合；Core只接受已经结构化的compile或apply input。

### 5. CLI 保留 command、environment 与 presentation

`features/svg/command.ts`继续拥有`compile-svg`名称、positive page parser、`--add`/`--out`/`--apply`组合校验、JSON/text格式、warning/lint stderr和generated-code output file。它通过package export调用SVG owner，并以Change 9后的现有CLI规则提供license、environment和`dist/render-runtime`路径。

`program.ts`把Change 6的content execution operation适配给Core SVG owner；不引入新的daemon method或wire payload。权威compiler/text-measure/apply实现与核心tests迁入package后，CLI只保留command/built-entrypoint/application integration cases。

### 6. Client Core 拥有代码依赖，installable Client Shell 拥有交付闭包

Client Core manifest声明精确SDK baseline的`@univer-cli/svg-facade`；Change 9已让同一package拥有`@univer-cli/univer-render-runtime`与render page source。private Core不独立发布，也不解析consumer安装布局。

CLI build继续把Core代码内联进自包含artifact，并把Core render page复制到既有`dist/render-runtime`。Puppeteer、native bindings、worker child和Skills仍由CLI distribution拥有。未来另一个installableClient Shell必须交付自己的version-matched资产闭包；本 Change不建立公共npm合同。

### 7. 最后一个 Change 执行验收，不接管前序实施

apply首步验证Changes 1–9的真实public exports与各自compatibility gate已经完成；缺失时停止并回到对应Change，不在SVG owner内复制实现。SVG迁移完成后，用repo-wide import scan删除只为迁移保留且已无调用方的CLI re-export shim与重复owner。

最终checkpoint运行Client Core与CLI的typecheck/test/build、根workspace gates、package build/verify和tarball install smoke。安装态验证从arbitrary cwd加载完整command surface、worker child、render page、Puppeteer dependencies与三个native bindings，并至少运行无需远程credential的built-entrypoint paths。它验收前九个Changes已交付的代码，不把那些实现写进本Change tasks。

## Risks / Trade-offs

- **Change 6 或 9 的public operations与计划名称不同** -> apply读取真实exports并直接适配；缺失时停止，不建立平行execution或browser owner。
- **移动source reader改变relative asset路径** -> 迁移现有compiler fixtures并增加nested cwd/asset assertion，保持相对SVG文件而非process cwd解析。
- **browser failure泄漏runtime** -> success、compiler failure和measurement failure tests都断言close完成；估算/无文字cases断言runtime未创建。
- **Core与CLI都追加估算lint或wrap page** -> 两项只由Core执行，CLI tests固定exact output并删除Shell内重复逻辑。
- **最终checkpoint掩盖前序缺口** -> task 1只验 prerequisite；失败回到对应Change，SVG tasks不扩展scope。
- **CLI artifact遗漏Core SVG或render assets** -> package verify、built-entrypoint与实际tarball smoke共同检查arbitrary-cwd运行及无workspace/source imports。

## Migration Plan

1. 确认Changes 1–9完成，并记录content execution、browser runtime/render page的真实public names与package gates。
2. 在Client Core中迁移SVG source/asset compile、text measurer、page wrapper、apply workflow及核心tests。
3. 将CLI command与program composition切到package exports，保留validation、Shell inputs、output file和presentation。
4. 更新Client Core/CLI dependencies、exports和职责文档，删除无调用方的SVG owner与迁移shim。
5. 执行SVG compatibility gate及覆盖十个Changes的完整CLI/package checkpoint。

没有持久化数据或remote state迁移。失败时可整体恢复CLI SVG owner与imports；已有SVG文件、generated code和Worktree Units无需转换。

## Open Questions

无。会改变行为、实现路径或task breakdown的决定均已由既定边界和本Change设计确定。
