# Client ID Metadata Documents（F2）设计

> 状态：已实现（2026-11-09）。设计经两轮对抗评审并按第 8 节修订。对应 [architecture](architecture.zh-CN.md) 4.4 节 F2、[stages](stages.zh-CN.md) 阶段 F。
> 规范依据：`draft-ietf-oauth-client-id-metadata-document-03`（下称“草案”）；MCP 授权规范 2025-11-25 起优先 CIMD、弃用 DCR。

## 1. 要解决的问题

Claude Code、Claude（Web、Desktop）和 VS Code 用一个 https URL 作为 `client_id`，授权服务器抓取该 URL 上的 JSON 得到客户端元数据，不需要先注册。
Workspace 目前只支持 DCR，授权服务器元数据不声明 `client_id_metadata_document_supported`，这些客户端只能退回 DCR，而 MCP 规范已在弃用 DCR。

抓取由客户端指定的 URL 就是 SSRF 面：攻击者可以让 Workspace Server 访问内网地址、云元数据端点，或者把 `/authorize` 当作对第三方的放大器。PR #216 因此推迟了 F2。

2026-11-09 实测的两份公开文档：

| client_id | 要点 |
| --- | --- |
| `https://claude.ai/oauth/claude-code-client-metadata` | `redirect_uris` 是不带端口的 `http://localhost/callback`、`http://127.0.0.1/callback`；`cache-control: public, max-age=300` |
| `https://vscode.dev/oauth/client-metadata.json` | `grant_types` 含 `urn:ietf:params:oauth:grant-type:device_code`；`cache-control: no-store` |

## 2. 数据形状

客户端来源按 `client_id` 的形状一次判定，判定结果是一个带标签的联合，不在各处散落 `startsWith("https://")`：

```ts
type ClientSource =
  | { kind: "static"; client: OAuthClient }          // OAUTH_CLIENTS_JSON，规则不变
  | { kind: "dcr"; client: OAuthClientRecord }        // oauth_clients 表，client_id 是 UUID
  | { kind: "cimd"; clientId: CimdClientId };         // 已通过 URL 语法校验，尚未抓取

interface CimdClient {                                // 抓取并校验后的文档，只存内存
  clientId: CimdClientId;                             // 品牌类型，等于文档里的 client_id
  clientName: string | null;
  host: string;                                       // 同意页展示用
  redirectUris: readonly string[];
  grantTypes: readonly ("authorization_code" | "refresh_token")[];
  expiresAt: number;                                  // 缓存到期时间
}
```

授权和同意需要 `CimdClient`（为了 `redirect_uris` 和名称）。token 端点和吊销端点只需要 `ClientSource` 为 `cimd`：授权码和 grant 已经绑定 `client_id`、`redirect_uri` 与 PKCE，不需要再抓文档。

## 3. 决定

### 3.1 不落库

CIMD 客户端不写 `oauth_clients`，不改 schema，不占 `MCP_MAX_REGISTERED_CLIENTS`。
`oauth_grants.client_id` 直接存 URL；该列没有外键，`issueGrant` 里更新 `oauth_clients.last_used_at` 的语句对 URL 不命中任何行，无害。
文档缓存在进程内存里。Workspace Server 的授权码本来就存在内存里（`authorizationStore`），是单进程部署，内存缓存不引入新的多实例问题。

### 3.2 `client_id` 语法（草案第 3 节）

接受条件：`https:` scheme；没有 userinfo；路径不是 `/`；没有 query；没有 fragment；长度不超过 2000。`.`、`..` 段（含 `%2e` 编码形式）在原始字符串上检查：`new URL()` 会先规范化路径，在解析结果上检查等于没有检查。
拒绝等于本服务 issuer 或任一 `MCP_RESOURCE_URLS` 的 URL（草案 10.1）。比较一律是原样字符串比较，不做规范化。
query 在草案里是 SHOULD NOT，这里直接拒绝，少一类边界情况；目前已知的客户端都不带 query。

### 3.3 抓取器

只用 Node 标准库 `node:https`，不加依赖。

