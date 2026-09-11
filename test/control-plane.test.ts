import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createMockD1 } from "./mock-d1.ts";
import { initControlPlaneSchema, seedControlPlane } from "../src/control-plane/schema.ts";
import { ControlPlaneDb } from "../src/control-plane/db.ts";
import { hashPassword, verifyPassword, generateSessionToken } from "../src/control-plane/auth.ts";

describe("D1 Control Plane Database & Schema", () => {
  test("initializes schema and seeds default administrator workspace", async () => {
    const d1 = createMockD1();
    await seedControlPlane(d1);

    const db = new ControlPlaneDb(d1);
    const admin = await db.getUserByUsername("admin");
    assert.ok(admin, "Default admin user should exist");
    assert.equal(admin.username, "admin");

    const hash = await db.getPasswordHash(admin.id);
    assert.ok(hash);
    const isValid = await verifyPassword("password123", hash);
    assert.equal(isValid, true, "Default admin password should be password123");

    const spaces = await db.listUserSpaces(admin.id);
    assert.ok(spaces.length >= 1, "Admin should have at least 1 personal space");
    assert.equal(spaces[0].type, "personal");

    const rootNodes = await db.listSpaceRootNodes(spaces[0].id);
    assert.ok(rootNodes.length >= 1, "Should have seeded welcome sheet node");
    assert.equal(rootNodes[0].name, "Welcome Sheet");

    const res = await db.getResourceByNodeId(rootNodes[0].id);
    assert.ok(res, "Welcome node should have associated resource");
    assert.equal(res.kind, "univer");
    assert.equal(res.univer?.unit_type, "sheet");
  });

  test("manages user authentication and session lifecycle", async () => {
    const d1 = createMockD1();
    await initControlPlaneSchema(d1);
    const db = new ControlPlaneDb(d1);

    const passHash = await hashPassword("mySecretPassword!");
    const user = await db.createUser({
      username: "alice",
      displayName: "Alice Smith",
      passwordHash: passHash
    });
    assert.equal(user.username, "alice");

    const token = generateSessionToken();
    const session = await db.createSession(user.id, token);
    assert.ok(session.id);

    const resolved = await db.getSessionByToken(token);
    assert.ok(resolved);
    assert.equal(resolved.user.id, user.id);
    assert.equal(resolved.user.username, "alice");

    // Test session deletion (logout)
    await db.deleteSession(token);
    const resolvedAfter = await db.getSessionByToken(token);
    assert.equal(resolvedAfter, null, "Session should be invalidated");
  });

  test("manages spaces, tree nodes, resources, and trash batches", async () => {
    const d1 = createMockD1();
    await initControlPlaneSchema(d1);
    const db = new ControlPlaneDb(d1);

    const user = await db.createUser({
      username: "bob",
      displayName: "Bob",
      passwordHash: await hashPassword("bobpass")
    });

    // Create Team Space
    const space = await db.createSpace({
      type: "team",
      name: "Engineering Space",
      ownerUserId: user.id
    });
    assert.equal(space.name, "Engineering Space");

    // Create Root Folder Node
    const folder = await db.createNode({
      spaceId: space.id,
      name: "Architecture Docs",
      createdBy: user.id
    });
    assert.equal(folder.name, "Architecture Docs");

    // Create Child Sheet Node
    const sheetNode = await db.createNode({
      spaceId: space.id,
      parentId: folder.id,
      name: "Q3 Roadmap",
      createdBy: user.id
    });
    assert.equal(sheetNode.parent_id, folder.id);

    // Create Univer Resource
    const res = await db.createResource({ nodeId: sheetNode.id, kind: "univer" });
    const uRes = await db.createUniverResource(res.id, "unit_q3_roadmap", "sheet");
    assert.equal(uRes.unit_id, "unit_q3_roadmap");

    // Query resource by unitId
    const resolvedRes = await db.getResourceByUnitId("unit_q3_roadmap");
    assert.ok(resolvedRes);
    assert.equal(resolvedRes.id, res.id);

    // Test Trashing Node
    const trashBatchId = await db.trashNode(folder.id, user.id);
    assert.ok(trashBatchId);

    const rootNodesAfter = await db.listSpaceRootNodes(space.id);
    assert.equal(rootNodesAfter.length, 0, "Folder should no longer be listed in root nodes");

    const trashBatches = await db.listTrashBatches(space.id);
    assert.equal(trashBatches.length, 1);
    assert.equal(trashBatches[0].root_node_id, folder.id);

    // Test Restoring Trash Batch
    const restored = await db.restoreTrashBatch(trashBatchId);
    assert.equal(restored, true);

    const rootNodesRestored = await db.listSpaceRootNodes(space.id);
    assert.equal(rootNodesRestored.length, 1);
    assert.equal(rootNodesRestored[0].id, folder.id);
  });
});
