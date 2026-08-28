# extract-auth-client-core Code Review

审查范围：`git diff 7c321d9ef0e44a62578fccd77cee15b8b753f500 5b3823b4cd833cd81c7ef515694181481c47a93a`

Standards 与 Spec 由两个独立 subagent 审查。系统 thread limit 阻止同时启动第二个 reviewer，因此 Standards 完成后才启动 Spec；两轴没有共享结论。

## Standards

### STD-01：browser completion 未绑定 HTTP origin 与 pending origin

- 严重度：medium
- 状态：closed
- 位置：`packages/client-core/src/auth.ts:86-112`
- 标准与判断：`AGENTS.md:30-32` 将 origin、Session 与凭据注入边界交给 Client Shell 和 storage-neutral Core protocol；此处两个 origin primitive 共同决定 device code 的目标与返回 Session 的归属，属于 Data Clump / Primitive Obsession 判断项。
- 证据：`completeCliLogin(http, pending)` 未验证 `http.origin === pending.origin`。函数将 `pending.deviceCode` 发往 `http.origin`，成功后却调用 `authenticationFromResponse(pending.origin, ...)`，可能向错误 Workspace 泄露 device code，并把该 Workspace 返回的 Session cookie 标记为另一个 origin。当前 CLI facade 使用 `pending.origin` 构造 HTTP，不能替代 Core trust-boundary 校验。
- 建议：发送请求前严格比较两个 normalized origin；不相等时返回既有 `workspace-origin-mismatch`，并补充断言 fetcher 未调用的测试。无需增加 credential store、identity framework 或新抽象。

其余 owner 划分、private package 依赖方向、Session `0600` 原子替换、mutation queue、secret 输出检查，以及 build/package smoke 修改均符合仓库文档。Standards：1 finding，最高严重度 medium。

## Spec

PASS，0 findings。

- Core 覆盖 password login、browser approval start/complete、`whoami` 和 remote logout；严格解析 User、Session Cookie 与 pending response，并保持 storage-neutral。
- verification URL 拒绝跨 origin、embedded credentials 和非法 URL；complete 在过期时不请求，HTTP 202 只交换一次且不轮询。
- CLI 保留 Session/pending byte schema、原子写入、mutation queue、过期清理和 logout `finally` local-clear ownership。
- 命令交互及 secret 输出边界未变；installed fixture 覆盖 start → pending → success → whoami → authenticated Space read → logout，并检查 request count 与 cookie/device code 不泄露。
- diff 未修改 Workspace Server contract，也未引入 credential store、identity framework 或 compatibility layer。

Spec：0 findings，PASS。

## Summary

- Standards：1 个历史 finding，最高严重度 medium；0 open。
- Spec：0 findings，PASS。
- 总 open：0。

## Fix re-review：STD-01

复审日期：2026-08-28。复审范围：

```text
git diff 5b3823b4cd833cd81c7ef515694181481c47a93a f89949bdd302f6fdbf615fc4bcfad80205d627eb -- packages/client-core/src/auth.ts packages/client-core/test/auth.test.ts
```

系统 thread limit 阻止同时启动两个 closure reviewer，因此 Standards 完成后才启动 Spec；两轴仍由独立 subagent 执行，没有共享结论。

### Standards closure check

PASS，`STD-01` closed，0 open findings。`packages/client-core/src/auth.ts:97-102` 在 exchange 请求前严格比较 `http.origin` 与 `pending.origin`，不一致时返回既有 `workspace-origin-mismatch`。成功分支使用已校验的 `http.origin` 标记认证结果。测试断言 fetcher 未调用且错误消息不包含 device code。未发现新增 standards regression 或 smell。

### Spec closure check

PASS，0 findings。过期检查仍优先执行且不发请求；origin 一致后仍只执行一次 exchange，pending/authenticated 分支不变。由于两个 origin 已相等，成功结果改用 `http.origin` 不改变外部结果。修复没有泄露 device code、Cookie 或其他 secret，也没有引入 scope creep。

Client Core 4 个测试文件、60/60 tests 通过；限定 diff 的 `git diff --check` 通过。

复审汇总：Standards 0 open；Spec 0 open；总 open 0。
