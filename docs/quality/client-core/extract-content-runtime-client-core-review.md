# extract-content-runtime-client-core Code Review

审查范围：`git diff b80fd9dd31bfd46d65acafcfc511bb1681ab8bdf fc2994e7e2ed484b922c4c353e91f99e07cb632e`

已完整使用 `mattpocock-skills:code-review` 的 Standards/Spec 双轴流程。系统 thread limit 在启动独立 reviewer 时拒绝请求；review coordinator 因此先完成 Standards pass，再清空该轴结论并独立完成 Spec pass。两轴证据和结论没有混合。直接 spec 已由任务指定，因此未使用 issue-tracker workflow。

## Standards

### STD-01：worker init cache 没有与 pool generation 同步收敛

- 严重度：medium
- 状态：closed
- 位置：`packages/client-core/src/content-runtime.ts:67-74`、`packages/client-core/src/content-runtime.ts:151-168`
- 标准：根 `AGENTS.md:31-36` 和 `packages/client-core/README.md:15-18` 将 worker-backed runtime、credential/license resolver 与 pool lifecycle 交给同一个 Client Core owner；该 owner 必须让 initialization state 与实际 worker lifecycle 保持一致，并避免无 worker 时长期保留 secret 或让同一 worker 的两条 authenticated path 使用不同 credential。
- 证据：`initByKey` 在 resolver promise 成功后永久保留，只在 resolver rejection、`instance-failed` 或 `evicted` 时删除。精确依赖 `@univer-cli/univer-collaboration-runtime-pool@1.0.0-beta.2` 的 create/open failure 会让 `pool.acquire()` reject，但创建阶段只产生 `create-start`，不会产生这里监听的 `instance-failed` 或 `evicted`，因此失败 worker 的 credential/license init 会继续缓存，后续请求即使 Session/license 已修复也仍复用旧值，直到 daemon 重启。另一个竞争窗口是 leased operation 先发 `instance-failed`、旧 lease 稍后 invalidate 并发 `evicted`：两事件之间新请求可写入新 init，旧 generation 的 `evicted` 会按 key 无条件删除该新 init。下一次 cache hit 将再次运行 resolver，并可能让 worker 内的 credential 与 parent-side embedded-image File API credential 来自不同 Session generations。
- 建议：让 cache entry 与一次 acquire/worker generation 的完成结果绑定。`pool.acquire()` 在 lease 形成前失败时清除当前 entry；成功形成或复用 lease 后，确保该 worker 对应的 init 仍是该 key 的 canonical entry，并防止旧 generation 的延迟 eviction 删除新 generation。增加两个确定性测试：create/open reject 后下一次请求重新解析 dependency；`instance-failed` 与 `evicted` 夹住并发 acquire 时，新 worker 后续 cache hit 不重复 resolver 且 parent/worker 使用同一 init。无需引入 credential store、rotation framework 或新 pool abstraction。

其余 Standards 检查通过：Client Core 是 worker、pool、synchronize、read/export、write/commit 与 embedded-image 的唯一 owner；CLI daemon/worker 已缩减为 Session/license/entry、RPC validation/delegation、socket和signal外壳；worker init 严格解析且 validation error 不含 secret；四种 raster 的 canonical base64、signature、20 MiB、digest dedup、immutable rewrite 与 per-image fallback 边界清楚；Change 4 file-transfer 没有被引入；root responsibility docs 与实际 owner 变化一致；public worker subpath和精确 SDK dependency没有额外 framework或 speculative abstraction。

Standards：1 finding，最高严重度 medium；1 open。

## Spec

### SPEC-01：新 worker 创建失败后不能重新取得当前 credential/license

