# Production Deployment & Operations Runbook

This runbook guides operators and developers through provisioning, deploying, monitoring, and troubleshooting **Univer Workspace** on the **Cloudflare Edge**.

---

## 1. Prerequisites

Ensure you have installed:
- **Node.js**: `v24.x` or `v22.x`
- **pnpm**: `v10.x` or `v11.x`
- **Wrangler**: `v4.x` (`pnpm add -D wrangler`)

Verify your installation:
```bash
node --version
pnpm --version
pnpm exec wrangler --version
```

---

## 2. Cloudflare Resource Provisioning

### Step 1: Authenticate with Cloudflare
```bash
pnpm exec wrangler login
```
Follow the browser prompt to authorize Wrangler with your Cloudflare account.

### Step 2: Create the D1 Database
Create the production D1 SQLite database for the control plane:
```bash
pnpm exec wrangler d1 create univer-workspace-db
```
**Output Example:**
```text
✅ Successfully created DB 'univer-workspace-db'!
Add the following to your configuration file:
[[d1_databases]]
binding = "DB"
database_name = "univer-workspace-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Update `wrangler.jsonc` with the returned `database_id`:
```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "univer-workspace-db",
      "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    }
  ]
}
```

### Step 3: Create the R2 Blob Bucket
Create the R2 storage bucket for document blobs, images, and attachments:
```bash
pnpm exec wrangler r2 bucket create univer-workspace-blobs
```

---

## 3. Configuration Breakdown (`wrangler.jsonc`)

The production configuration handles Worker routing, Durable Objects, D1, R2, and Static Assets in a single unified definition:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "univer-workspace",
  "main": "src/server.ts",
  "compatibility_date": "2025-02-14",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./apps/workspace/dist/public",
    "binding": "ASSETS",
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "single-page-application",
    "run_worker_first": [
      "/agents/*",
      "/api",
      "/api/*",
      "/universer-api/*",
      "/auth/*",
      "/healthz",
      "/spaces/*"
    ]
  },
  "durable_objects": {
    "bindings": [
      {
        "name": "ChatAgent",
        "class_name": "ChatAgent"
      },
      {
        "name": "WorkspaceDO",
        "class_name": "WorkspaceDO"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["ChatAgent", "WorkspaceDO"]
    }
  ],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "univer-workspace-db",
      "database_id": "YOUR_D1_DATABASE_ID_HERE"
    }
  ],
  "r2_buckets": [
    {
      "binding": "BLOB_BUCKET",
      "bucket_name": "univer-workspace-blobs"
    }
  ]
}
```

> [!IMPORTANT]
> The `run_worker_first` array ensures all API and WebSocket paths bypass Workers Static Assets and execute the Edge Worker directly.

---

## 4. Local Simulation & Verification

Test the entire stack locally with Cloudflare's `workerd` runtime simulator before deploying to production.

### Run Automated Integration Tests
```bash
pnpm exec tsx --test test/*.test.ts
```
Expected output:
```text
ℹ tests 10
ℹ suites 5
ℹ pass 10
ℹ fail 0
```

### Build the React 19 Frontend SPA
```bash
pnpm --filter @univerjs/univer-workspace build:web
```
Assets will be generated in `apps/workspace/dist/public`.

### Launch Local Edge Simulator
```bash
pnpm exec wrangler dev --port 8790
```

### Verify Endpoints Locally
```bash
# 1. Edge Worker Health
curl -s http://localhost:8790/healthz

# 2. Control Plane Session
curl -s http://localhost:8790/api/session

# 3. Default Admin Login
curl -s -X POST http://localhost:8790/api/auth/password/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password123"}'

# 4. ChatAgent Durable Object Wake
curl -s "http://localhost:8790/api/health?docId=doc_welcome"

# 5. WorkspaceDO Presence Wake
curl -s "http://localhost:8790/spaces/space_personal_admin/presence"

# 6. SPA HTML Bundle
curl -s -I http://localhost:8790/
```

---

## 5. Production Deployment

To publish the entire edge stack live to Cloudflare:

```bash
pnpm exec wrangler deploy
```

**Deployment Output:**
```text
Uploading... (125 files)
Uploaded 125 files (93.49 KiB)
Published univer-workspace (4.2s)
  https://univer-workspace.<your-subdomain>.workers.dev
Current Deployment ID: a89c021e-1284-4861-a0a4-39fae7c9f802
```

---

## 6. Observability & Monitoring

### Realtime Edge Logs (Tail)
Stream live production logs from all edge locations worldwide:
```bash
pnpm exec wrangler tail
```

Filter specifically for errors:
```bash
pnpm exec wrangler tail --status error
```

### Durable Object Metrics in Cloudflare Dashboard
Navigate to:
**Workers & Pages** -> **univer-workspace** -> **Durable Objects**
Monitor:
- **Active Isolate Count** (concurrent workbooks open)
- **WebSocket Connection Duration & Hibernation Ratio**
- **DO Storage Operations** (`storage.sql` read/write latency)
- **CPU Time per Invocation** (target: < 5ms average)

---

## 7. Disaster Recovery & Troubleshooting

### Issue: API returns SPA HTML instead of JSON
**Cause**: The requested route is missing from `assets.run_worker_first` in `wrangler.jsonc`.
**Fix**: Add the path pattern (e.g. `"/new-api/*"`) to `run_worker_first` and redeploy.

### Issue: `Kernel integrity failure: Inactive fibers detected`
**Cause**: A dynamic plugin in `plugin_tree` threw an exception during initialization.
**Fix**: Inspect `plugin_tree.error` via Host RPC `plugin.list` or query the DO SQLite storage.

### Issue: D1 Database Cold-Start Migration
**Behavior**: On the first request to a newly deployed environment, `src/control-plane/schema.ts` initializes the schema and seeds the `admin` user automatically. No manual SQL migration files are required for bootstrapping.
