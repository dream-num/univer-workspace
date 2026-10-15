import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { createWorkspaceApplication } from "../../server/src/app.js";

it("persists per-user Space stars across restart and enforces access at the HTTP boundary", async () => {
  const root = mkdtempSync(join(tmpdir(), "workspace-stars-"));
  const config = {
    host: "127.0.0.1",
    port: 0,
    databaseFilename: join(root, "product.sqlite"),
    collaborationDatabaseFilename: ":memory:",
    blobDirectory: join(root, "blobs"),
    secureCookies: false,
    sessionTtlMs: 60_000,
    passwordAuthEnabled: true,
    oauthClients: null,
  };
  const dependencies = {
    unitStore: {
      createUnit: async (input: { unitId: string }) => ({ unitId: input.unitId, headRevision: 1 }),
    },
  };
  let application = createWorkspaceApplication(config, dependencies);
  let server: Server | undefined;
  try {
    const owner = await application.identity.registerWithPassword({
      username: "owner",
      displayName: "Owner",
      password: "correct horse battery staple",
    });
    const reader = await application.identity.registerWithPassword({
      username: "reader",
      displayName: "Reader",
      password: "correct horse battery staple",
    });
    const cookie = (value: string) => `${application.identity.cookieName}=${value}`;
    const ownerCookie = cookie(owner.cookieValue);
    const readerCookie = cookie(reader.cookieValue);
    const team = application.spaces.createTeamSpace(owner.view.user.id, {
      name: "Repository",
      publicRead: true,
    });
    const hidden = application.spaces.createTeamSpace(owner.view.user.id, { name: "Hidden" });
    const personal = application.spaces
      .list(owner.view.user.id)
      .spaces.find((space) => space.type === "personal")!;
    expect(team).toMatchObject({ owner: { id: owner.view.user.id, username: "owner" } });
    expect(
      application.spaces.list(reader.view.user.id).spaces.find((space) => space.id === team.id),
    ).toMatchObject({ owner: { username: "owner" } });
    server = createServer(application.app);
    let origin = await listen(server);
    const request = async (spaceId: string, method = "GET", sessionCookie?: string) => {
      const response = await fetch(`${origin}/api/spaces/${spaceId}/star`, {
        method,
        headers: sessionCookie ? { cookie: sessionCookie } : {},
      });
      return { status: response.status, body: await response.json() };
    };
    expect(await request(team.id, "GET", ownerCookie)).toEqual({
      status: 200,
      body: { starred: false, starCount: 0 },
    });
    // Public readers can star without becoming members or gaining edit rights.
    expect(await request(team.id, "PUT", readerCookie)).toEqual({
      status: 200,
      body: { starred: true, starCount: 1 },
    });
    expect(await request(team.id, "PUT", readerCookie)).toEqual({
      status: 200,
      body: { starred: true, starCount: 1 },
    });
    expect(await request(team.id, "PUT", ownerCookie)).toEqual({
      status: 200,
      body: { starred: true, starCount: 2 },
    });
    expect(application.spaces.get(reader.view.user.id, team.id).capabilities.createAtRoot).toBe(
      false,
    );
    expect(
      application.database.connection
        .prepare("SELECT * FROM space_members WHERE user_id = ?")
        .all(reader.view.user.id),
    ).toEqual([]);
    for (const method of ["GET", "PUT", "DELETE"]) {
      expect((await request(team.id, method)).status).toBe(401);
      expect((await request(hidden.id, method, readerCookie)).status).toBe(404);
      expect((await request("missing", method, ownerCookie)).status).toBe(404);
    }
    expect(await request(personal.id, "PUT", ownerCookie)).toEqual({
      status: 200,
      body: { starred: true, starCount: 1 },
    });
    await close(server);
    server = undefined;
    await application.close();
    application = createWorkspaceApplication(config, dependencies);
    server = createServer(application.app);
    origin = await listen(server);
    expect(await request(team.id, "GET", readerCookie)).toEqual({
      status: 200,
      body: { starred: true, starCount: 2 },
    });
    expect(await request(team.id, "DELETE", readerCookie)).toEqual({
      status: 200,
      body: { starred: false, starCount: 1 },
    });
    expect(await request(team.id, "DELETE", readerCookie)).toEqual({
      status: 200,
      body: { starred: false, starCount: 1 },
    });
    expect(await request(team.id, "GET", ownerCookie)).toEqual({
      status: 200,
      body: { starred: true, starCount: 1 },
    });
    expect(await request(team.id, "DELETE", ownerCookie)).toEqual({
      status: 200,
      body: { starred: false, starCount: 0 },
    });
    // A retained star never grants access after a public Space becomes private.
    await request(team.id, "PUT", readerCookie);
    application.spaces.update(owner.view.user.id, team.id, { publicRead: false });
    expect((await request(team.id, "GET", readerCookie)).status).toBe(404);
    expect((await request(team.id, "PUT", readerCookie)).status).toBe(404);
  } finally {
    if (server) await close(server);
    await application.close();
    rmSync(root, { recursive: true, force: true });
  }
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing HTTP port");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
