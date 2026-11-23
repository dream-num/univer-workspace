# Workspace configuration

English | [简体中文](configuration.zh-CN.md)

For a first local installation, run `cp apps/workspace/.env.example apps/workspace/.env` from the repository root. Edit that file and restart the Workspace server. The defaults below apply when a variable is absent. Relative data paths resolve from the server's working directory (`apps/workspace` with the supplied commands).

For Docker, put your runtime settings in a deployment-specific file and pass `--env-file ./workspace.env` when creating the container. Keep the image's bind address and HTTPS cookie defaults unless your deployment needs different values. Browser build settings are listed separately below. See the [Docker instructions](../README.md#docker).

## Deployment configurations

The default **SQLite + local directory** deployment uses `DATABASE_PROVIDER=sqlite` and `BLOB_STORE=local`. Both databases and uploaded files are stored under `.data/`.

For **PostgreSQL + S3**, supply the following settings together. Replace the connection details and bucket name, and give the service credentials for a dedicated PostgreSQL 17 database and an existing private S3 bucket.

```dotenv
DATABASE_PROVIDER=postgres
DATABASE_URL=postgresql://workspace:replace-me@db:5432/workspace
BLOB_STORE=s3
BLOB_S3_BUCKET=workspace-objects
BLOB_S3_REGION=us-east-1
BLOB_S3_PREFIX=workspace
```

For an existing SQLite deployment with local files, follow the [storage migration guide](storage-migration.md) before starting the target.

## Databases

| Variable | Default | When to set it |
| --- | --- | --- |
| `DATABASE_PROVIDER` | `sqlite` | Select `sqlite` or `postgres` for **both** product and collaboration data. PostgreSQL requires `BLOB_STORE=s3` for Sheet blocks. |
| `DATABASE_FILE` | `.data/univer-workspace.sqlite` | SQLite product database for users, spaces, files and permissions. |
| `COLLABORATION_DATABASE_FILE` | `.data/univer-collaboration.sqlite` | SQLite collaboration database for document edits, Worktrees, history and comments. |
| `DATABASE_URL` | Unset | Required with `postgres`. Supply a `postgres://` or `postgresql://` connection URI for a dedicated database. |

The Workspace role needs permission to create the `collaboration` schema and objects in both the product schema (normally `public`) and `collaboration`. Workspace initializes both on first startup. To back up PostgreSQL + S3, stop all writers and save a full database dump and the S3 objects at the same recovery point.

## File storage

| Variable | Default | When to set it |
| --- | --- | --- |
| `BLOB_STORE` | `local` | Choose `local` or `s3`. |
| `BLOB_DIRECTORY` | `.data/univer-workspace-blobs` | Writable directory for local file bytes. |
| `MAX_BLOB_BYTES` | `536870912` (512 MiB) | Maximum size in bytes for one blob. |
| `BLOB_S3_BUCKET` | Unset | Required for S3. Supply an existing private bucket. |
| `BLOB_S3_REGION` | AWS SDK region | Override the region resolved from `AWS_REGION` or an AWS profile. |
| `BLOB_S3_PREFIX` | Empty (bucket root) | Root prefix for Workspace objects. Files use their original object keys under this prefix. Collaboration Sheet blocks use its `sheet-blocks/` subdirectory. |
| `BLOB_S3_ENDPOINT` | Regional AWS endpoint | S3 API URL for MinIO or another compatible service. |
| `BLOB_S3_FORCE_PATH_STYLE` | `false` | Set to `true` if the endpoint needs the bucket in the URL path. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | AWS SDK credential chain | Use a workload role, or supply a key pair. Temporary credentials also require the session token. |

**MinIO** requires the S3 API endpoint reachable from the Workspace server.
This example uses path-style addressing.

```dotenv
BLOB_S3_ENDPOINT=http://minio:9000
BLOB_S3_FORCE_PATH_STYLE=true
```

Grant `s3:ListBucket` on the bucket and
`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` and `s3:AbortMultipartUpload` on its
Workspace objects. Use bucket lifecycle rules to expire incomplete multipart uploads and,
for versioned buckets, to control how long deleted versions are retained.

**Kubernetes** — Put the database and S3 settings in the Workspace container's `env`, use a workload identity or a Secret
for credentials, and keep the existing data PVC. For this repository's [Deploy Workspace workflow](../../../.github/workflows/push.yml),
edit the target manifest under `deploy/colla-workspace/` in `dream-num/helm-chart-private` before rollout.