- 只发 GET，`accept: application/json`，不带 cookie 或任何用户相关头。
- 每次请求显式传入专用的 `https.Agent`。Node 24 在设置 `NODE_USE_ENV_PROXY` 或 `--use-env-proxy` 时，默认 agent 会经 `HTTPS_PROXY` 建隧道，`lookup` 不被调用，地址检查整个失效。专用 agent 不读代理环境变量。
- 地址校验在连接层做，避免 DNS rebinding：专用 agent 的 `lookup` 按 Node 的调用约定（`{ all: true }`）解析，逐个检查全部地址，任何一个被拒绝就整个失败，连接只用检查过的地址。
- 主机名是 IP 字面量时 Node 不调用 `lookup`，所以请求前单独检查。`URL.hostname` 对 IPv6 保留方括号，`net.isIP("[::1]")` 返回 0，必须先去掉方括号再判断。
- 拒绝的地址段用一个 `net.BlockList` 表达（RFC 6890 及后续登记）：IPv4 的 `0/8`、`10/8`、`100.64/10`、`127/8`、`169.254/16`、`172.16/12`、`192.0.0/24`、`192.0.2/24`、`192.88.99/24`、`192.168/16`、`198.18/15`、`198.51.100/24`、`203.0.113/24`、`224/4`、`240/4`；IPv6 的 `::/96`（含 `::` 与 IPv4 兼容地址）、`::1/128`、`64:ff9b::/96`、`64:ff9b:1::/48`、`100::/64`、`2001::/23`、`2001:db8::/32`、`2002::/16`、`fc00::/7`、`fe80::/10`、`ff00::/8`。不加 `::ffff:0:0/96`：`BlockList` 已经把 IPv4 规则套用到对应的 IPv4 映射地址，再加这一段会把所有公网 IPv4 一起拒绝。
- 部署可以用 `MCP_CIMD_EXEMPT_NETWORKS`（逗号分隔的 CIDR，默认空）豁免个别网段，供经 fake-IP 或 TUN 出网的环境使用：这类环境把公网域名解析到 `198.18/15`，不豁免就无法抓取任何文档。启动时拒绝与 `127/8`、`::1`、`169.254/16`、`fe80::/10` 重叠的值，所以 loopback 和云元数据地址无论如何都不可达。
- 不跟随重定向，非 200 一律失败（草案 6.1）。
- 正文读到 5 KB 即中止并失败（草案建议值）。总时长 5 秒，用计时器在到期时销毁请求；`timeout` 选项只是空闲超时，逐字节慢速发送的服务器可以一直占住连接。
- 并发：同一 `client_id` 的并发请求合并为一个；每个用户同时最多 1 个抓取；全局同时最多 32 个。超出直接失败，不排队。
- 不提供 loopback 例外，开发环境也不提供。本地验证用真实的公开文档（第 5 节）。

### 3.4 校验（草案第 4 至 6 节）

- 必须是 JSON 对象，`client_id` 与请求的 URL 字符串相等。
- 出现 `client_secret`、`client_secret_expires_at`、`jwks`、`jwks_uri` 任一字段即拒绝。
- 认证方式：两个字段都没有时按 `none`。有 `token_endpoint_auth_methods_supported` 时必须包含 `none`；有 `token_endpoint_auth_method` 时必须是 `none`。否则 `invalid_client`。
- `grant_types` 缺省为 `["authorization_code"]`，与 `{authorization_code, refresh_token}` 取交集，交集必须含 `authorization_code`。`response_types` 缺省为 `["code"]`，交集必须含 `code`。未知值忽略，不报错（VS Code 的 `device_code`）。
- `redirect_uris` 必须是 1 到 10 个，每一个都按 DCR 的同一函数 `registrableRedirectUri` 校验，所以 loopback、https、反向域名 scheme 和私有 scheme 白名单的规则与 DCR 完全一致；loopback 仍按 RFC 8252 7.3 匹配任意端口，Claude Code 文档里不带端口的地址因此可用。
- `client_name` 是不超过 100 字符的字符串时采用，否则忽略并只显示主机名。文档是第三方的，名称不合规不值得让登录失败。
- `logo_uri` 不使用（草案要求预取并由本服务转发，收益小，以后需要再加）。

### 3.5 缓存（草案 6.2）

- 只缓存校验通过的文档，错误和无效文档不缓存。
- 有效期取 `cache-control: max-age`，夹在 5 分钟到 24 小时之间；没有 `max-age` 或是 `no-store`、`no-cache` 时取 5 分钟下限。
- 最多 1000 条，满了先淘汰过期项，再淘汰最早插入的。
- 过期的条目保留到抓取时间起 24 小时。重新抓取遇到并发上限或临时失败（网络错误、超时、5xx）时，继续使用这份旧文档（草案要求临时失败不丢弃有效缓存）。这样攻击者占满抓取并发，也只能阻止从未见过的客户端首次登录，已经用过的客户端不受影响。文档变为无效（4xx、校验失败、`client_id` 不符）时删除该条目。

