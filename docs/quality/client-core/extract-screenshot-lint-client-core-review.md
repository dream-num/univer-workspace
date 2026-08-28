# extract-screenshot-lint-client-core Code Review

审查范围：

```text
git diff 7e53844aa8a90950479f30382259e17dc6ec7529 8ee94b17a949394b18c47c587613d6c34cf3045a -- . ':(exclude)docs/**' ':(exclude)openspec/**'
```

两个固定点均解析为Git tree object；产品diff非空，共33个文件、1351 insertions、867 deletions，没有commit list。OpenSpec proposal/design/spec/tasks是Spec依据，`docs/quality/client-core/extract-screenshot-lint-client-core-qa.md`只提供验收导航和补充证据。Standards依据为根`AGENTS.md`、`apps/workspace/AGENTS.md`、`apps/workspace/CONTEXT.md`、ADR-0002/0003、根/CLI/Client Core README，以及`mattpocock-skills:code-review`的完整smell baseline。

本次完整使用`mattpocock-skills:code-review`。系统thread limit仍被已完成reviewer占用，无法再启动两个subagents；coordinator先完成独立Standards pass，再重新读取Change artifacts并单独执行Spec pass。两轴证据和结论没有合并或重新排序。

## Standards

**Pass：0 findings，0 open。**

- Core成为render Unit assembly、screenshot capture/PNG、Slide lint和render-page source的唯一owner；旧CLI screenshot/lint implementation和content/source subclass均已删除且无残余consumer。CLI只保留Commander、daemon operation adapter、license/browser setup、presentation、SVG临时consumer和artifact copy。
- `WorkspaceRenderUnitLoader`直接复用既有runtime target/reference、`exportUnitData`和Asset content owner；没有复制HTTP、target、reference、Asset或daemon wire实现。Core不反向导入CLI、Commander、Session、config、daemon、presenter或process-global render path，也没有private `src`/`dist`跨package import。
- render page只在Client Core保留source，CLI build显式复制Core build output到既有`dist/render-runtime`。Client Core声明实际使用的精确SDK依赖；package artifact从Core声明的render runtime核对resolved version，再读取其Puppeteer dependencies。没有依赖hoist、相邻checkout或新增public package合同。
- screenshot与lint显式接收`renderPageRoot`、license、env和optional signal；每次operation各建一个runtime，factory成功后的success/failure路径均在settle前await同一个`close()`，没有browser pool、registry、singleton或新cancellation owner。
- PNG writer只使用Node filesystem primitives，先全量校验name和existing destination，再以同目录`0600` exclusive temp和non-replacing hard link提交；后项失败不回滚前项。没有filesystem provider、generic download abstraction、force overwrite或事务伪装。
- `packages/client-core/src/screenshot.ts:126-128`只吞temp已经不存在的`ENOENT`，而旧CLI吞掉所有unlink错误。此处不记兼容finding：OpenSpec要求success时temp已移除，QA AC-49明确禁止吞掉其他cleanup error；对非`ENOENT`仍报告成功会隐藏包含截图字节的残留temp。destination已提交而cleanup失败时仍保持既有非事务边界。
- 新增formula target identity与Embed ResourceRef identity/type gates属于design decision 3及QA AC-18/25明确的无效元数据合同，不改变合法reference/embed路径，因此不视为scope creep。其实现缺口单列在Spec `SPEC-01`。
- screenshot/lint command生产hunk除type owner import外保持原逻辑。新增无scope Commander test只断言通用exit，证据粒度偏宽，但`workspace-screenshot-scope-required`的code/message和scope function本身未发生产品diff，因此没有掩盖本Change中的命令行为修改。
- 限定diff未包含credential、Cookie、device code、license bytes、signed Asset URL、private key或绝对checkout路径。Smell baseline未发现需要报告的Mysterious Name、Duplicated Code、Feature Envy、Data Clumps、Primitive Obsession、Repeated Switches、Shotgun Surgery、Divergent Change、Speculative Generality、Message Chains、Middle Man或Refused Bequest。

