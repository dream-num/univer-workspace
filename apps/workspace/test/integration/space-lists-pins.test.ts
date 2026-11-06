import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createWorkspaceApplication } from "../../server/src/app.js";

it("separates affiliation, discovery and stars and persists eligible ordered pins through HTTP", async () => {
  const root = mkdtempSync(join(tmpdir(), "workspace-space-lists-"));
  const config = {
    host: "127.0.0.1", port: 0,
    databaseFilename: join(root, "product.sqlite"),
    collaborationDatabaseFilename: ":memory:", blobDirectory: join(root, "blobs"),
    secureCookies: false, sessionTtlMs: 60_000, passwordAuthEnabled: true, oauthClients: null,
  };
  const dependencies = {
    unitStore: { createUnit: async (input: { unitId: string }) => ({ unitId: input.unitId, headRevision: 1 }) },
  };
  let application = createWorkspaceApplication(config, dependencies);
  let server: Server | undefined;
  try {
    const register = (username: string) => application.identity.registerWithPassword({
      username, displayName: username, password: "correct horse battery staple",
    });
    const alice = await register("alice");
    const bob = await register("bob");
    const aliceId = alice.view.user.id;
    const bobId = bob.view.user.id;
    server = createServer(application.app);
    let origin = await listen(server);
    const request = async (path: string, method = "GET", body?: unknown, cookie = alice.cookieValue) => {
      const response = await fetch(`${origin}/api${path}`, {
        method,
        headers: { "content-type": "application/json", ...(cookie ? { cookie: `${application.identity.cookieName}=${cookie}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: response.status === 204 ? null : await response.json() };
    };
    const ids = (spaces: readonly { id: string }[]) => spaces.map((space) => space.id);
    const myPersonal = (await request("/spaces")).body.spaces[0].id as string;
    const bobPersonal = (await request("/spaces", "GET", undefined, bob.cookieValue)).body.spaces[0].id as string;
    const createTeam = async (name: string, cookie = alice.cookieValue, publicRead = false) => {
      const created = await request("/team-spaces", "POST", { name, publicRead }, cookie);
      expect(created.status).toBe(201);
      expect(created.body.affiliation).toBe("owner");
      return created.body.id as string;
    };
    const owned: string[] = [];
    for (const name of ["I", "C", "G", "A", "H", "B", "F", "D", "E"]) owned.push(await createTeam(name));
    const joined = await createTeam("Joined", bob.cookieValue, true);
    const publicTeam = await createTeam("Public", bob.cookieValue, true);
    const hidden = await createTeam("Hidden", bob.cookieValue);
    expect((await request(`/team-spaces/${joined}/members/${aliceId}`, "PUT", { role: "viewer" }, bob.cookieValue)).status).toBe(200);
    expect((await request(`/spaces/${bobPersonal}`, "PATCH", { publicRead: true }, bob.cookieValue)).body.affiliation).toBe("owner");

    const mine = await request("/spaces");
    expect(mine.status).toBe(200);
    expect(ids(mine.body.spaces)).toEqual([myPersonal, owned[3], owned[5], owned[1], owned[7], owned[8], owned[6], owned[2], owned[4], owned[0], joined]);
    expect(mine.body.spaces.slice(0, 10)).toEqual(expect.arrayContaining([expect.objectContaining({ affiliation: "owner" })]));
    expect(mine.body.spaces[10]).toMatchObject({ id: joined, affiliation: "member", accessRole: "viewer" });
    const explored = await request("/spaces/explore");
    expect(explored.status).toBe(200);
    expect(new Set(ids(explored.body.spaces))).toEqual(new Set([publicTeam, bobPersonal]));
    for (const id of [publicTeam, bobPersonal]) {
      const detail = await request(`/spaces/${id}`);
      expect(detail).toMatchObject({ status: 200, body: { affiliation: "none", accessRole: "viewer", capabilities: { createAtRoot: false, createIssue: false } } });
      expect((await request(`/spaces/${id}/nodes`, "GET", undefined, "")).status).toBe(200);
    }
    expect(await request(`/spaces/${joined}`)).toMatchObject({ status: 200, body: { affiliation: "member", accessRole: "viewer", capabilities: { createIssue: true } } });
    expect(await request(`/spaces/${myPersonal}`)).toMatchObject({ status: 200, body: { affiliation: "owner" } });
    expect(await request("/spaces/lookup?owner=bob&slug=public")).toMatchObject({ status: 200, body: { id: publicTeam, affiliation: "none" } });

    for (const [path, method] of [["/spaces", "GET"], ["/spaces/starred", "GET"], ["/spaces/explore", "GET"], ["/spaces/pins", "GET"], ["/spaces/pins", "PUT"], ["/spaces/pins", "DELETE"]]) {
      expect((await request(path!, method, method === "PUT" ? { spaceIds: [myPersonal] } : undefined, "")).status).toBe(401);
    }
    expect((await request("/spaces/starred")).body.spaces).toEqual([]);
    await request(`/spaces/${publicTeam}/star`, "PUT");
    await request(`/spaces/${publicTeam}/star`, "PUT", undefined, bob.cookieValue);
    await request(`/spaces/${bobPersonal}/star`, "PUT");
    expect(ids((await request("/spaces/starred")).body.spaces)).toEqual([bobPersonal, publicTeam]);
    expect(ids((await request("/spaces/explore")).body.spaces)).toEqual([publicTeam, bobPersonal]);
    expect(ids((await request("/spaces")).body.spaces)).toEqual(ids(mine.body.spaces));
    await request(`/spaces/${publicTeam}`, "PATCH", { publicRead: false }, bob.cookieValue);
    expect(ids((await request("/spaces/starred")).body.spaces)).toEqual([bobPersonal]);
    await request(`/spaces/${publicTeam}`, "PATCH", { publicRead: true }, bob.cookieValue);
    expect(ids((await request("/spaces/starred")).body.spaces)).toEqual([bobPersonal, publicTeam]);

    const defaults = await request("/spaces/pins");
    expect(defaults).toEqual({ status: 200, body: { customized: false, limit: 12, spaces: mine.body.spaces.slice(0, 8) } });
    const pinIds = [publicTeam, joined, myPersonal];
    const saved = await request("/spaces/pins", "PUT", { spaceIds: pinIds, userId: bobId });
    expect(saved).toMatchObject({ status: 200, body: { customized: true, limit: 12 } });
    expect(ids(saved.body.spaces)).toEqual(pinIds);
    expect(await request("/spaces/pins")).toEqual(saved);
    expect(await request("/spaces/pins", "PUT", { spaceIds: pinIds })).toEqual(saved);
    expect((await request("/spaces/pins", "GET", undefined, bob.cookieValue)).body.customized).toBe(false);

    const invalid = await request("/spaces/pins", "PUT", { spaceIds: ["missing"] });
    expect(invalid).toMatchObject({ status: 400, body: { error: { code: "INVALID_INPUT", field: "spaceIds" } } });
    await request(`/spaces/${bobPersonal}/star`, "DELETE");
    for (const spaceIds of [undefined, null, [], [5], [""], [myPersonal, myPersonal], Array.from({ length: 13 }, (_, i) => `space-${i}`), [hidden], [bobPersonal], [myPersonal, hidden]]) {
      expect(await request("/spaces/pins", "PUT", { spaceIds })).toEqual(invalid);
      expect(await request("/spaces/pins")).toEqual(saved);
    }

    await close(server);
    server = undefined;
    await application.close();
    application = createWorkspaceApplication(config, dependencies);
    server = createServer(application.app);
    origin = await listen(server);
    expect(await request("/spaces/pins")).toEqual(saved);
    await request(`/spaces/${publicTeam}/star`, "DELETE");
    expect(ids((await request("/spaces/pins")).body.spaces)).toEqual([joined, myPersonal]);
    await request(`/spaces/${publicTeam}/star`, "PUT");
    expect(await request("/spaces/pins")).toEqual(saved);
    await request(`/spaces/${publicTeam}`, "PATCH", { publicRead: false }, bob.cookieValue);
    expect(ids((await request("/spaces/pins")).body.spaces)).toEqual([joined, myPersonal]);
    await request(`/team-spaces/${joined}/members/${aliceId}`, "DELETE", undefined, bob.cookieValue);
    expect(ids((await request("/spaces/pins")).body.spaces)).toEqual([myPersonal]);

    expect(await request("/spaces/pins", "DELETE")).toEqual(defaults);
    expect(await request("/spaces/pins", "DELETE")).toEqual(defaults);
    await request(`/spaces/${publicTeam}`, "PATCH", { publicRead: true }, bob.cookieValue);
    await request("/spaces/pins", "PUT", { spaceIds: [publicTeam] });
    await request(`/spaces/${publicTeam}/star`, "DELETE");
    expect(await request("/spaces/pins")).toEqual(defaults);
    await request(`/spaces/${publicTeam}/star`, "PUT");
    expect(ids((await request("/spaces/pins")).body.spaces)).toEqual([publicTeam]);
  } finally {
    if (server) await close(server);
    await application.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing HTTP port");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