### 3.6 流程变更

`GET /api/auth/authorize` 与 `GET /api/auth/authorize/consent`：

1. 解析 `ClientSource`。`cimd` 时先检查是否登录。未登录直接重定向到登录页，不抓取。默认开启的密码注册让任何人都能拿到 session，所以这一步不是访问控制，只是让每次抓取都能归属到一个用户，供 3.3 的每用户并发上限使用。
2. 已登录时抓取或命中缓存，得到 `CimdClient`，之后与 DCR 客户端走同一条 `parseMcpAuthorizationRequest`。
3. 抓取或校验失败时显示错误页（400，可重试的网络错误为 503），不重定向回客户端（草案 6.1，此时 `redirect_uri` 未经验证）。

`POST /api/auth/authorize/consent`：使用同意页保存的请求，不重新抓取。

`POST /api/auth/token` 与 `POST /api/auth/revoke`：`cimd` 客户端只做语法校验，不抓取。refresh 不重新抓取文档：refresh 不涉及重定向，文档变化只影响下一次授权。草案建议定期重新抓取并在 `client_id` 不再匹配时吊销 refresh token，这里推迟，见第 7 节。

对 MCP 客户端（DCR 和 CIMD）的每一个授权响应增加 `iss` 参数，包括成功、错误重定向和拒绝（RFC 9207，草案第 7 节要求）。授权服务器元数据增加 `authorization_response_iss_parameter_supported: true`。成功回调与静态客户端共用同一个构造函数，只在 MCP 请求上加 `iss`，静态客户端的回调不变。

### 3.7 同意页

CIMD 客户端显示文档里的名称和 `client_id` 的主机名，例如 `Claude Code (claude.ai)`（草案 10.6、10.9）。没有名称时只显示主机名。
DCR 客户端的显示不变。

### 3.8 开关

新增 `MCP_CIMD_ENABLED`，默认开启，只在 `MCP_RESOURCE_URLS` 已设置时有意义。关闭时元数据不声明支持，URL 形状的 `client_id` 按未知客户端处理。`MCP_CIMD_EXEMPT_NETWORKS` 见 3.3。
理由：声明支持后 Claude 会优先走 CIMD；没有出网能力的私有部署抓取必然失败，Claude 不会退回 DCR（Claude Code issue #84263 就是这种失败），这类部署需要能关掉它。

### 3.9 用量与网关

网关不需要改动。token exchange 返回的 `subject.client_id` 是 URL，用量事件的 `client_id` 因此是 URL，可以直接看出是哪个客户端。

## 4. 代码落点

| 文件 | 内容 |
| --- | --- |
| `apps/workspace/server/src/modules/identity/client-metadata-document.ts`（新） | `CimdClientId` 语法解析、`fetchClientMetadataDocument`（3.3）、`parseClientMetadataDocument`（3.4）、带缓存和并发合并的解析器（3.5）。抓取函数以参数注入，测试不出网 |
| `mcp-oauth.ts` | 元数据增加两个字段；`ClientSource` 判定 |
| `oauth-authorization-router.ts` | 3.6、3.7 的流程；`iss` |
| `config.ts`、`app.ts` | `MCP_CIMD_ENABLED`、`MCP_CIMD_EXEMPT_NETWORKS` |
| `contracts/http`、`generated/http` | 元数据字段、`client_id` 的描述、新的错误响应；运行 `api:verify` |
| `apps/workspace/README.md` | 配置项与行为 |

## 5. 验证

单元与集成测试（不出网，抓取函数注入）：语法规则逐条（含 `%2e%2e`）；地址段逐个（含方括号 IPv6 字面量、IPv4 映射与兼容地址、公网 IPv4 不被误拒）；`lookup` 以 `{ all: true }` 调用时的行为；设置 `NODE_USE_ENV_PROXY=1` 与 `HTTPS_PROXY` 时仍走地址检查；豁免网段及其启动校验；重定向、非 200、超过 5 KB、慢速发送超过 5 秒；每用户与全局并发上限；过期缓存在临时失败时继续使用；文档校验逐条；缓存有效期的夹取；未登录不抓取；失败时不重定向；`iss` 出现在成功、错误和拒绝三种 MCP 回调上，不出现在静态客户端回调上。

