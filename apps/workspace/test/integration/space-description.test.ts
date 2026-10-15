import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { createWorkspaceApplication } from "../../server/src/app.js";

it("stores a trimmed Space description, validates it, and restricts edits to Space managers", async () => {
  const root = mkdtempSync(join(tmpdir(), "workspace-description-"));
  const application = createWorkspaceApplication(
    {
      host: "127.0.0.1",
      port: 0,
      databaseFilename: join(root, "product.sqlite"),
      collaborationDatabaseFilename: ":memory:",
      blobDirectory: join(root, "blobs"),
      secureCookies: false,
      sessionTtlMs: 60_000,
      passwordAuthEnabled: true,
      oauthClients: null,
    },
    {
      unitStore: {
        createUnit: async (input: { unitId: string }) => ({
          unitId: input.unitId,
          headRevision: 1,
        }),
      },
    },
  );
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
    const team = application.spaces.createTeamSpace(owner.view.user.id, {
      name: "Repository",
      publicRead: true,
    });
    expect(team.description).toBe("");
    server = createServer(application.app);
    const origin = await listen(server);
    const patch = async (cookieValue: string, body: unknown) => {
      const response = await fetch(`${origin}/api/spaces/${team.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: `${application.identity.cookieName}=${cookieValue}`,
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };

    const saved = await patch(owner.cookieValue, { description: "  Docs and pages  " });
    expect(saved).toMatchObject({
      status: 200,
      body: { description: "Docs and pages", name: "Repository" },
    });
    // A name-only patch leaves the description untouched.
    expect(await patch(owner.cookieValue, { name: "Renamed" })).toMatchObject({
      status: 200,
      body: { description: "Docs and pages", name: "Renamed" },
    });
    expect(
      application.spaces.list(reader.view.user.id).spaces.find((space) => space.id === team.id),
    ).toMatchObject({ description: "Docs and pages" });
    expect((await patch(owner.cookieValue, { description: "x".repeat(351) })).status).toBe(400);
    expect((await patch(owner.cookieValue, { description: 7 })).status).toBe(400);
    expect((await patch(reader.cookieValue, { description: "Hijack" })).status).toBe(403);
    expect(application.spaces.get(owner.view.user.id, team.id).description).toBe("Docs and pages");
    expect(await patch(owner.cookieValue, { description: "" })).toMatchObject({
      status: 200,
      body: { description: "" },
    });
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
