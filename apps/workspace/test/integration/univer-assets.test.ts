import { createServer, type Server } from "node:http";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ErrorCode } from "@univerjs/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkspaceApplication,
  type WorkspaceApplication,
} from "../../server/src/app.js";

const applications: WorkspaceApplication[] = [];
const servers: Server[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
  await Promise.all(
    applications.splice(0).map((application) => application.close())
  );
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Univer embedded assets", () => {
  it("uploads through the native Univer contract and inherits live document permissions", async () => {
    const { application, origin } = await startApplication();
    const owner = await register(application, "asset-owner");
    const viewer = await register(application, "asset-viewer");
    const created = await createSlide(application, owner.userId, "Asset Slide");
    const uploaded = await uploadImage({
      origin,
      cookie: owner.cookie,
      path: "/universer-api/stream/file/upload",
      unitId: created.unitId,
    });

    expect(uploaded.response.status).toBe(201);
    expect(uploaded.body.FileId).toEqual(expect.any(String));
    expect(count(application, "univer_assets")).toBe(1);
    expect(count(application, "univer_asset_uploads")).toBe(0);
    expect(count(application, "nodes")).toBe(1);
    expect(count(application, "resources")).toBe(1);

    const signUrl = `${origin}/universer-api/file/${uploaded.body.FileId}/sign-url`;
    expect((await fetch(signUrl)).status).toBe(401);
    expect(
      (await fetch(signUrl, { headers: { cookie: viewer.cookie } })).status
    ).toBe(404);

    const signed = await fetch(signUrl, { headers: { cookie: owner.cookie } });
    expect(signed.status).toBe(200);
    expect(signed.headers.get("cache-control")).toBe("private, no-store");
    const signedBody = (await signed.json()) as {
      readonly error: { readonly code: number };
      readonly url: string;
    };
    expect(signedBody).toEqual({
      error: { code: ErrorCode.OK, message: "" },
      url: `/universer-api/file/${uploaded.body.FileId}/content`,
    });

    const contentUrl = `${origin}${signedBody.url}`;
    const content = await fetch(contentUrl, {
      headers: { cookie: owner.cookie },
    });
    expect(content.status).toBe(200);
    expect(content.headers.get("content-type")).toBe("image/png");
    expect(content.headers.get("cache-control")).toBe("private, no-store");
    expect(content.headers.get("content-security-policy")).toBe(
      "sandbox; default-src 'none'"
    );
    expect(content.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin"
    );
    expect(Buffer.from(await content.arrayBuffer())).toEqual(PIXEL_PNG);

    const partial = await fetch(contentUrl, {
      headers: { cookie: owner.cookie, range: "bytes=0-7" },
    });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe(
      `bytes 0-7/${PIXEL_PNG.byteLength}`
    );
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(
      PIXEL_PNG.subarray(0, 8)
    );

    application.permissions.upsertNodeGrant(
      owner.userId,
      created.nodeId,
      viewer.userId,
      { role: "viewer" }
    );
    expect(
      (
        await fetch(contentUrl, {
          headers: { cookie: viewer.cookie },
        })
      ).status
    ).toBe(200);
    const viewerUpload = await uploadImage({
      origin,
      cookie: viewer.cookie,
      path: "/universer-api/stream/file/upload",
      unitId: created.unitId,
    });
    expect(viewerUpload.response.status).toBe(404);

    application.permissions.removeNodeGrant(
      owner.userId,
      created.nodeId,
      viewer.userId
    );
    expect(
      (
        await fetch(contentUrl, {
          headers: { cookie: viewer.cookie },
        })
      ).status
    ).toBe(404);

    const batch = application.trash.trashNode(owner.userId, created.nodeId);
    application.trash.removePermanently(owner.userId, batch.id);
    expect(count(application, "univer_assets")).toBe(0);
    expect(count(application, "object_deletion_jobs")).toBe(1);
    expect(
      (
        await fetch(contentUrl, {
          headers: { cookie: owner.cookie },
        })
      ).status
    ).toBe(404);
    await application.blobs.runMaintenance("asset-delete-cleanup");
    expect(count(application, "object_deletion_jobs")).toBe(0);
  });

  it("isolates Worktree assets and publishes only successfully merged Units", async () => {
    const { application, origin } = await startApplication();
    const owner = await register(application, "worktree-asset-owner");
    const worktree = await application.worktrees.create(
      owner.userId,
      "asset-create-worktree-0001",
      { kind: "user", name: "Asset Draft", summary: null }
    );
    const space = application.spaces.list(owner.userId).spaces[0];
    if (!space) throw new Error("Personal space is missing.");
    const local = await application.worktrees.addUnit(
      owner.userId,
      worktree.body.id,
      "asset-create-worktree-unit-0001",
      {
        source: "worktree",
        targetSpaceId: space.id,
        targetParentNodeId: null,
        name: "Draft Slide",
        unitType: "slide",
      }
    );
    expect(count(application, "univer_resources")).toBe(0);

    const uploaded = await uploadImage({
      origin,
      cookie: owner.cookie,
      path: `/universer-api/worktrees/${worktree.body.id}/stream/file/upload`,
      unitId: local.body.unit.unitId,
    });
    expect(uploaded.response.status).toBe(201);
    expect(
      assetScope(application, uploaded.body.FileId)
    ).toEqual({
      unit_id: local.body.unit.unitId,
      worktree_id: worktree.body.id,
    });

    expect(
      (
        await fetch(
          `${origin}/universer-api/file/${uploaded.body.FileId}/sign-url`,
          { headers: { cookie: owner.cookie } }
        )
      ).status
    ).toBe(404);
    const worktreeSign = await fetch(
      `${origin}/universer-api/worktrees/${worktree.body.id}/file/${uploaded.body.FileId}/sign-url`,
      { headers: { cookie: owner.cookie } }
    );
    expect(worktreeSign.status).toBe(200);
    const worktreeSignedBody = (await worktreeSign.json()) as {
      readonly url: string;
    };
    expect(
      (
        await fetch(`${origin}${worktreeSignedBody.url}`, {
          headers: { cookie: owner.cookie },
        })
      ).status
    ).toBe(200);

    await application.worktrees.markReady(owner.userId, worktree.body.id);
    const merged = await application.worktrees.merge(
      owner.userId,
      worktree.body.id,
      "asset-merge-worktree-0001"
    );
    expect(merged.operation.state).toBe("completed");
    expect(count(application, "univer_resources")).toBe(1);
    expect(assetScope(application, uploaded.body.FileId)).toEqual({
      unit_id: local.body.unit.unitId,
      worktree_id: null,
    });
    expect(
      (
        await fetch(
          `${origin}/universer-api/file/${uploaded.body.FileId}/sign-url`,
          { headers: { cookie: owner.cookie } }
        )
      ).status
    ).toBe(200);
  });

  it("rejects malformed sizes but accepts opaque asset bytes", async () => {
    const { application, origin } = await startApplication();
    const owner = await register(application, "asset-validation-owner");
    const created = await createSlide(
      application,
      owner.userId,
      "Validation Slide"
    );

    const overLimit = await uploadImage({
      origin,
      cookie: owner.cookie,
      path: "/universer-api/stream/file/upload",
      unitId: created.unitId,
      declaredSize: 20 * 1024 * 1024 + 1,
    });
    expect(overLimit.response.status).toBe(413);
    expect(count(application, "univer_asset_uploads")).toBe(0);

    const short = await uploadImage({
      origin,
      cookie: owner.cookie,
      path: "/universer-api/stream/file/upload",
      unitId: created.unitId,
      declaredSize: PIXEL_PNG.byteLength + 1,
    });
    expect(short.response.status).toBe(400);
    expect(count(application, "univer_assets")).toBe(0);
    expect(count(application, "object_deletion_jobs")).toBe(1);

    const form = new FormData();
    form.append(
      "file",
      new Blob([Buffer.from("not an image")], { type: "image/png" }),
      "fake.png"
    );
    const opaque = await fetch(
      `${origin}/universer-api/stream/file/upload?size=12&source=3&assign=${encodeURIComponent(created.unitId)}`,
      { method: "POST", headers: { cookie: owner.cookie }, body: form }
    );
    expect(opaque.status).toBe(201);
    const opaqueBody = (await opaque.json()) as { readonly FileId: string };
    expect(count(application, "univer_assets")).toBe(1);
    expect(
      application.database.connection
        .prepare("SELECT media_type FROM univer_assets WHERE id = ?")
        .get(opaqueBody.FileId)
    ).toEqual({ media_type: "image/png" });
    expect(count(application, "object_deletion_jobs")).toBe(1);

    await application.blobs.runMaintenance("asset-validation-cleanup");
    expect(count(application, "object_deletion_jobs")).toBe(0);
  });

  it("recovers stored uploads and abandons incomplete uploads on restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "workspace-asset-recovery-"));
    directories.push(directory);
    const blobDirectory = join(directory, "objects");
    const config = {
      host: "127.0.0.1",
      port: 0,
      databaseFilename: join(directory, "product.sqlite"),
      collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
      blobDirectory,
      secureCookies: false,
      sessionTtlMs: 60_000,
    } as const;
    const dependencies = {
      unitStore: {
        async createUnit(input: { readonly unitId: string }) {
          return { unitId: input.unitId, headRevision: 1 };
        },
      },
    };
    const first = createWorkspaceApplication(config, dependencies);
    applications.push(first);
    const owner = await register(first, "asset-recovery-owner");
    const slide = await createSlide(first, owner.userId, "Recovery Slide");
    const receivingObject = "00000000-0000-4000-8000-000000000010";
    const storedObject = "00000000-0000-4000-8000-000000000011";
    first.database.connection.prepare(
      `INSERT INTO univer_asset_uploads
        (
          id, asset_id, unit_id, worktree_id, object_key, actor_user_id,
          original_filename, declared_media_type, expected_size, state,
          created_at, updated_at, expires_at
        )
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 'receiving', ?, ?, ?)`
    ).run(
      "receiving-upload",
      "00000000-0000-4000-8000-000000000012",
      slide.unitId,
      receivingObject,
      owner.userId,
      "receiving.png",
      "image/png",
      PIXEL_PNG.byteLength,
      1,
      1,
      1000
    );
    first.database.connection.prepare(
      `INSERT INTO univer_asset_uploads
        (
          id, asset_id, unit_id, worktree_id, object_key, actor_user_id,
          original_filename, declared_media_type,
          expected_size, received_size, sha256, etag, state,
          created_at, updated_at, expires_at
        )
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?,
               'stored', ?, ?, ?)`
    ).run(
      "stored-upload",
      "00000000-0000-4000-8000-000000000013",
      slide.unitId,
      storedObject,
      owner.userId,
      "stored.png",
      "image/png",
      PIXEL_PNG.byteLength,
      PIXEL_PNG.byteLength,
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "stable-etag",
      2,
      2,
      1000
    );
    mkdirSync(blobDirectory, { recursive: true });
    writeFileSync(join(blobDirectory, receivingObject), PIXEL_PNG);
    writeFileSync(join(blobDirectory, storedObject), PIXEL_PNG);
    await first.close();
    applications.splice(applications.indexOf(first), 1);

    const restarted = createWorkspaceApplication(config, dependencies);
    applications.push(restarted);
    expect(count(restarted, "univer_asset_uploads")).toBe(0);
    expect(count(restarted, "univer_assets")).toBe(1);
    expect(
      restarted.database.connection
        .prepare("SELECT id, object_key FROM univer_assets")
        .get()
    ).toEqual({
      id: "00000000-0000-4000-8000-000000000013",
      object_key: storedObject,
    });
    expect(count(restarted, "object_deletion_jobs")).toBe(1);
    expect(existsSync(join(blobDirectory, receivingObject))).toBe(true);
    expect(existsSync(join(blobDirectory, storedObject))).toBe(true);
    await restarted.blobs.runMaintenance("asset-recovery-cleanup");
    expect(existsSync(join(blobDirectory, receivingObject))).toBe(false);
    expect(existsSync(join(blobDirectory, storedObject))).toBe(true);
    expect(count(restarted, "object_deletion_jobs")).toBe(0);
  });
});

