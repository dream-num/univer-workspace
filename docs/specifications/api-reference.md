# Cloudflare Edge API Reference

This document provides an exhaustive reference of all HTTP and WebSocket endpoints exposed by the **Univer Workspace Cloudflare Edge** deployment.

---

## 1. Authentication & Sessions

### `GET /api/session`
Resolves current user identity from the `workspace_session` cookie.

- **Auth Required**: No (returns `authenticated: false` if invalid/missing)
- **Response `200 OK` (Authenticated)**:
  ```json
  {
    "authenticated": true,
    "user": {
      "id": "user_admin",
      "username": "admin",
      "displayName": "Administrator",
      "isAdmin": true,
      "createdAt": 1789084800000
    }
  }
  ```
- **Response `200 OK` (Unauthenticated)**:
  ```json
  {
    "authenticated": false,
    "user": null
  }
  ```

---

### `POST /api/auth/password/register`
Creates a new user account with PBKDF2 password hashing.

- **Request Body**:
  ```json
  {
    "username": "alice",
    "password": "SecretPassword123!",
    "displayName": "Alice Smith"
  }
  ```
- **Response `201 Created`**:
  ```json
  {
    "user": {
      "id": "user_1a2b3c",
      "username": "alice",
      "displayName": "Alice Smith",
      "isAdmin": false,
      "createdAt": 1789084900000
    }
  }
  ```

---

### `POST /api/auth/password/login`
Authenticates credentials, generates a 256-bit cryptographically secure session token, and sets the HTTP-only cookie.

- **Request Body**:
  ```json
  {
    "username": "admin",
    "password": "password123"
  }
  ```
- **Response Headers**:
  ```http
  Set-Cookie: workspace_session=a1b2c3d4e5f6...; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=2592000
  ```
- **Response `200 OK`**:
  ```json
  {
    "user": {
      "id": "user_admin",
      "username": "admin",
      "displayName": "Administrator",
      "isAdmin": true
    }
  }
  ```

---

### `POST /api/auth/logout`
Deletes the active session from D1 and clears the session cookie.

- **Response Headers**:
  ```http
  Set-Cookie: workspace_session=; Path=/; Max-Age=0
  ```
- **Response `200 OK`**: `{"success": true}`

---

## 2. Spaces & Workspace Hierarchy

### `GET /api/spaces`
Lists all spaces where the authenticated user is an owner or member.

- **Auth Required**: Yes
- **Response `200 OK`**:
  ```json
  [
    {
      "id": "space_personal_admin",
      "name": "Personal Space",
      "type": "personal",
      "ownerId": "user_admin",
      "createdAt": 1789084800000
    }
  ]
  ```

---

### `POST /api/spaces`
Creates a new space.

- **Auth Required**: Yes
- **Request Body**:
  ```json
  {
    "name": "Finance Team Space",
    "type": "team"
  }
  ```
- **Response `201 Created`**: Returns created `Space` object.

---

### `GET /api/spaces/:spaceId/nodes`
Returns the hierarchical tree nodes (folders, spreadsheets, docs, slides) in the given space.

- **Auth Required**: Yes
- **Response `200 OK`**:
  ```json
  [
    {
      "id": "node_welcome",
      "spaceId": "space_personal_admin",
      "parentId": null,
      "name": "Welcome Sheet",
      "nodeType": "univer",
      "univerType": "sheet",
      "resourceId": "doc_welcome",
      "createdAt": 1789084800000,
      "updatedAt": 1789084800000
    }
  ]
  ```

---

### `POST /api/spaces/:spaceId/nodes`
Creates a new node in the space tree.

- **Auth Required**: Yes
- **Request Body**:
  ```json
  {
    "parentId": null,
    "name": "Q3 Financials",
    "nodeType": "univer",
    "univerType": "sheet"
  }
  ```
- **Response `201 Created`**: Returns created `NodeItem` and triggers `tree.node.created` broadcast on `WorkspaceDO`.

---

### `PATCH /api/nodes/:nodeId`
Renames or moves a node to a different parent folder.

- **Request Body**:
  ```json
  {
    "name": "Q3 Financials (Final)",
    "parentId": "folder_archive"
  }
  ```
- **Response `200 OK`**: Returns updated `NodeItem`.

