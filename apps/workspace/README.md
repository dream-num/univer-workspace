# Univer Workspace

A deployable React workspace providing authenticated Univer
collaboration, Node hierarchy management, permissions, Trash, recent Resources,
and Worktrees.

## Development

Requirements:

- Node.js 24 or newer
- pnpm 10
- a Univer license for capabilities that require one

```bash
pnpm install
pnpm workspace:dev:server
pnpm workspace:dev:client
```

`workspace:dev:server` watches the backend and listens at
`http://127.0.0.1:3020`. If `dist/public` exists, it also serves that last-built
static frontend; frontend source changes are not rebuilt or hot-reloaded there.

`workspace:dev:client` starts Vite at `http://127.0.0.1:5173`, enables frontend
hot module replacement, and proxies product API and WebSocket requests to port
3020. Run both commands and open port 5173 for frontend development. Port 3020
alone is sufficient for backend work or viewing the latest built frontend.

API documentation is available at:

- `http://127.0.0.1:3020/api-docs`
- `http://127.0.0.1:3020/openapi.yaml`

Product data is stored in `.data/univer-workspace.sqlite`. Univer unit data is
stored separately in `.data/univer-collaboration.sqlite`, and uploaded Blob
bytes default to `.data/univer-workspace-blobs`.

### Configuration

Copy `.env.example` to `.env`. Development, database, and production start
commands load this file automatically. GitHub OAuth is enabled only when
`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `GITHUB_CALLBACK_URL` are all
configured.

Create a GitHub OAuth App for each environment. GitHub OAuth Apps accept only
one callback URL, so local development and production should not share the
same app. For local development, use:

```text
Homepage URL: http://127.0.0.1:5173
Authorization callback URL: http://127.0.0.1:5173/api/auth/github/callback
```

For the production deployment, create a separate production OAuth App with:

```text
Homepage URL: https://workspace.univer.plus/
Authorization callback URL: https://workspace.univer.plus/api/auth/github/callback
```

The callback URL configured in GitHub must exactly match
`GITHUB_CALLBACK_URL`.

Once configured, the sign-in page shows **Continue with GitHub**. A first-time
GitHub login creates the product User and Personal Space; an existing signed-in
User can link GitHub from the account menu. Access tokens are used only to load
the GitHub profile during sign-in and are not persisted.

Discord OAuth login and account linking are enabled when
`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and `DISCORD_CALLBACK_URL` are
all configured. Add this redirect in the Discord Developer Portal for local
development:

```text
http://127.0.0.1:5173/api/auth/discord/callback
```

The redirect must exactly match `DISCORD_CALLBACK_URL`. Workspace requests
only the `identify` scope, stores the stable Discord User ID and username, and
does not persist the access token. A separate Discord App integration can use
that stable ID to map Discord users to Workspace users.

A trusted Discord Bot server can log a Discord user into Workspace through
`POST /api/auth/discord/bot-login`. Configure the same random secret of at
least 32 characters as `DISCORD_BOT_API_KEY` in Workspace and send it from the
Bot server as the `x-api-key` header. The request must contain the stable
`discordUserId`; `username`, `displayName`, and `avatarUrl` are optional. The
endpoint resolves or creates the Workspace User and Personal Space, then
returns the normal authenticated session response and `workspace_session`
cookie. Only the trusted Bot server may call this endpoint; never expose the
shared key to a Discord client or browser. If the Bot initially supplies only
`discordUserId`, Workspace creates placeholder profile fields; a later Discord
OAuth login fills those placeholders from the verified Discord profile without
replacing profile fields that the User has already customized.

The browser uses the same built-in runtime development license as Workspace
CLI. Both copies are rotated every 90 days and are application credentials, not
the repository software license. The built-in credential is for `localhost`;
set `VITE_UNIVER_LICENSE` at build time for any non-local deployment or to
override it locally. Server, database, GitHub, and Discord settings are runtime
values.

## Docker

Build the image from the repository root:

```bash
docker build \
  --build-arg VITE_UNIVER_LICENSE="$VITE_UNIVER_LICENSE" \
  -f apps/workspace/Dockerfile \
  -t univer-workspace .
```

Run it with a persistent data volume:

```bash
docker run --name univer-workspace \
  -p 3020:3020 \
  -v univer-workspace-data:/app/univer-workspace/.data \
  -e GITHUB_CLIENT_ID \
  -e GITHUB_CLIENT_SECRET \
  -e GITHUB_CALLBACK_URL=https://workspace.univer.plus/api/auth/github/callback \
  -e DISCORD_CLIENT_ID \
  -e DISCORD_CLIENT_SECRET \
  -e DISCORD_CALLBACK_URL=https://workspace.univer.plus/api/auth/discord/callback \
  -e SECURE_COOKIES=true \
  univer-workspace
```

For a plain HTTP environment, use `-e SECURE_COOKIES=false`. Keep secure
cookies enabled for `https://workspace.univer.plus`.

To intentionally erase all product and collaboration data in a disposable
environment, run the reset command against the volume:

```bash
docker run --rm \
  -v univer-workspace-data:/app/univer-workspace/.data \
  univer-workspace node dist/server/db/reset.js
```

Starting or restarting the application does not recreate the database.
Do not run the reset command during a normal deployment; application startup
backs up and migrates supported V0 through V5 product databases to V6 automatically.
For a V6 rollout, stop every old Workspace instance, start one V6 instance and
wait for migration and health checks to succeed, then restore normal service;
do not let V5 and V6 processes write the same SQLite file concurrently.

## Commands

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm db:reset
```

See [architecture.md](docs/architecture.md), [data-model.md](docs/data-model.md),
and [application-design.md](docs/application-design.md).