## Spec

### SPEC-01：重复Embed descriptor采用last-write-wins，可绕过已声明的child类型约束

- 严重度：medium
- 状态：closed
- 位置：`packages/client-core/src/render-unit.ts:144-165`、`packages/client-core/src/render-unit.ts:172-195`；`packages/client-core/test/render-unit.test.ts:106-143`
- 规格：OpenSpec“Scope-aware render Unit assembly / Host has embedded Units”要求active child通过shared reference scope解析；design decision 3要求ResourceRef、resolved Unit identity/type和loaded Unit identity/type继续严格校验。QA AC-23/25进一步要求duplicate direct/ref表示不改变结果，且ResourceRef声明的selector/type必须与resolved target一致。
- 证据：`embeddedUnitReferences()`按child ID执行`Map.set(child.unitId, child)`，因此最后一个duplicate覆盖此前descriptor。现有fixture恰好先放`source.ref.unit.type: "doc"`、后放无type的direct `childUnitId`，但只用resolved Doc验证成功，没有验证约束仍存在。对固定implementation build做真实Core probe：同一child先声明typed ResourceRef为`doc`，再声明direct duplicate，resolver返回`sheet`，`loadUnit()`仍成功并输出Sheet child。另一个缺口是object ResourceRef的`unit.type`存在但为non-string时会被当成未声明而静默接受。
- 建议：保持每个distinct child只resolve/export一次，但不要让无type duplicate覆盖已声明type；对全部已声明type做一致性检查，conflict或任一type与resolved target不符时返回既有`workspace-screenshot-embed-resource-invalid`。若object ResourceRef出现`type`字段，要求它为合法non-empty string。增加direct/ref两种顺序、conflicting types及non-string type cases；无需新增registry或ResourceRef abstraction。

### SPEC-02：抽取后的通用resource parser改变了malformed root的既有错误消息

- 严重度：low
- 状态：closed
- 位置：`packages/client-core/src/render-unit.ts:122-165`、`packages/client-core/src/render-unit.ts:197-209`；`packages/client-core/test/render-unit.test.ts:81-104`、`packages/client-core/test/render-unit.test.ts:145-169`
- 规格：OpenSpec“Reference metadata is invalid”要求返回既有structured screenshot reference/Embed error；“Workspace CLI screenshot and lint compatibility”要求coded errors与presentation保持。proposal还明确本Change不产生CLI breaking change。
- 证据：baseline对decoded root为array、null或primitive时，将root和missing field一起映射为`references is not an object`或`embeds is not an object`。新`parseResource()`先以`data is not an object`失败。code仍分别是`workspace-screenshot-reference-resource-invalid`和`workspace-screenshot-embed-resource-invalid`，但CLI可见message发生变化；迁移后的table tests只断言code，因此没有发现漂移。
- 建议：让caller继续用subject-specific的root/field record check，使non-record root恢复既有`references/embeds is not an object`message；为array、null和primitive root断言exact code与message。无需兼容层或新parser abstraction。

其余Spec检查通过：

- Host required/trim、Trunk/Worktree target选择、Host-first export、formula lexical order/dedup/self排除、Sheet/Base gate、active Embed/soft-delete、formula/Embed overlap排除以及exported UnitData identity检查均在Core拥有；target/reference/export failure不触发browser或PNG writer。
- Worktree Asset rewrite直接使用upstream screenshot resolver，跨Host/formula/Embed按Asset identity去重并只改render copy；Trunk不发Asset请求。source fixtures保持不变。
- capture/lint把exact runtime options和operation input交给upstream owner，保留result order/bytes/view与close precedence；non-Slide在runtime create前返回既有coded error。
- PNG output保留safe basename、全量preflight、recursive destination、private temp、exclusive hard-link race、exact bytes和非事务多图语义，没有覆盖现有destination。
- render page source、1600×1000 page、relative Vite output和SVG既有`dist/render-runtime`consumer保持；CLI command options、browser setup、daemon payload、license来源和presentation未迁入Core。
- installable artifact从真实Core render-runtime owner解析Puppeteer dependency，copy/verify/smoke均不依赖workspace bare import或checkout path。