---

### `DELETE /api/nodes/:nodeId`
Soft-deletes a node and its descendants into a new trash batch.

- **Response `200 OK`**: `{"success": true, "batchId": "trash_batch_123"}`

---

## 3. Trash & Recovery Lifecycle

### `GET /api/trash?spaceId=:spaceId`
Lists active trash batches for a space.

- **Response `200 OK`**: Returns array of `TrashBatch` items with `itemCount` and deletion timestamp.

### `POST /api/trash/restore`
Restores all nodes in a trash batch to their original parent hierarchy.

- **Request Body**: `{"batchId": "trash_batch_123"}`
- **Response `200 OK`**: `{"success": true}`

### `DELETE /api/trash`
Permanently purges a trash batch and associated nodes.

- **Request Body**: `{"batchId": "trash_batch_123"}`
- **Response `200 OK`**: `{"success": true}`

---

## 4. Blob Storage & Media Streaming (R2)

### `POST /api/blob-upload-sessions/create`
Initiates a chunked upload session for large assets.

- **Request Body**:
  ```json
  {
    "spaceId": "space_personal_admin",
    "fileName": "dataset.csv",
    "totalSize": 10485760,
    "chunkCount": 2
  }
  ```
- **Response `200 OK`**: `{"sessionId": "upload_abc123"}`

---

### `PUT /api/blob-upload-sessions/:sessionId/chunk?partIndex=0`
Uploads raw binary chunk data.

- **Request Headers**: `Content-Type: application/octet-stream`
- **Request Body**: Raw binary buffer.
- **Response `200 OK`**: `{"received": true, "partIndex": 0}`

---

### `POST /api/blob-upload-sessions/:sessionId/complete`
Assembles uploaded chunks into Cloudflare R2 and creates a `BlobResource` entry in D1.

- **Response `201 Created`**: Returns `ResourceItem` with `sha256` and `storageKey`.

---

### `GET /api/blob-resources/:resourceId/content`
Streams binary asset content inline from Cloudflare R2 with RFC 7233 range support.

- **Request Headers**: `Range: bytes=0-4095` (Optional)
- **Response `200 OK` or `206 Partial Content`**:
  ```http
  HTTP/1.1 206 Partial Content
  Content-Range: bytes 0-4095/10485760
  Content-Type: application/pdf
  Accept-Ranges: bytes
  ```

---

### `GET /api/blob-resources/:resourceId/download`
Downloads binary asset with `Content-Disposition: attachment; filename="..."`.

---

## 5. Universer Collaboration Suite (ChatAgent DO)

### `GET /universer-api/snapshot/:unitId`
Retrieves the authoritative workbook snapshot from the document's Durable Object SQLite database.

- **Response `200 OK`**:
  ```json
  {
    "unitId": "doc_welcome",
    "rev": 12,
    "data": { "sheets": { ... } }
  }
  ```

---

### `POST /universer-api/changeset`
Submits an OT delta changeset to the document's Durable Object.

- **Request Body**:
  ```json
  {
    "unitId": "doc_welcome",
    "baseRev": 12,
    "changeset": [ ... ]
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "unitId": "doc_welcome",
    "newRev": 13,
    "success": true
  }
  ```

---

### `GET /universer-api/changesets/:unitId?fromRev=1&toRev=13`
Returns chronological changeset history.

---

## 6. Realtime WebSockets

| Path | Protocol | Target | Purpose |
| :--- | :--- | :--- | :--- |
| `/api/remote.mux?docId=:id` | WebSocket (Mux v1) | `ChatAgent` DO | Host RPC, Univer Collab OT, AI Streaming, AST CRDT. |
| `/spaces/:spaceId/live` | WebSocket (Hibernatable) | `WorkspaceDO` | Realtime tree mutations and space collaborator presence. |

---

## 7. Diagnostics & System Endpoints

| Path | Method | Description |
| :--- | :--- | :--- |
| `/healthz` | `GET` | Global Cloudflare Edge Worker gateway health (`{"status": "ok"}`). |
| `/api/health?docId=:id` | `GET` | Health status and isolate ID of the target `ChatAgent` DO. |
| `/spaces/:spaceId/presence` | `GET` | Active collaborator list and count for a space. |