- 严重度：medium
- 状态：closed
- 位置：`packages/client-core/src/content-runtime.ts:67-74`、`packages/client-core/src/content-runtime.ts:151-168`
- 规格：`design.md:45-51` 要求 resolver 只在新 worker 需要创建时执行，并在 pool 复用期间保持 worker backend；`specs/workspace-client-core/content-runtime/spec.md:7-24` 要求 Client Shell 提供当前 credential/license后启动或复用对应 runtime，并在 dependency 不可用时于新 worker 启动前失败。
- 证据：当前实现满足 same-key 正常 reuse，但只对 resolver 自身 rejection 清 cache。若 resolver 成功而 worker create/open 随后失败，`pool.acquire()` rejection 不清该 promise；此时没有任何 worker 可以复用，下一次操作仍不会向 Client Shell重新取得当前 credential/license。旧 worker failure/eviction 与并发新 acquire 的 key-only事件竞争还会删除新 init，使 pool 已复用 worker时 resolver反而重复执行。两种路径都偏离“只在新 worker 创建时解析”的既定时序，并可能破坏 CLI Session/license行为。
- 建议：按 STD-01 的最小 generation-safe cache 修复并覆盖 failure/eviction concurrency。测试应验证正常 same-key跨revision仍只解析一次、真正创建新 worker会重新解析、worker创建失败可在 dependency 修复后恢复；不增加主动 credential rotation或强制 eviction。

其余 Spec 检查通过：worker复用Change 5 target/Snapshot/reference owners并组成精确Trunk/Worktree endpoints；read/export保持dirty、pull conflict、exact revision、lossless value/UnitData和release语义；write保持Trunk/type/binding guard、no-mutation reuse、externalize→replace once→三次同一changeset commit以及失败invalidate；embedded images覆盖三种字段对和serialized resources、四raster、canonical base64、20 MiB、digest dedup、immutable rewrite与best-effort fallback；CLI三wire、Session/license source、daemon socket/control/signals、exchange/screenshot/inspect consumers和错误/输出边界未改变；Core worker subpath build、CLI installed artifact closure和root docs修改均在Change范围内。

验证证据：Client Core 15 files / 263 tests通过；Client Core build和root/worker import smoke通过；CLI typecheck与package verify通过；artifact无Client Core bare import或checkout path；限定 forbidden-owner搜索与`git diff --check`通过。

Spec：1 finding，最高严重度 medium；1 open。

## Summary

- Standards：1 finding，最高严重度 medium；1 open。
- Spec：1 finding，最高严重度 medium；1 open。
- 两轴指向同一个 worker-init generation 根因：2 个轴向 findings，1 个唯一修复项。
- 总 open findings：2；唯一 open root cause：1。

## Fix re-review：STD-01 / SPEC-01

复审日期：2026-08-28。限定产品修复范围：

```text
git diff fc2994e7e2ed484b922c4c353e91f99e07cb632e 681c23552a38997a2e67f0f570ad89d72f98e116 -- \
  packages/client-core/src/content-runtime.ts \
  packages/client-core/test/content-runtime.test.ts
```

系统 thread limit 只允许一个 closure reviewer 运行。Standards reviewer 完成并释放槽位后才启动独立 Spec reviewer；两轴分别读取证据并独立作结论，没有共享 findings。

### Standards closure check

`STD-01` 保持 **medium / open**。

修复已正确覆盖以下路径：

- resolver promise 或 `pool.acquire()` 在 lease 形成前 reject 时，只有 identity 相同的 cache entry 被删除；下一次调用会重新解析 credential/license。
- write failure 在 `lease.invalidate()` 前显式删除自己的 init entry，并忽略随后同一 invalidate 产生的 `evicted`，避免旧 generation 的该事件直接删除 failure 后创建的新 entry。
- credential resolver rejection 映射为既有 authentication error，error/cause/output 不携带 resolver secret；pool、HTTP 与 content 均未启动。
- 正常 same-key 跨 revision reuse、read/export release、write release/invalidate、owner close 与无新增 dependency/registry/credential abstraction 均保持。

仍未关闭的并发路径位于 `packages/client-core/src/content-runtime.ts:72-77`、`packages/client-core/src/content-runtime.ts:106-149` 和 `packages/client-core/src/content-runtime.ts:164-185`：请求 B 可以在旧 lease A 报 `instance-failed` 前读取旧 `initEntry` 并带着旧 init 进入上游 pool 的 FIFO waiters。A 随后清 cache 并 invalidate；请求 C 此时解析新 init并进入同一队列。pool 销毁旧 worker 后先使用 B 已捕获的旧 init 创建新 worker，再把 C 作为 cache hit 交给该 worker，但 Core 的 C 仍返回本地新 init。write 的 embedded-image HTTP 因此可使用新 credential，而 worker仍使用旧 credential。