### Fix re-review

复审固定产品diff为`git diff 8ee94b17a949394b18c47c587613d6c34cf3045a 0098f00d4d6f0837084555a8b5bb7eaa9c4de4b0`，仅修改`packages/client-core/src/render-unit.ts`与`packages/client-core/test/render-unit.test.ts`，`git diff --check`通过。thread limit仍无法释放subagent slot；coordinator依次执行独立Standards closure pass和Spec closure pass，未混合两轴证据。

- Standards closure：修复在原loader owner内用一个`Map`合并duplicate descriptor，没有增加registry、ResourceRef abstraction、dependency或新owner。产品diff只有23 insertions/7 deletions；formula/source/Asset/CLI、resolver调用shape和lexical sort路径未改。Standards无新finding。
- `SPEC-01` closure：`render-unit.ts:161-177`保留已声明的type，不让后续untyped duplicate擦除；typed/untyped两种顺序得到同一effective constraint，same-type duplicate只resolve/export一次，不同type在resolver前返回`workspace-screenshot-embed-resource-invalid`。`render-unit.ts:203-211`拒绝present-but-non-string和blank object ResourceRef type，保留后续resolved target type exact check。focused tests覆盖两种typed/untyped顺序、same type、conflict、non-string/blank type和resolver/export call count；finding关闭。
- `SPEC-02` closure：`parseResource()`只负责string/JSON解码，external和Embed caller分别在`render-unit.ts:128-131`与`:150-153`执行root/field record gate。array、null、primitive和missing/array field现在分别精确返回`references is not an object`与`embeds is not an object`；其他 non-string、invalid JSON、identity与ResourceRef message均由exact table assertions锁定。finding关闭。
- Regression evidence：当前fixed head的`render-unit.test.ts` 32/32通过，Client Core typecheck通过。将新测试与固定旧`8ee94b1...:render-unit.ts`组合到隔离目录后，实际得到10 failed / 22 passed：3个external root message、1个typed-overwrite、1个conflicting type、3个Embed root message和2个invalid declared type。任务中的“9 failures”计数未能复现；可复现结果为10，且全部对应本次修复合同，不产生新finding。

Spec：2 findings已关闭，最高严重度medium；0 open。

## Verification

- 固定产品diff `git diff --check`：通过。
- Client Core focused render/source/screenshot/output/lint：5 files / 58 tests通过。
- Client Core typecheck/build：通过；render page产出`index.html`与非空relative local asset closure，无`.ts`或`.map`。
- CLI screenshot/lint/SVG focused：4 files / 9 tests通过；SVG只作为既有临时render-page consumer检查，没有扩展Change 10 scope。
- package ownership tests：13 tests通过。
- CLI build与Core-to-CLI render-page directory equality：通过。
- `pnpm package:workspace-cli`与package verify：通过，203 files，packed 13,029,350 bytes，unpacked 58,136,497 bytes。
- installed-tarball smoke：通过，包含arbitrary-cwd screenshot/setup/lint surface、copied render page和Puppeteer resolution。一次与共享工作区中的并发package rebuild发生artifact目录竞争；在固定artifact稳定后原命令重跑通过，不归因于产品diff。
- 额外Core contract probe：typed Embed ResourceRef随后出现direct duplicate时，resolved Sheet错误地成功；这是`SPEC-01`的直接失败证据。
- Fix re-review focused：当前fixed head 32/32通过，Client Core typecheck通过；新测试+旧loader的隔离red-check为10 failed / 22 passed，fixture已删除。

## Summary

- Standards：0 findings；最高严重度无；0 open。
- Spec：2 findings已关闭；最高严重度medium；0 open。
- 总open findings：0。
