/** Disposable real HTTP/OT server for the repository PR browser checks.
 * Run from apps/workspace: node --import tsx test/fixtures/pull-requests-server.ts
 * Then start dev:web (5173). Never opens the normal .data databases. */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspaceApplication } from "../../server/src/app.js";

const directory = mkdtempSync(join(tmpdir(), "workspace-pull-requests-"));
const port = Number(process.env.PORT ?? 3020);
const application = createWorkspaceApplication({
  host: "127.0.0.1",
  port,
  databaseFilename: join(directory, "product.sqlite"),
  collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
  blobDirectory: join(directory, "blobs"),
  secureCookies: false,
  sessionTtlMs: 3_600_000,
  passwordAuthEnabled: true,
  oauthClients: null,
});
await application.initialize();
const password = randomUUID();
const issued = await application.identity.registerWithPassword({
  username: "repo-review",
  displayName: "Repository reviewer",
  password,
});
const userId = issued.view.user.id;
const space = application.spaces.createTeamSpace(userId, { name: "quarterly-planning" });
const tasks: Record<string, string> = {};
for (const [key, name, summary, state] of [
  [
    "ready",
    "Update quarterly forecast and planning notes",
    "Update the quarterly forecast and the planning document.\n\nReview the agent draft or compare it with the official version before merging. The two documents publish together through the existing Worktree workflow.",
    "ready",
  ],
  [
    "draft",
    "Prepare the next product launch",
    "Draft launch checklist and budget. Keep this draft isolated until it is ready for review.",
    "draft",
  ],
  ["empty", "Investigate customer retention", null, "draft"],
  [
    "long",
    "Consolidate regional planning documents and forecast assumptions for the international launch",
    null,
    "draft",
  ],
  [
    "merged",
    "Publish the approved quarterly plan",
    "The reviewed plan is now published.",
    "merged",
  ],
  [
    "discarded",
    "Explore an alternative forecast",
    "This alternative was not selected.",
    "discarded",
  ],
] as const) {
  const created = await application.worktrees.create(userId, randomUUID(), {
    kind: "team",
    teamSpaceId: space.id,
    visibility: "space",
    name,
    summary,
  });
  tasks[key] = created.body.id;
  if (key !== "empty") {
    for (const unitType of ["sheet", "doc"] as const) {
      await application.worktrees.addUnit(userId, created.body.id, randomUUID(), {
        source: "worktree",
        name: unitType === "sheet" ? "Quarterly forecast" : "Planning notes",
        unitType,
        targetSpaceId: space.id,
        targetParentNodeId: null,
      });
    }
  }
  if (state === "ready" || state === "merged")
    await application.worktrees.markReady(userId, created.body.id);
  if (state === "merged") await application.worktrees.merge(userId, created.body.id, randomUUID());
  if (state === "discarded")
    await application.worktrees.discard(userId, created.body.id, randomUUID());
}
const server = createServer(application.app);
application.attachWebSocket(server);
await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
const info = {
  origin: "http://127.0.0.1:5173",
  spaceId: space.id,
  tasks,
  username: "repo-review",
  password,
};
const sessionPath = join(directory, "session.json");
writeFileSync(sessionPath, JSON.stringify(info), { mode: 0o600 });
console.log(
  `PR fixture ready on ${port}. Browser: ${info.origin}/spaces/${space.id}?view=prs\nSession file: ${sessionPath}`,
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, async () => {
    await application.closeRealtime();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await application.close();
    rmSync(directory, { recursive: true, force: true });
  });
