# extract-typst-client-core Code Review

审查范围：

```text
git diff ed3a6c57deddd3d0724073fd48da56e6e094b2a1 188e0ce49824dbabf19889aa6fec2723fb15e2ca
```

两个固定点均解析为 Git tree object，限定 diff 非空，共 18 个文件、862 insertions、160 deletions；没有 commit list。

本次完整使用 `mattpocock-skills:code-review`。系统 thread limit 被已完成 reviewer 占用，无法为 Change 8 再启动两个 subagents；review coordinator 先完成 Standards pass，再重新读取 Change artifacts并独立执行 Spec pass。两轴证据和结论分别记录，没有合并或重新排序。`docs/quality/client-core/extract-typst-client-core-qa.md` 只作为验收设计读取，不替代规格或本次直接验证。

## Standards

**Pass：0 findings，0 open。**

- Owner 与依赖方向符合根 `AGENTS.md`、`apps/workspace/CONTEXT.md` 和 package README：compile、diagnostic gate、deterministic materializer与apply只存在于`packages/client-core/src/typst.ts`和`typst-materialize.ts`。CLI原compile/materializer owner已删除；`apps/cli/src/features/typst/command.ts`只保留validation、local files和presentation，`apps/cli/src/program.ts`只组合Core exports与shared Unit owner。
- Core直接复用`workspaceError`和`WorkspaceUnitFeature.create`，没有复制error、Unit parser、idempotency或result-unknown owner；Typst source不依赖CLI、Commander、daemon、Session、remote content runtime、runtime pool、Blob/Asset或private `src`/`dist` path。
- global deterministic random修改集中在一个小的同步guard内；success与failure均通过`finally`恢复`Math.random`和`crypto.getRandomValues`的完整descriptor。每次materialize只创建一个一次性headless runtime，factory成功后的所有settle paths都经过同一个`univer.dispose()`；factory reject不会伪造dispose。
- 保留一个窄compile substitution、一个materializer structural dependency和shared Unit create seam，没有新增registry、factory hierarchy、service container、filesystem provider、scheduler、cache或cancellation abstraction。
- `packages/client-core/package.json`以精确baseline声明facade/headless依赖。`apps/cli/scripts/package-artifact.mjs:104-143`从实际Client Core manifest解析其declared facade，再核对resolved facade版本并读取native binding；external dependency set未扩大。CLI保留headless direct dependency用于既有formula-binding artifact解析，不是第二个Typst source owner。
- Smell baseline未发现需要报告的Mysterious Name、Duplicated Code、Feature Envy、Data Clumps、Primitive Obsession、Repeated Switches、Shotgun Surgery、Divergent Change、Speculative Generality、Message Chains、Middle Man或Refused Bequest。
- 限定diff未出现credential、Cookie、device code value、license bytes、private key或absolute checkout path；secret搜索命中仅为职责文档和existing smoke fixture的字段访问。

## Spec

### SPEC-01：`createDocument` guard在委托后才计数，不能可靠执行“恰好一个Doc”合同

- 严重度：medium
- 状态：closed
- 位置：`packages/client-core/src/typst-materialize.ts:45-50`、`packages/client-core/src/typst-materialize.ts:69-75`；`packages/client-core/test/typst-materialize.test.ts:110-134`
- 规格：`specs/workspace-client-core/typst/spec.md` 的“Deterministic Doc materialization contract”要求program只能创建一个identity匹配target的完整Doc；“Program violates Unit lifecycle constraints”要求zero/multiple/wrong Unit都返回既有`workspace-typst-runtime-contract`。QA AC-22/23进一步固定missing/blank ID和同ID多次create均必须得到该coded error。
- 证据：Proxy只把non-empty id追加到`createdUnitIds`，随后立即调用真实`target.createDocument(data)`，直到整段program结束才检查count。使用本次build的真实`HeadlessWorkspaceTypstMaterializer`复现：先创建target再创建missing-ID Doc、先missing-ID再target、以及target后blank-ID三种program都成功materialize；第二个Doc没有被计入，违反“恰好一个”。同一个target ID调用两次时，上游`UniverInstanceService`在第二次委托中先抛出uncoded `Error: cannot create a unit with the same unit id`，Core稳定的runtime-contract error没有机会产生。现有table test把每个invalid ID单独运行，并使用允许任意重复create的fake facade，因此两条真实路径都被隐藏。
- 建议：在`createDocument` wrapper调用真实Facade之前记录每一次调用，并最小地验证non-empty ID、调用次数和target identity；第二次或invalid/wrong ID立即抛现有`workspace-typst-runtime-contract`，保留外层postcondition作为防御。增加`target + missing/blank`和`same target twice`的direct cases，并让test double在重复ID时模拟真实Facade，或补一条真实headless contract test。无需增加registry、runtime pool或并发guard。

