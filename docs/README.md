# Univer Workspace Documentation Portal

Welcome to the documentation suite for **Univer Workspace** on the **Cloudflare Edge**.

---

## 📚 Table of Contents

### 1. Architecture & Blueprints
- [**Master Architecture Blueprint**](architecture/blueprint.md)
  - Zero-Container serverless philosophy
  - System topology & edge data partitioning
  - Durable Object isolate lifecycle & Cordis boot flow
  - Multi-tenant isolation & WebCrypto security model

### 2. Technical Specifications
- [**Cordis Microkernel & Durable Objects Specification**](specifications/cordis-do-microkernel.md)
  - Cordis v4 service container in V8 isolates
  - Dynamic plugin tree schema & state transitions
  - `assertAllFibersActive` invariant verification
  - Universal Action Engine (`action_journal`, reversible undo/redo, dual RPC/LLM exposition)
  - Core services catalog
- [**Realtime Protocols & Multiplexer Specification**](specifications/multiplexer-protocol.md)
  - 4-Channel Remote Mux protocol (`/api/remote.mux`)
    - Channel 0: Host RPC protocol
    - Channel 1: Univer Collab OT protocol
    - Channel 2: AI Agent streaming protocol
    - Channel 3: AST CRDT protocol
  - Space Presence & Tree Sync protocol (`/spaces/:spaceId/live`)
- [**Control Plane (D1) & Blob Storage (R2) Specification**](specifications/control-plane-and-storage.md)
  - Cloudflare D1 relational database schema (DDL)
  - Pure WebCrypto PBKDF2 authentication & 256-bit secure sessions
  - Cloudflare R2 chunked upload sessions & RFC 7233 byte-range slicing
- [**Cloudflare Edge API Reference**](specifications/api-reference.md)
  - Exhaustive HTTP REST and WebSocket endpoint reference with sample request/response payloads

### 3. Operations & Deployment
- [**Production Deployment Runbook**](deployment/runbook.md)
  - Provisioning D1 database & R2 bucket with Wrangler
  - `wrangler.jsonc` configuration breakdown
  - Local simulation with `wrangler dev`
  - Production deployment commands
  - Observability, logging (`wrangler tail`), and troubleshooting

---

## ⚡ Quick Links

- **Main Codebase**:
  - Edge Worker Entry: [`src/server.ts`](../src/server.ts)
  - ChatAgent Durable Object: [`src/project/dsh-host.ts`](../src/project/dsh-host.ts)
  - WorkspaceDO Durable Object: [`src/project/workspace-do.ts`](../src/project/workspace-do.ts)
  - D1 Control Plane: [`src/control-plane/`](../src/control-plane/)
  - R2 Blob Store: [`src/integrations/r2-blob-store.ts`](../src/integrations/r2-blob-store.ts)
  - Universal Action Engine: [`src/kernel/action.ts`](../src/kernel/action.ts)
  - Configuration: [`wrangler.jsonc`](../wrangler.jsonc)
- **Integration Test Suite**: [`test/`](../test/)