`verify-uvw` 新旅程 MO3（需要出网）。主机 DNS 返回 `198.18/15` 地址（fake-IP 代理）时，`up` 只为 Workspace Server 设置 `MCP_CIMD_EXEMPT_NETWORKS=198.18.0.0/15`，其余拒绝用例不受影响：

1. 发现文档声明 `client_id_metadata_document_supported: true` 与 `authorization_response_iss_parameter_supported: true`。
2. 以 Claude Code 的真实 `client_id` 走完整流程：脚本扮演客户端，在本机 loopback 端口监听回调，生成 PKCE；agent-browser 登录并在同意页看到“Claude Code（claude.ai）”（截图）；回调带 `code`、`state`、`iss`；兑换 token，经网关调用 `whoami` 成功，用量事件 `client_id` 是该 URL；refresh 成功；吊销后访问 Workspace 的调用返回 401。
3. 以 VS Code 的真实 `client_id` 进入同意页，证明多出的 `device_code` 被忽略。
4. 拒绝路径，每一条都看到错误页且没有重定向：`https://127.0.0.1/x`；`https://[::1]/x`；解析到 loopback 的域名（DNS 正常的主机用 `localtest.me`；fake-IP 主机会把这类公网域名改写成 `198.18/15` 地址，改用系统解析的 `localhost`，并记录公网域名的实际解析结果）；带 query 的 `client_id`；`client_id` 与文档不符（对 VS Code 文档 URL 加尾随路径或换大小写，服务器返回的不是同一文档或文档里 `client_id` 不相等）；未登录访问时服务器没有发出抓取（看 Server 日志）。
5. `MCP_CIMD_ENABLED=0` 时元数据不声明支持，Claude Code 的 `client_id` 返回未知客户端。

可选：用本机安装的 Claude Code 对本地 MCP 走真实的 `/mcp` 登录，作为真实客户端的补充证据。

## 6. 不做

- logo 预取与转发。
- 抓取 `jwks_uri`，以及 `private_key_jwt` 认证。
- 客户端 URL 的允许列表、域名年龄检查等信任策略（草案 10.8 是非规范性建议）。
- 开发环境的 loopback 抓取例外。

## 7. 推迟

- 定期重新抓取，以及文档变为无效时吊销该客户端的 refresh token（草案 6.1、6.2 的 SHOULD）。目前文档只在授权时使用，影响限于已签发的 refresh token 在文档撤下后仍可续期，最长 30 天。需要时在 refresh 路径上增加“缓存过期则重新抓取，终止性失败则吊销该 grant”。

## 8. 评审记录（2026-11-09）

两名评审（opus、sonnet）对照 Node 24.19 与当前代码用探针复现了以下问题，第 3 节已按此修订：

| 问题 | 修订 |
| --- | --- |
| 设置 `NODE_USE_ENV_PROXY` 时默认 agent 走代理，`lookup` 不被调用 | 3.3 显式专用 agent |
| `net.isIP(url.hostname)` 对方括号 IPv6 返回 0，`https://[::1]/` 直连 loopback | 3.3 先去方括号 |
| 自定义 `lookup` 必须处理 `{ all: true }`，否则所有请求失败 | 3.3 |
| 在 `BlockList` 中加入 `::ffff:0:0/96` 会拒绝所有公网 IPv4 | 3.3 不加该段 |
| 本机 DNS 是 fake-IP，`claude.ai`、`vscode.dev` 解析到 `198.18/15`，按原设计 MO3 无法通过 | 3.3 豁免网段，第 5 节 |
| `timeout` 是空闲超时，慢速发送可占住连接数小时 | 3.3 总时长计时器 |
| 密码注册默认开放，登录检查不是访问控制；全局 8 个并发可被占满，持续拒绝 Claude Code 登录 | 3.3 每用户 1 个、全局 32 个，3.5 临时失败时使用旧文档 |
| 错误与拒绝回调没有 `iss` | 3.6 |
| 在解析后的 URL 上检查 `..` 段无效 | 3.2 |

评审确认成立的部分：两份真实文档都通过 3.4 的校验；token、refresh、吊销端点不抓取文档不可被利用（授权码绑定 `client_id`、`redirect_uri` 与 PKCE，refresh 与吊销比较 `client_id`）；URL 形状的 `client_id` 在数据库和网关中无害；Workspace Server 是单进程；当前路由确实在登录检查之前解析客户端，3.6 的调整是必要的。