#### Fix re-review

- 修复范围：`git diff 188e0ce49824dbabf19889aa6fec2723fb15e2ca 4e2b8d5b7c18b3bfd99c5adf1a1231c0e4a92905`；两个固定点均为Git tree object，diff仅包含`packages/client-core/src/typst-materialize.ts`与`packages/client-core/test/typst-materialize.test.ts`，共61 insertions、18 deletions，`git diff --check`通过。系统仍把已完成reviewer计入thread limit；coordinator先完成独立Standards pass，再重新按原SPEC-01和Change contract执行Spec pass。
- Standards closure：修复只增加一个`createDocumentCalls`计数器、调用前validation和对应table cases。每次调用先计数并解析record/non-empty id；non-record、missing/blank、wrong identity及任意second call均在真实Facade前返回既有`workspace-typst-runtime-contract`。合法首个target Doc仍直接委托。没有新增owner、依赖、registry、runtime pool、filesystem seam或兼容层；outer postcondition、`finally` dispose及deterministic-random descriptor恢复结构未改。Standards维持0 findings、0 open。
- Spec closure：`packages/client-core/src/typst-materialize.ts:43-63`在delegate前覆盖每次调用和target identity；`:83-93`保留outer postcondition。`packages/client-core/test/typst-materialize.test.ts:110-159`固定duplicate、different、wrong、missing/empty/blank、target后missing/blank、missing argument、null与primitive的existing code、detail、delegate count、无`getDocument`及dispose。修复tree focused test为32/32通过，Core typecheck/build通过。
- 回归测试有效性：把修复tree的同一32-case测试放到`188e0ce...`旧materializer上独立运行，11项失败；失败直接覆盖第二次调用被委托、wrong/missing/blank/non-record被委托或泄漏TypeError，以及target加missing/blank错误成功。真实headless probe在修复build上确认合法target成功，duplicate、target加missing、non-record与wrong均稳定返回`workspace-typst-runtime-contract`。
- 结论：原建议完整实现，未发现修复引入的behavior regression或scope creep；`SPEC-01`关闭。

其余Spec检查通过：

- `packages/client-core/src/typst.ts:57-89`每个top-level operation只compile一次；compile-only原样保留compiler fields与errors且无side effect，apply只筛error diagnostics，warnings放行，materialize/create failure不重放。
- apply使用同一compiled JavaScript/target和materialized exact UnitData；name precedence、Doc type、Space/Worktree/parent/idempotency、optional omission与Server-allocated Unit identity均正确。
- materializer的normalization只固定target id和rev 1，保留完整saved data；name/title不trim；random bytes尊重typed-array view；random descriptors与runtime在success、program/contract/save failure路径恢复/释放。
- CLI保留原validation order、arguments、bundle/preview bytes、program与diagnostics文件顺序/schema、JSON/text result和coded command runner；Core不写local files。
- packaging从真实Core owner解析facade/native version。9个artifact tests覆盖owner缺失、workspace version、resolved mismatch和binding缺失；installed smoke在arbitrary cwd通过已安装CLI真实编译minimal bundle并验证program/result/diagnostics，无system Typst或checkout依赖。
- 限定diff没有改变Server/Browser、HTTP/Collaboration、Session、daemon、remote runtime、Office、SVG、render、screenshot/lint或Skills。

Spec：1 finding，最高严重度medium（已关闭）；0 open。

## Verification

- `pnpm install --frozen-lockfile --offline`：通过。
- Core Typst focused：3 files / 42 tests通过。
- Core full：21 files / 380 tests通过。
- Core typecheck/build：通过。
- CLI focused：2 files / 17 tests通过。
- CLI full：16 files / 70 tests通过。
- package artifact tests：9 tests通过。
- `pnpm package:workspace-cli`：通过。
- CLI package verify：通过，203 files，packed 13,029,511 bytes，unpacked 58,135,760 bytes。
- installed-tarball package smoke：通过，包含arbitrary-cwd真实Typst compile。
- artifact包含bundled Typst owner；distribution只保留六个既有external dependencies和精确native binding，不含Client Core/facade bare dependency、TypeScript source、source map或checkout path。
- 限定diff `git diff --check`：通过。
- 额外真实headless contract probe：target加missing/blank的第二个Doc错误地成功；same target twice返回uncoded upstream error。该probe是`SPEC-01`的直接失败证据。

## Summary

- Standards：0 findings；最高严重度无；0 open。
- Spec：1 finding；最高严重度medium（已关闭）；0 open。
- 总open findings：0。
