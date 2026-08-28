# extract-svg-client-core Code Review

审查固定点：

```text
base:    27a3b99627839040840052dea948ac8b07451598
product: f90023ca61ed593993ce5e252329492542ed9aa8
diff:    git diff 27a3b99627839040840052dea948ac8b07451598 f90023ca61ed593993ce5e252329492542ed9aa8 -- . ':(exclude)docs/**' ':(exclude)openspec/**'
```

两个固定点均可解析为Git tree object，产品diff非空，共16个文件、739 insertions、249 deletions，无commit list；`git diff --check`通过。Spec依据为Change proposal、design、delta spec和tasks；`docs/quality/client-core/extract-svg-client-core-qa.md`仍是pre-implementation acceptance design，仅作场景导航，不替代Spec。Standards依据为根`AGENTS.md`、根/CLI/Client Core README、`apps/workspace/CONTEXT.md`、ADR-0001至0006，以及`mattpocock-skills:code-review`的完整smell baseline。

本次完整使用`mattpocock-skills:code-review`与PONYTAIL full。系统thread limit被既有agent占满，启动独立Standards subagent被拒绝；coordinator先完成Standards pass，再重新读取Change artifacts执行独立Spec pass。两轴证据与结论保持分离。

## Standards

**Pass：0 findings，0 open。**

- `packages/client-core/src/svg.ts`成为SVG source/relative asset compile、真实/估算测量、page wrapper和apply orchestration的唯一owner；旧CLI text measurer已删除，repo owner scan只在Core找到`compileSvgToFacade`、`wrapSlideScript`和`builtinTextMeasurer`。
- Core直接复用既有`WorkspaceContentExecutionFeature.executeSlide`与`createUniverRenderRuntime`，没有复制target、runtime、commit、daemon或render-page owner。CLI command只保留Commander validation、`--out`写入和presentation；`program.ts`只装配license/environment/render-page与content execution。
- source/asset读取继续使用Node `readFileSync`与source directory `resolve(dirname(file), href)`；没有filesystem provider、remote filesystem、registry、service container、browser pool/cache、cancellation或并行框架。
- runtime promise只在首次measurement创建，一次compile共享；success、compiler failure和measurement failure都经过一个awaited `close()`。factory rejection不伪造close或估算fallback。该窄逻辑保持旧CLI的close-error precedence；没有新增cleanup abstraction。
- `@univer-cli/svg-facade`以仓库exact SDK baseline从CLI manifest迁到真实Core owner，lockfile只有对应importer迁移。package build把Core内联，existing external dependency集合、worker child、render page、Puppeteer与三项native binding owner未扩张。
- `WorkspaceCompileSvgDependencies`的`compile`/`wrap`/`createRuntime` substitutions是design明确保留的behavior-test seam；没有单实现interface hierarchy或speculative registry。其余新增types只表达compile/apply边界，不构成Primitive Obsession或Data Clump。
- `DREAMNUM.md`与三个README只更新SVG owner这一已发生的职责事实，符合文档维护规则。限定diff未触及Server、Browser、HTTP/WS contract、Session、daemon wire、SDK baseline或发布渠道，也未加入credential、Cookie、device code、license bytes或private key。
- PONYTAIL full与smell baseline未发现需要报告的Duplicated Code、Speculative Generality、Middle Man、Shotgun Surgery、Divergent Change、Feature Envy、Mysterious Name、Data Clumps、Primitive Obsession、Repeated Switches、Message Chains或Refused Bequest。

## Spec

**Pass：0 findings，0 open。**

- `WorkspaceCompileSvgFeature.compile()`读取exact UTF-8 source，并将全部relative asset请求绑定到SVG目录。unreadable source在compiler/runtime前失败，asset读取失败不retry/fallback；一次top-level operation只调用compiler一次。
- text measurer整体保持旧CLI映射：JavaScript string offsets、`\r\n`结尾、paragraph offset、`fontSizePx * 0.75`、bold/italic/family presence、无边界Doc envelope及first-line metrics。真实模式按需创建一个runtime并复用；估算模式不启动browser，保留warning/lint顺序并追加一次既有placement lint。
- no-page返回raw compiler code且不调用wrapper；page path用同一compiled code/viewport只wrap一次，并保留positive page、replace/add mode。apply直接把该page program与exact Worktree/Unit identity交给shared Slide execution一次；committed=false、execution failure和result-unknown均不触发compile、wrap或execute replay。
- 旧CLI的runtime cleanup实现也是`finally`中await `close()`，因此primary failure与close failure同时发生时仍保持既有close-error precedence。抽取后Core compile在返回CLI前完成close，随后CLI按design执行`--out`再apply；write failure仍使execution为0。
- CLI command名称、arguments、help、positive-page parser、validation先后与message保持；Core request不trim file/Worktree/Unit，沿用旧shell值。JSON字段顺序与两空格加换行、warning后lint的stderr顺序、raw/page/output/apply文本和generated file尾换行均保持。
- package smoke从arbitrary cwd实际编译含UTF-8 text与nested relative PNG的SVG，检查page、`builtin-estimate`、page wrapper及image code；同一installed tarball同时通过worker、render page、browser dependencies、Skills、Typst与三项native binding闭包，没有workspace bare import或source-checkout dependency。
- Change只实现SVG extraction与最终artifact checkpoint所需smoke；没有借本Change修改前九个capability owner或开始新的Client Shell。

## Verification

- 固定产品diff `git diff --check`：通过。
- Client Core SVG focused：2 files / 14 tests通过。
- CLI SVG command、application contracts与built entrypoint focused：3 files / 24 tests通过。
- Client Core typecheck/build：通过；CLI typecheck/build：通过。
- package build/verify：通过，203 files，packed 13,029,788 bytes，unpacked 58,137,751 bytes。
- installed-tarball `package:smoke`：通过；真实SVG nested asset compile、arbitrary cwd、worker/render/browser/native/Skills closure全部由该smoke执行。
- owner/private-import/secret scan：通过；无Client Core private `src` consumer、旧CLI SVG implementation owner或测试credential。

## Summary

- Standards：0 findings；最高严重度无；0 open。
- Spec：0 findings；最高严重度无；0 open。
- 总open findings：0。Change通过code review。
