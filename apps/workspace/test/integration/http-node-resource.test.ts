import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkspaceApplication,
  type WorkspaceApplication,
} from "../../server/src/app.js";

const applications: WorkspaceApplication[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
  await Promise.all(
    applications.splice(0).map((application) => application.close())
  );
});

describe("Node/Resource HTTP API", () => {
  it("supports Resource Nodes as parents and exposes no legacy routes", async () => {
    const application = createWorkspaceApplication(
      {
        host: "127.0.0.1",
        port: 0,
        databaseFilename: ":memory:",
        collaborationDatabaseFilename: ":memory:",
        secureCookies: false,
        sessionTtlMs: 60_000,
      },
      {
        unitStore: {
          createUnit: async (input) => ({
            unitId: input.unitId,
            headRevision: 1,
          }),
        },
      }
    );
    applications.push(application);
    const issued = await application.identity.registerWithPassword({
      username: "http-user",
      displayName: "HTTP User",
      password: "correct horse battery staple",
    });
    const cookie = `${application.identity.cookieName}=${issued.cookieValue}`;
    const space = application.spaces.list(issued.view.user.id).spaces[0];
    if (!space) throw new Error("Personal space was not created.");

    const server = createServer(application.app);
    servers.push(server);
    await listen(server);
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("HTTP server did not expose a TCP port.");
    }
    const origin = `http://127.0.0.1:${address.port}`;

    const parent = await requestJson(origin, cookie, "/api/resources", {
      method: "POST",
      headers: { "idempotency-key": "http-create-parent-0001" },
      body: {
        kind: "univer",
        spaceId: space.id,
        parentNodeId: null,
        name: "Overview",
        unitType: "doc",
      },
    });
    expect(parent.status).toBe(201);
    const parentBody = parent.body as ResourceCreateBody;

    const child = await requestJson(origin, cookie, "/api/resources", {
      method: "POST",
      headers: { "idempotency-key": "http-create-child-0001" },
      body: {
        kind: "univer",
        spaceId: space.id,
        parentNodeId: parentBody.node.id,
        name: "Detail",
        unitType: "sheet",
      },
    });
    expect(child.status).toBe(201);
    const childBody = child.body as ResourceCreateBody;

    const children = await requestJson(
      origin,
      cookie,
      `/api/nodes/${parentBody.node.id}/children`
    );
    expect(children.status).toBe(200);
    expect(children.body).toMatchObject({
      parentNode: {
        id: parentBody.node.id,
        resource: { id: parentBody.node.resource.id, unitType: "doc" },
      },
      nodes: [
        {
          id: childBody.node.id,
          parentNodeId: parentBody.node.id,
          resource: { id: childBody.node.resource.id, unitType: "sheet" },
        },
      ],
    });

    const opened = await requestJson(
      origin,
      cookie,
      `/api/resources/${parentBody.node.resource.id}/open`,
      { method: "POST" }
    );
    expect(opened).toMatchObject({
      status: 200,
      body: {
        resource: {
          id: parentBody.node.resource.id,
          nodeId: parentBody.node.id,
          editorMode: "edit",
        },
      },
    });
    const recent = await requestJson(
      origin,
      cookie,
      "/api/recent-resources"
    );
    expect(recent.body).toMatchObject({
      items: [
        {
          node: { id: parentBody.node.id },
          resource: { id: parentBody.node.resource.id },
        },
      ],
    });
    const owned = await requestJson(origin, cookie, "/api/owned-by-me");
    expect(owned.status).toBe(200);
    const ownedBody = owned.body as {
      readonly items: readonly {
        readonly node: { readonly id: string };
        readonly resource: { readonly id: string };
        readonly location: {
          readonly space: { readonly id: string };
          readonly breadcrumbs: readonly { readonly id: string }[];
        };
      }[];
    };
    expect(
      ownedBody.items.map((item) => ({
        nodeId: item.node.id,
        resourceId: item.resource.id,
        spaceId: item.location.space.id,
        breadcrumbIds: item.location.breadcrumbs.map((crumb) => crumb.id),
      }))
    ).toEqual(
      expect.arrayContaining([
        {
          nodeId: parentBody.node.id,
          resourceId: parentBody.node.resource.id,
          spaceId: space.id,
          breadcrumbIds: [],
        },
        {
          nodeId: childBody.node.id,
          resourceId: childBody.node.resource.id,
          spaceId: space.id,
          breadcrumbIds: [parentBody.node.id],
        },
      ])
    );

    expect(
      await requestJson(
        origin,
        cookie,
        `/api/catalog-entries/${parentBody.node.id}`
      )
    ).toMatchObject({ status: 404 });
    expect(
      await requestJson(
        origin,
        cookie,
        `/api/files/${parentBody.node.resource.id}`
      )
    ).toMatchObject({ status: 404 });
  });
});

interface ResourceCreateBody {
  readonly node: {
    readonly id: string;
    readonly resource: {
      readonly id: string;
      readonly unitType: string;
    };
  };
}

async function requestJson(
  origin: string,
  cookie: string,
  path: string,
  options: {
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: unknown;
  } = {}
): Promise<{ readonly status: number; readonly body: unknown }> {
  const response = await fetch(`${origin}${path}`, {
    method: options.method ?? "GET",
    headers: {
      cookie,
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...options.headers,
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  return {
    status: response.status,
    body: (await response.json()) as unknown,
  };
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