## Authentication

### Passwords, sessions and email codes

| Variable | Default | When to set it |
| --- | --- | --- |
| `PASSWORD_AUTH_ENABLED` | `true` | Set to `false` to disable password registration, login and changes. Configure email, GitHub, Google or Discord sign-in first. Existing sessions last until sign-out or expiry. |
| `SESSION_TTL_MS` | `604800000` (7 days) | Login session lifetime in milliseconds. A CLI session, or another session issued to a non-browser client, renews to a full lifetime when it is used after half of its lifetime has passed. Browser sessions and sessions issued for an access token keep a fixed lifetime. |
| `SECURE_COOKIES` | `true` in production, otherwise `false` | Use secure cookies over HTTPS. For local plain HTTP in the production image, set `false`. |
| `EMAIL_AUTH_ENABLED` | Off until email settings are supplied | Provider, sender or SMTP settings enable email sign-in. Set explicitly to `false` to disable it. |
| `EMAIL_PROVIDER` | `smtp` with SMTP settings, otherwise `console` when enabled | Use `smtp` to deliver mail. For local testing, `console` writes codes to the server log. |
| `EMAIL_FROM`, `EMAIL_FROM_NAME` | `no-reply@localhost`, no display name | Sender address and optional display name. Use a verified sender for delivery. |
| `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT` | Host unset, port `587` | SMTP requires a host. Use the port supplied by the mail service. |
| `EMAIL_SMTP_SECURE` | `true` on port 465, otherwise `false` | Enable implicit TLS from connection start. |
| `EMAIL_SMTP_USER`, `EMAIL_SMTP_PASSWORD` | Both unset | Set both for authenticated SMTP, using the original credential values. |

```dotenv
EMAIL_PROVIDER=smtp
EMAIL_FROM=no-reply@example.com
EMAIL_FROM_NAME=Univer Workspace
EMAIL_SMTP_HOST=email-smtp.us-east-1.amazonaws.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_USER=your-smtp-username
EMAIL_SMTP_PASSWORD=your-smtp-password
```

Email codes expire after ten minutes and allow five incorrect attempts. Each address can request one code per minute and up to five per hour. Once `TRUST_PROXY` is set, each source IP can send 60 requests per hour to the code route and 120 to the login route, per server process. Every request counts, valid or not. The first successful verification creates the account.

For Amazon SES, use SMTP credentials issued for the endpoint's region. If SES returns `535`, check the SMTP username and its matching SMTP password. Sandbox accounts also need a verified recipient.

### Third-party sign-in

Set all three variables for each provider you enable. Register the exact callback URL with that provider. Use the browser origin (locally `http://127.0.0.1:5173`) followed by the path below.

| Provider | Variables | Default | Callback path |
| --- | --- | --- | --- |
| GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL` | All unset | `/api/auth/github/callback` |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | All unset | `/api/auth/google/callback` |
| Discord | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_CALLBACK_URL` | All unset | `/api/auth/discord/callback` |

A signed-in user can link a provider from the account menu. Google sign-in and email-code sign-in with the same address create separate accounts unless linked.

Create a separate GitHub OAuth App for each environment. For Google, select a **Web application** OAuth client. For Discord, add the redirect URL in the Developer Portal.

```dotenv
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
GITHUB_CALLBACK_URL=https://workspace.example.com/api/auth/github/callback
GITHUB_ALLOWED_ORGANIZATIONS=your-org
```

| Variable | Default | When to set it |
| --- | --- | --- |
| `GITHUB_ALLOWED_ORGANIZATIONS` | Empty (unrestricted) | Comma-separated organization names. GitHub sign-in and account linking require active membership in at least one listed organization. To restrict browser sign-in to those members, also disable password and other sign-in methods. |
| `DISCORD_BOT_API_KEY` | Unset (disabled) | Shared random secret of at least 32 characters for a trusted bot calling `POST /api/auth/discord/bot-login` with the `x-api-key` header. Keep it on the two servers. |
| `GITHUB_TOKEN` | Unset | Optional server token for GitHub API requests when importing Skills. GitHub sign-in uses its own OAuth credentials. |

## OAuth clients and MCP