TTL/LRU 还有同类 key-only event 窗口：上游 pool 先从cache移除idle instance并异步destroy，完成后才发`evicted`。该间隔内新 acquire可用旧cache entry形成新worker；延迟`evicted`仍会无条件删除该key当前entry，后续cache hit可再次解析不同init。新增测试覆盖了failure事件后才启动replacement acquire，以及直接发送TTL/LRU event后的刷新，没有覆盖FIFO pre-waiter或延迟TTL/LRU event跨越新generation。

建议保持最小修复边界：先添加上述两个确定性race fixtures，再让canonical init绑定到pool实际采用的worker generation；若当前SDK lease/event无法表达实际采用的init或generation，应最小补足该contract，不能继续用key-only event推断。无需引入credential store、主动rotation、runtime registry或通用pool wrapper。

Standards closure：1 finding，最高严重度 medium；1 open。

### Spec closure check

`SPEC-01` 保持 **medium / open**。

`design.md:45-51` 要求resolver只在新worker需要创建时执行，并在pool reuse期间保持同一backend/init时序。修复后的测试 `packages/client-core/test/content-runtime.test.ts:104-192` 把replacement请求安排在`instance-failed`清cache之后，因此没有覆盖一个同key waiter在failure之前已经携旧init排队的真实FIFO顺序。该waiter可创建旧credential worker，而稍后的请求返回新credential init并cache-hit同一worker，仍破坏parent File API与worker credential的一致性。

create/open reject后的dependency恢复、正常跨revision reuse、explicit write invalidation、lease finalization、resolver secret脱敏、无主动credential rotation和无scope creep均符合规格。Spec reviewer没有新增独立finding。

Spec closure：1 finding，最高严重度 medium；1 open。

### Re-review verification

- focused runtime：1 file / 26 tests通过。
- Client Core full：267 tests通过（Standards closure evidence）。
- Client Core typecheck通过。
- fix diff的`git diff --check`通过。
- 修复只修改runtime owner和direct tests；没有新增dependency、public abstraction或credential输出。

复审汇总：Standards 1 open；Spec 1 open；两轴仍指向同一个worker-init generation根因。总open findings为2，唯一open root cause为1。

## Second fix re-review：STD-01 / SPEC-01

复审日期：2026-08-28。限定产品修复范围：

```text
git diff 681c23552a38997a2e67f0f570ad89d72f98e116 fb940ff1b4a88db6e767929b5b7c052b66595b9f
```

系统 thread limit 仍占用已完成 reviewer 的槽位，无法重新启动两个 subagents。本轮由同一 review coordinator 顺序执行 Standards 与 Spec 两次独立 pass；完成 Standards 结论后才重新读取 Change 规格并进入 Spec pass。两轴分别记录证据和结论。

### Standards closure check

`STD-01` 状态改为 **medium / closed**。

- 位置：`packages/client-core/src/content-runtime.ts:69-77`、`packages/client-core/src/content-runtime.ts:88-168`、`packages/client-core/src/content-runtime.ts:173-215`
- 证据：`runForRuntimeKey` 把同一 runtime key 的 resolver、acquire、operation 与最终 release/invalidate 串成 FIFO。pre-failure waiter 在前一 operation 的 `finally` 完成前不会解析 init 或进入上游 pool；release、invalidate 或 acquire reject 也都会经过外层 `finally` 解锁。不同 key 没有共享队列。`initByKey` 继续用 identity delete，write failure 在 invalidate 前显式删除自己的 entry，acquire reject 只删除自己采用的 entry。
- 结论：此前“旧 init waiter 先于新 init waiter 创建 replacement worker”的路径已被消除，release/invalidate/acquire failure 也不会遗留阻塞或错误删除下一 generation。
- 建议：finding 已完整修复，无后续修改要求。