async function startApplication(): Promise<{
  readonly application: WorkspaceApplication;
  readonly origin: string;
}> {
  const directory = mkdtempSync(join(tmpdir(), "workspace-univer-assets-"));
  directories.push(directory);
  const application = createWorkspaceApplication({
    host: "127.0.0.1",
    port: 0,
    databaseFilename: join(directory, "product.sqlite"),
    collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
    blobDirectory: join(directory, "objects"),
    secureCookies: false,
    sessionTtlMs: 60_000,
  });
  applications.push(application);
  const server = createServer(application.app);
  servers.push(server);
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server address is missing.");
  }
  return {
    application,
    origin: `http://127.0.0.1:${address.port}`,
  };
}

async function register(
  application: WorkspaceApplication,
  username: string
): Promise<{ readonly userId: string; readonly cookie: string }> {
  const issued = await application.identity.registerWithPassword({
    username,
    displayName: username,
    password: "correct horse battery staple",
  });
  return {
    userId: issued.view.user.id,
    cookie: `${application.identity.cookieName}=${issued.cookieValue}`,
  };
}

async function createSlide(
  application: WorkspaceApplication,
  userId: string,
  name: string
): Promise<{ readonly nodeId: string; readonly unitId: string }> {
  const space = application.spaces.list(userId).spaces[0];
  if (!space) throw new Error("Personal space is missing.");
  const created = await application.resources.create(
    userId,
    `create-slide-${crypto.randomUUID()}`,
    {
      kind: "univer",
      spaceId: space.id,
      parentNodeId: null,
      name,
      unitType: "slide",
    }
  );
  const resourceId = created.body.node.resource?.id;
  if (created.status === 202 || !resourceId) {
    throw new Error("Slide creation did not finish.");
  }
  const opened = application.resources.open(userId, resourceId);
  if (opened.resource.kind !== "univer") {
    throw new Error("Created Resource is not a Univer Unit.");
  }
  return {
    nodeId: created.body.node.id,
    unitId: opened.resource.unitId,
  };
}

async function uploadImage(input: {
  readonly origin: string;
  readonly cookie: string;
  readonly path: string;
  readonly unitId: string;
  readonly declaredSize?: number;
}): Promise<{
  readonly response: Response;
  readonly body: { readonly FileId: string };
}> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([PIXEL_PNG], { type: "image/png" }),
    "像素.png"
  );
  const response = await fetch(
    `${input.origin}${input.path}?size=${input.declaredSize ?? PIXEL_PNG.byteLength}&source=3&assign=${encodeURIComponent(input.unitId)}`,
    { method: "POST", headers: { cookie: input.cookie }, body: form }
  );
  return {
    response,
    body: (await response.json()) as { readonly FileId: string },
  };
}

function assetScope(
  application: WorkspaceApplication,
  assetId: string
): { readonly unit_id: string; readonly worktree_id: string | null } {
  return application.database.connection.prepare(
    "SELECT unit_id, worktree_id FROM univer_assets WHERE id = ?"
  ).get(assetId) as {
    readonly unit_id: string;
    readonly worktree_id: string | null;
  };
}

function count(application: WorkspaceApplication, table: string): number {
  return (
    application.database.connection
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
      .get() as { readonly count: number }
  ).count;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