| Variable | Default | When to set it |
| --- | --- | --- |
| `OAUTH_CLIENTS_JSON` | No static clients | JSON object with a `clients` array. Register an exact redirect URI. Use PKCE and consent for public browser clients. Grant `session` only to clients trusted to act as the user. |
| `PUBLIC_ORIGIN` | Unset | Externally reachable Workspace HTTP(S) origin without a path. Required as the OAuth issuer when enabling MCP OAuth. |
| `MCP_RESOURCE_URLS` | Empty (MCP OAuth disabled) | Comma-separated allowed MCP server URLs. Browser Agents need the same-origin `/mcp` URL in this list. |
| `MCP_MAX_REGISTERED_CLIENTS` | `10000` | Dynamic client registration limit. Further registrations return HTTP 503. |
| `MCP_CIMD_ENABLED` | Enabled with MCP OAuth | Set to `0` to disable HTTPS client metadata discovery when outbound HTTPS is unavailable. Dynamic registration remains available. |
| `MCP_CIMD_EXEMPT_NETWORKS` | Empty | Comma-separated proxy CIDRs for fake-IP or TUN resolvers. Only exempt a proxy network that cannot reach internal services. Loopback and link-local overlaps are rejected. |

For MCP and browser Agents on the same host:

```dotenv
PUBLIC_ORIGIN=https://workspace.example.com
MCP_RESOURCE_URLS=https://workspace.example.com/mcp
```

To register a local Workspace Agent as a public client:

```dotenv
OAUTH_CLIENTS_JSON={"clients":[{"clientId":"univer-workspace-harness","clientType":"public","requiresConsent":true,"redirectUris":["http://127.0.0.1:3101/auth/oauth/callback"],"scopes":["identity","session"]}]}
```

The MCP gateway uses a confidential client with `tokenExchange: true` to exchange tokens for short-lived Workspace sessions. For the other side of each connection, see [Workspace Agent setup](../../agent/README.md#connect-to-a-local-workspace) and the [MCP gateway guide](../../mcp/README.md).

## Server, proxy and monitoring

| Variable | Default | When to set it |
| --- | --- | --- |
| `HOST`, `PORT` | `127.0.0.1`, `3020` (Docker binds to `0.0.0.0`) | Server bind address and listening port. |
| `NODE_ENV` | Unset (Docker: `production`) | Production mode enables secure cookies by default. |
| `TRUST_PROXY` | Unset (use TCP peer) | Set the number of trusted reverse proxy hops or a comma-separated list of trusted proxy addresses/subnets so IP limits apply to the client. Email sign-in limits per source IP apply only when it is set. Use `0` when clients connect directly. |
| `AGENT_CREATE_LIMIT_PER_HOUR` | `5` | Guest agent creations per source IP per hour, per server process. Set to `0` to disable guest creation. |
| `LOG_LEVEL` | `info` | Server log level, for example `debug` for troubleshooting. |
| `METRICS_TOKEN` | Unset (`/metrics` returns 404) | Enable Prometheus scrapes using a random Bearer token of at least 32 characters. For example, generate one with `openssl rand -hex 32`. |
| `TRIAL_DEPLOYMENT` | `false` | Show signed-in users a notice about trial data retention. |

For an HTTPS deployment reached exclusively through one trusted reverse proxy:

```dotenv
PUBLIC_ORIGIN=https://workspace.example.com
TRUST_PROXY=1
SECURE_COOKIES=true
```

## Licenses, browser builds and local development

| Variable | Default | Where and when to set it |
| --- | --- | --- |
| `UNIVER_LICENSE`, `UNIVER_LICENSE_KEY` | Bundled development pair | Set both on the running server to license collaboration and Office import/export. |
| `VITE_UNIVER_LICENSE` | Bundled browser development license | Set at **build time** for a deployment domain outside the bundled license. The Docker build accepts this name as a build argument. An unlicensed browser host receives HTTP 403 (code 9018) from collaboration. |
| `VITE_UNIVER_WORKSPACE_HARNESS_ORIGIN` | Unset on deployed hosts | Set the Agent application URL at Vite build time. On `localhost` or `127.0.0.1` with port 4020 or the protocol's default port, the browser defaults to the same host on port 3081. |
| `WORKSPACE_DEV_API_PORT`, `WORKSPACE_DEV_MCP_PORT` | `3020`, `3000` | Set in the Vite process environment when the local API or MCP gateway uses another port. |

For example, to move the local API to port 4020, run these commands in separate terminals from the repository root.

```bash
PORT=4020 pnpm workspace:dev:server
WORKSPACE_DEV_API_PORT=4020 pnpm workspace:dev:web
```
