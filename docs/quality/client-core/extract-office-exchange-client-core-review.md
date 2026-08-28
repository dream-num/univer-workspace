# extract-office-exchange-client-core Code Review

审查范围：

```text
git diff fe8a216126594211da39116414cfe29129ad20e4 b3896dd7052eeedca460b83d188e46d9aacb399d
```

两个固定点均解析为 Git tree object，限定 diff 非空，共 13 个文件、548 insertions、267 deletions；没有 commit list。

本次完整使用 `mattpocock-skills:code-review`。系统 thread limit 被已完成 reviewer 占用，无法为 Change 7 再启动两个 subagents；review coordinator 因此先完成 Standards pass，再重新读取 Change artifacts并独立执行 Spec pass。两轴证据和结论分别记录，没有合并或重新排序。`docs/quality/client-core/extract-office-exchange-client-core-qa.md` 只作为验收设计读取，不替代规格或本次直接验证。

## Standards

**Pass：0 findings，0 open。**

- Owner 与依赖方向符合根 `AGENTS.md`、`apps/workspace/CONTEXT.md` 和 package README：Office suffix/type/options、name、create-result、export validation 与默认 Node adapter 只存在于 `packages/client-core/src/office-exchange.ts:1-291`。CLI 原 owner 已删除；`apps/cli/src/features/exchange/command.ts:1-86` 只保留 Commander mapping/presentation，`apps/cli/src/program.ts:98-134` 只组合既有 daemon runtime、Unit create 和 runtime target seams。
- Core 直接复用 Change 3/5/6 的 `WorkspaceUnit`、`WorkspaceRuntimeTarget`、`WorkspaceContentRuntimeOperations.exportUnitData` 与 package root exports，没有复制 Unit、target、runtime、HTTP、auth、daemon 或 error owner。Core Office source不导入CLI、Commander、Session、daemon、Change 4 file transfer或private `src`/`dist` path。
- `packages/client-core/package.json:24-39` 只新增精确 SDK baseline 的 `@univerjs-pro/exchange-node@1.0.0-beta.2`。CLI 删除重复的source dependency，但在`apps/cli/package.json:99`继续显式拥有`@univerjs-pro/exchange-node-binding@0.1.0`；lockfile、distribution manifest、package verify和installed smoke形成闭包。安装包内联Office owner，不含Client Core bare dependency、checkout path、TypeScript source或source map。
- 原实现从`apps/cli/src/features/exchange/exchange.ts`迁至Core，workflow主体、验证顺序、错误文案、options和result shape没有产生第二套实现或compatibility façade。保留的两个窄function substitutions只服务直接behavior tests，符合design；没有converter registry、filesystem provider、credential store或新I/O语义。
- Smell baseline未发现需要报告的 Mysterious Name、Duplicated Code、Feature Envy、Data Clumps、Primitive Obsession、Repeated Switches、Shotgun Surgery、Divergent Change、Speculative Generality、Message Chains、Middle Man或Refused Bequest。现有单一Feature class和结构化dependencies是迁移前已有的最小seam，不是新增framework。
- 限定 diff 的secret搜索仅命中文档中的既有“password input”职责说明；未出现credential、Cookie、device code、license bytes或absolute checkout path。

## Spec

**Pass：0 findings，0 open。**

- Import：`packages/client-core/src/office-exchange.ts:91-128`、`:167-185`、`:219-287`实现全部10种suffix的大小写不敏感matrix、XLS/XLSX Sheet/Base选择、特殊presentation的PPTX override及精确formula options。unsupported/incompatible在converter/create前返回既有code；path、parent与idempotency bytes不被trim、resolve或替换。
- Name与identity：显式非空name、converted name、title、fallback顺序保持；只用显式非空name覆盖payload。create result逐项核对Worktree/source/type/name/Space/parent，成功result逐字保持`committed/name/nodeId/resourceId/sourcePath/type/unitId/worktreeId`。`packages/client-core/test/office-exchange.test.ts:48-275`覆盖matrix、空白name、exact create shape、retry idempotency和六个单维result mismatch。
- Export：`packages/client-core/src/office-exchange.ts:130-164`保持resolver → Board → suffix → compatibility → exact target UnitData export → identity → native writer的顺序。writer接收同一UnitData object、原output path和Sheet/Base/Doc/Slide精确options；runtime/writer failure不重试或回退。`packages/client-core/test/office-exchange.test.ts:277-433`覆盖exact revision、所有不兼容组合、invalid UnitData和side-effect边界。
- Native runtime：`packages/client-core/test/exchange-node.test.ts:1-59`通过生产`@univerjs-pro/exchange-node`与platform binding执行真实XLSX写入/读回，断言非空文件和fixture cell，并在`finally`清理临时目录。
- CLI compatibility：command名称、arguments、one-of type、undefined option省略、JSON/text presentation未改变。`apps/cli/src/features/content/execution.ts:9-31`仍发送`runtime.export-unit-data`与canonical serialized target；Office export只有通过Core的target/type/format validation后才调用该operation。Session、daemon lifecycle、license timing、wire和command runner未被限定diff修改。
- Test迁移没有通过删除隐藏旧行为：原CLI workflow cases迁入并扩展为68个Core focused tests；CLI保留input/presentation tests，daemon adapter测试独立锁定三条RPC及exact payload，application command contracts和CLI全量tests继续通过。
- 范围内没有Typst、SVG、render、screenshot/lint、Skills、Workspace Server/Browser、HTTP/Collaboration contract或filesystem语义改动，也没有新增public package、npm version或`apps/dsh-univer-work`。

## Verification

- `pnpm install --frozen-lockfile --offline`：通过。
- Client Core Office/native focused：2 files / 68 tests通过。
- Client Core full：18 files / 338 tests通过。
- Client Core typecheck/build：通过。
- CLI focused：3 files / 14 tests通过。
- CLI full：16 files / 68 tests通过。
- package artifact tests：5 tests通过。
- `pnpm package:workspace-cli`：通过。
- CLI package verify：通过，203 files，packed 13,029,106 bytes，unpacked 58,135,576 bytes。
- installed-tarball package smoke：通过；native binding exports可加载。
- artifact搜索确认Office owner位于bundled `dist/main.js`，distribution manifest只保留精确`@univerjs-pro/exchange-node-binding@0.1.0`，不存在Client Core bare dependency或checkout path。
- 限定 diff `git diff --check`：通过。

## Summary

- Standards：0 findings；最高严重度无；0 open。
- Spec：0 findings；最高严重度无；0 open。
- 总 open findings：0。