精确版本 patch 也通过 Standards 检查：

- 位置：`patches/@univer-cli__univer-collaboration-runtime-pool@1.0.0-beta.2.patch:1-22`、`pnpm-workspace.yaml:16-17`、`pnpm-lock.yaml:4-5`
- 证据：patch 只给固定的 `1.0.0-beta.2` ESM/type contract 增加 `destroy-start`；factory `destroy` 在第一次 `await worker.close()` 之前同步发送该事件。Core 在事件到达时清除旧 init，并忽略随后完成的 key-only `evicted`，因此 TTL/LRU 销毁窗口不能再删除 replacement generation。workspace 配置和 lockfile 使用同一个精确版本与 patch hash；离线 frozen install、Client Core build、CLI package build/verify/smoke 均采用该 patched dependency。仓库消费者使用 ESM import，安装包内已经包含 `destroy-start`，没有留下 bare Client Core import或checkout path。
- 结论：修改保持在既有 runtime pool seam 内，没有引入 credential store、rotation、第二个 pool 或通用并发框架；CLI source 和 wire/output/error owner 均未改变。

race tests 与缺陷顺序相符：`packages/client-core/test/content-runtime.test.ts:104-207` 在 failure 发生前启动 waiter，并断言它直到旧 lease invalidate 完成都没有调用 resolver/acquire；恢复后的 replacement 与随后 cache hit 使用同一 init，embedded-image HTTP 使用新 credential。`packages/client-core/test/content-runtime.test.ts:209-255` 让 replacement 生成后再发送延迟 TTL/LRU `evicted`，证明旧完成事件不会清掉新 entry。`packages/client-core/test/runtime-pool-events.test.ts:4-26` 通过真实 patched pool 验证 `destroy-start` 先于 `evicted`；patch 本身保证该通知发生在 worker close 的首次 await 之前。

Standards second closure：0 open，pass。

### Spec closure check

`SPEC-01` 状态改为 **medium / closed**。

- 位置：`packages/client-core/src/content-runtime.ts:88-168`、`packages/client-core/src/content-runtime.ts:173-215`
- 规格：`design.md:45-51`；`specs/workspace-client-core/content-runtime/spec.md:7-24`
- 证据：正常 same-key reuse 仍只解析一次 dependency；真正的 create/open failure、worker failure、explicit write invalidation 或 TTL/LRU destroy 会在下一 worker 创建前重新取得当前 credential/license。Core 现在先完成前一 generation 的 lease finalization，再让下一请求解析 init并 acquire，因此 worker init 与 parent-side embedded-image File API 使用同一 Session generation。resolver rejection 的既有 authentication mapping 和 secret-free error/output 保持不变。
- 结论：新 worker 的 dependency timing、pool reuse 与 invalidation 语义已经满足规格。per-key 顺序与上游同 key FIFO 的既有可观察顺序一致；CLI command、daemon wire、Session/license source、输出与错误行为均未改变。固定版本的本地 dependency patch 是现有 pool lifecycle seam 的最小补足，没有新增公开 Client Core API、主动 credential rotation 或规格外 runtime policy。
- 建议：finding 已完整修复，无后续修改要求。

Spec second closure：0 open，pass；未发现 regression、错误实现或 scope creep。

### Second re-review verification

- `pnpm install --frozen-lockfile --offline`：通过。
- Client Core typecheck：通过。
- Client Core full test：16 files / 270 tests通过。
- Client Core build：通过。
- `pnpm package:workspace-cli`：通过。
- CLI package verify：通过，203 files，packed 13,029,076 bytes，unpacked 58,134,881 bytes。
- CLI installed-tarball package smoke：通过。
- packaged runtime-pool chunk包含`destroy-start`；artifact没有Client Core bare import或checkout path。
- fixture与packaged daemon `node --check`：通过。
- fixed diff `git diff --check`：通过。

第二轮复审汇总：Standards 0 open；Spec 0 open。`STD-01` 与 `SPEC-01` 均 closed；总 open findings 为 0，accepted-risk 为 0。
