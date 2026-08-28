# extract-runtime-target-client-core Code Review

审查范围：`git diff 33a49d2baaca732dd5bea7850b00877eb55011b4 40f5396ae270b113c29cb5b2946a3647203344ef`

已完整使用 `mattpocock-skills:code-review` 的 Standards/Spec 双轴流程。系统 thread limit 在启动第一个 reviewer 时即拒绝请求；review coordinator 因此先完成 Standards pass，再清空该轴结论并独立完成 Spec pass。两轴证据和结论没有混合。直接 spec 已由任务指定，因此未使用缺失的 issue-tracker workflow。

## Standards

### STD-01：runtime smoke fixture 不拥有 upgraded socket 的清理

- 严重度：medium
- 状态：closed
- 位置：`apps/cli/scripts/smoke-package.mjs:471-489`、`apps/cli/scripts/smoke-package.mjs:909-1011`
- 标准与证据：根 `AGENTS.md:125-136` 要求实际验证 CLI artifact；这种 fixture 也必须在成功和失败路径可靠释放资源。`upgrade` 接受 WebSocket 后没有记录 socket，fixture `close()` 只关闭两个 HTTP server。`finally` 虽尝试 `daemon stop`，但忽略 `spawnSync` 的失败；如果 inspect/assertion 或 daemon shutdown 异常，upgraded socket 仍可保持事件循环活跃，使 package smoke 卡住或泄漏 worker 连接。
- 建议：fixture 用一个 `Set` 跟踪 accepted sockets，在 socket `close` 时移除，并在 fixture `close()` 中先 `destroy()` 剩余 sockets，再关闭 HTTP servers。无需引入 WebSocket dependency 或通用 server abstraction。

raw WebSocket fixture 有实际用途：它让 installed tarball 从临时 cwd/home 启动真实 daemon/worker，并执行 authenticated runtime-backed inspect。限定协议只处理 smoke 所需的小型 HELLO/JOIN/HEARTBEAT 文本帧；现有 framing、mask 解码与成功路径未发现错误。没有因 fixture 行数本身报 finding。

其余检查通过：target/source/reference 只有 Client Core owner；CLI 旧 owner 和重复 serializers 已删除；parser、strict base64、错误合同、revision-independent key、SDK baseline、Asset 排除与 package root imports 符合仓库标准。direct source 与 SDK adapter 保留不同错误合同，未要求为消除少量 decoder 重复建立通用 framework。

Standards：1 个历史 finding，最高严重度 medium；0 open。

## Spec

PASS，0 findings。

- target parser 保持 HTTP(S) origin、identity、Unit type、safe revision 与 exact scope 校验；plain serializer 保持 wire shape，runtime key只忽略 revision，其他 identity components 经编码后互不碰撞。
- Worktree resolution 复用 Change 3 strict owner；editable Draft、membership、draft revision 和 Trunk Sheet→Doc→Slide→Base→Board probe order均有直接覆盖，只有精确 stored-type-mismatch 继续探测。
- direct source 与 Snapshot adapter 分别验证 scope endpoint、Snapshot/changeset/block/resource/protocol envelope identity、strict base64、head revision和 read-only write rejection，并保留各自既有错误 code/message。
- reference host/context/provider 保持 mapped Worktree 与 unmapped Trunk fallback、v1 metadata Unit绑定、五种 self Unit loader、already-aborted 和 loaded identity/type checks。
- CLI 只切换 target/source/reference imports和 canonical serializer；Session、daemon socket/runtime pool、worker lifecycle、license、Collaboration composition、Asset image resolution和被排除 workflows仍由原 owner负责。
- package manifest只增加同一精确 SDK baseline依赖；installed smoke从临时安装启动真实 daemon/worker，读取 Worktree Snapshot并完成 `inspect range`，同时核对 worker role/PID和endpoint。raw socket fixture没有替代实际 runtime process。

聚焦验证：Client Core 4 files、66/66 tests通过；相关 `git diff --check` 通过。未发现 missing、partial、scope creep或错误实现。

Spec：0 findings，PASS。

## Summary

- Standards：1 个历史 finding，最高严重度 medium；0 open。
- Spec：0 findings，PASS。
- 总 open：0。

## Fix re-review：STD-01

复审日期：2026-08-28。产品修复范围：

```text
git diff 40f5396ae270b113c29cb5b2946a3647203344ef 8ffc9d4df36cea8acd3a1a932275e947eb62bbbb
```

系统 thread limit 阻止同时启动两个 closure reviewer，因此 Standards 完成后才启动 Spec；两轴由独立 subagent 执行，没有共享结论。

### Standards closure check

PASS，`STD-01` closed。有效 upgrade 成功后 socket 才加入局部 `Set`，socket `close` 事件负责移除；fixture teardown 在 `server.close()` 前同步 `destroy()` 所有残留 accepted sockets。invalid upgrade 继续立即 destroy 且不进入 Set；重复调用 `collaboration.close()` 安全；正常关闭和失败路径都由同一 fixture owner 收敛。

限定 diff 只增加 7 行资源清理，没有新增依赖、抽象、协议行为或范围扩张。`node --check apps/cli/scripts/smoke-package.mjs` 与限定 diff 的 `git diff --check` 通过。

### Spec closure check

PASS，0 findings。修复只改变 package smoke fixture 的资源回收，不触及 runtime target/source/reference 实现、CLI contract、serializer、错误语义或 installed runtime 行为。未发现 scope creep 或 regression。

复审汇总：Standards 0 open；Spec 0 open；总 open 0。
