# extract-file-transfer-client-core Code Review

审查范围：`git diff 20bbc9bc6cc2bea29e8fa50706e40401425d0a7a ea39f8cc6af8958faf7a9138d59971cfb4082519`

Standards 与 Spec 由两个独立 subagent 审查。系统 thread limit 阻止同时启动第二个 reviewer，因此 Standards 完成后才启动 Spec；两轴没有共享结论。QA 报告只作为线索，两轴分别核对了 `FT-QA-001/002`。

## Standards

### STD-01：completion recovery 的二次 read-back 脱离 reserved identity

- 严重度：high
- 状态：closed
- 位置：`packages/client-core/src/blob.ts:135-140`
- 标准与证据：`complete()` 返回未知结果后，外层再次读取 Upload Session 只执行 `assertUploadIntent`，没有与初始 `reserved` Operation、Node、Resource identity 比较。同 name/size 但 identity 已替换的 envelope 会进入下一轮并可能成功发布，违反根 `AGENTS.md:65-66` 对 Operation、idempotency 和 recovery 明确收敛的要求。独立源码路径核对确认 `FT-QA-001` 成立。
- 建议：该次 `getEnvelope()` 后立即调用 `assertUploadIdentity(envelope, reserved)`，并增加覆盖二次 read-back identity 替换的回归测试。

### STD-02：公开 maxAttempts 可破坏 bounded recovery

- 严重度：medium
- 状态：closed
- 位置：`packages/client-core/src/blob.ts:80-84`、`packages/client-core/src/blob.ts:115-124`
- 标准与证据：公开构造器接受任意 `maxAttempts`，但未要求有限正整数。`Infinity` 可造成无限 recovery 请求，`0` 会跳过状态机；这违反 `packages/client-core/README.md:13` 声明的 bounded recovery。仓库真实 consumer 都使用默认值，该参数属于 possible Speculative Generality。
- 建议：删除参数并使用固定常量 `3`；如果测试确实需要注入，至少限制为 `1..3` 的安全整数。无需建立 retry policy abstraction。

owner 删除、文件安全与资源清理、CLI/FS 依赖方向均通过；没有要求 hash、resume、cancellation 或 remote FS。

Standards：2 个历史 findings，最高严重度 high；0 open。

## Spec

### SPEC-01：recovery 接受替换后的 Operation/Node/Resource identity

- 严重度：high
- 状态：closed
- 位置：`packages/client-core/src/blob.ts:135-140`
- 规格证据：`file-transfer/spec.md:23` 要求 one stable upload intent；`:28` 要求拒绝 identity 不同的 recovered Operation 或 Upload Session。
- 实现证据：completion unknown 后的外层第二次 `getEnvelope()` 只验证 intent，未与初始 `reserved` 比较 identity；同一 upload intent 下替换 Operation、Node、Resource 后可成功返回替换后的 Resource。独立确认 `FT-QA-001`。
- 建议：refresh 后绑定 `reserved` identity，并增加替换 identity 后不得再次 complete 或成功返回 Resource 的测试。

### SPEC-02：published Resource read-back unknown 丢失 stable public upload identity

- 严重度：medium
- 状态：closed
- 位置：`packages/client-core/src/blob.ts:296-313`
- 规格证据：`file-transfer/spec.md:37-38` 要求无法确认 published Blob Resource 时返回既有 structured result-unknown，并携带 stable public upload identity。
- 实现证据：`completedResult()` 直接传播 `getBlob()` 的 network unknown，detail 只剩 `{ cause }`，缺少 `idempotencyKey`、`sourcePath`、`spaceId` 及可用的 upload identity。独立确认 `FT-QA-002`。
- 建议：只捕获 `workspace-result-unknown`，用既有 code 重抛并补充 stable public intent、`uploadId`/state；不得加入 Cookie 或 response body。

其余 local file、Blob、Asset 与 CLI/package scenarios 未发现 missing、错误实现或 scope creep。

Spec：2 个历史 findings，最高严重度 high；0 open。

## Summary

- Standards：2 个历史 findings，最高严重度 high；0 open。
- Spec：2 个历史 findings，最高严重度 high；0 open。
- 两轴共 4 条 finding，代表 3 个独立根因；`STD-01` 与 `SPEC-01` 是同一缺陷的不同审查轴。

## Fix re-review

复审日期：2026-08-28。产品修复范围：

```text
git diff ea39f8cc6af8958faf7a9138d59971cfb4082519 9fd60bfe9cce5fd5670879d82f859086259d00bd -- packages/client-core/src/blob.ts packages/client-core/test/file-transfer.test.ts
```

系统 thread limit 阻止同时启动两个 closure reviewer，因此 Standards 完成后才启动 Spec；两轴仍由独立 subagent 执行，没有共享结论。

### Standards closure check

- `STD-01` closed。completion unknown 后的第二次 Session read-back 立即调用 `assertUploadIdentity(envelope, reserved)`；替换 Operation、Node 或 Resource identity 时，在再次 complete 或 Resource read-back 前返回 `workspace-result-mismatch`。
- `STD-02` closed。公开构造器的 `maxAttempts` 已删除；reservation、状态机和 byte upload 统一使用内部常量 `BLOB_UPLOAD_MAX_ATTEMPTS = 3`，外部调用者不能关闭或无限扩大 recovery bound。

未发现新增 regression、policy abstraction、重复逻辑或 smell。`file-transfer.test.ts` 23/23 tests 与限定 diff 的 `git diff --check` 通过。

### Spec closure check

- `SPEC-01` closed。回归测试证明 identity 替换后不会再次 complete，也不会读取或成功返回替换后的 Resource。
- `SPEC-02` closed。published Resource read-back unknown 保留既有 code/message，并补齐 stable public upload intent、`uploadId`、`state` 与受限 cause。

固定三次 recovery 没有改变 CLI 命令、参数或输出合同。未发现 scope creep 或 regression；Spec 定向 4/4 tests 通过。

复审汇总：Standards 0 open；Spec 0 open；总 open 0。
