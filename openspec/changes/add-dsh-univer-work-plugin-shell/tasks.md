## 1. 建立 Host-only application package

- [ ] 1.1 在 `apps/dsh-univer-work` 添加 `dsh-univer-work@0.0.0` private ESM manifest、精确 DSH/Cordis baseline、TypeScript/Vitest 配置、package README 与最小 scripts，更新 `pnpm-lock.yaml`；运行 `pnpm --filter dsh-univer-work typecheck`，并检查 manifest 保持 `private: true`、不声明 `dsh.client`、Client Core 或任何后续能力依赖。

## 2. 接入 Cordis bundle lifecycle

- [ ] 2.1 添加预构建 Host entry 与 `cordis.patch.yml`，使 `dsh.bundle.patch` 插入唯一且启用的 `dsh-univer-work` Loader row；用 focused tests 验证 manifest/patch/entry 名称一致，并通过真实 Cordis composition 证明 built entry load、fiber dispose 和 owned effect 清理在 dispose 返回前完成。

## 3. 固定预构建 artifact 闭包

- [ ] 3.1 添加最小 artifact verification，构建后执行 `pnpm --filter dsh-univer-work package:verify`，断言 pack 文件列表包含 Host output、patch、README 与 Apache-2.0 license，所有 manifest targets 存在，且 artifact 无 `prepare`/install-time build、source entry、相邻 checkout path、Web/Skills/tools/runtime placeholder 或未声明文件。

## 4. 验证隔离 profile 安装与启动

- [ ] 4.1 用 Node standard library 和已安装的 `@deepseek-ai/dsh@0.1.1-rc.2` 实现 bounded `package:smoke`：从已构建 tarball 安装到临时 `DSH_HOME` local profile，验证 ordered bundle membership、`--dump-config` layer/Loader row、fresh Host start、正常终止与 deadline diagnostics，并在成功或失败后只清理该临时根；运行 `pnpm --filter dsh-univer-work package:smoke`。

## 5. 记录新的 Workspace Agent Client owner

- [ ] 5.1 将 Workspace Agent Client、Workspace Client Core 与 Client Shell 术语及共仓决策迁入 `apps/workspace/CONTEXT.md` 和 `apps/workspace/docs/adr`，更新 `README.md`、`AGENTS.md`、`DREAMNUM.md` 与 package README 的仓库布局、职责、非职责、local Host-only 范围和 private/no-release 状态；检查链接、路径与文字不把认证、tools、Skills、Web Client 或 CLI parity 写成当前事实。

## 6. 运行集成验收

- [ ] 6.1 依次运行 `pnpm --filter dsh-univer-work typecheck`、`pnpm --filter dsh-univer-work test`、`pnpm --filter dsh-univer-work build`、`pnpm --filter dsh-univer-work package:verify`、`pnpm --filter dsh-univer-work package:smoke`、`pnpm typecheck`、`pnpm test`、`pnpm build` 和 `git diff --check`；确认 Workspace Server/Browser、OpenAPI、数据库、Client Core、Workspace CLI 行为/package/release 与 SDK `1.0.0-beta.2` baseline 均未改变。
