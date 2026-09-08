/**
 * Durable Resource context owned by the Workspace capability plugin.
 *
 * DSH alpha.4 persists the editable composer as clipboard text, so a
 * structured Resource reference cannot be recovered from a refresh. This
 * service owns the small, identity-scoped set that the user explicitly adds
 * to a Conversation. It stores IDs only; every read re-resolves the current
 * Workspace descriptor and drops resources that are no longer accessible.
 *
 * The model-facing projection is attached through DSH's public
 * `agent/pre-step` waterfall. No DSH session events are fabricated and no
 * private runtime is imported.
 *
 * @module dsh-univer-workspace-plugin/session-context
 */

import { Buffer } from "node:buffer";
import { Service, type Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createUserMessage, type UserMessage } from "@deepseek-ai/dsh-llm";
import type { Domain, KvTable } from "@deepseek-ai/dsh-storage-domain";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { z } from "zod";

const MAX_RESOURCES = 32;
const MAX_SESSION_ID_LENGTH = 240;

const contextRecord = z.object({
  origin: z.string().min(1),
  userId: z.string().min(1),
  sessionId: z.string().min(1).max(MAX_SESSION_ID_LENGTH),
  resourceIds: z.array(z.string().min(1)).max(MAX_RESOURCES),
  updatedAt: z.number().int().nonnegative(),
});

export const workspaceSessionContextDomainSpec = defineDomain({
  name: "univer_workspace_session_context",
  version: 1,
  layout: "per-record",
  tables: { contexts: domainTable(contextRecord) },
});

type ContextRecord = z.infer<typeof contextRecord>;
type ContextTable = KvTable<string, ContextRecord>;

interface WorkspaceIdentity {
  readonly userId: string;
  readonly displayName?: string;
  readonly username?: string;
}

interface WorkspaceHttpClient {
  readonly origin: string;
  request(path: string, init?: RequestInit): Promise<Response>;
}

interface WorkspaceAuth {
  effectiveOrigin(): string;
  currentIdentity(): WorkspaceIdentity | undefined;
  currentClient(): WorkspaceHttpClient | undefined;
}

interface ResourceDescriptor {
  readonly resourceId: string;
  readonly unitId: string;
  readonly unitType: "sheet" | "doc" | "slide" | "board" | "base";
  readonly nodeId: string;
  readonly spaceId: string;
  readonly name: string;
  readonly accessRole: "owner" | "admin" | "editor" | "viewer";
}

export interface WorkspaceSessionContextItem extends ResourceDescriptor {}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** Stable path-safe local key; origin and user remain distinct even with delimiter-like IDs. */
export function workspaceSessionContextKey(
  origin: string,
  userId: string,
  sessionId: string,
): string {
  return Buffer.from(JSON.stringify([origin, userId, sessionId]), "utf8").toString("base64url");
}

function identityScope(
  auth: WorkspaceAuth | undefined,
  sessionId: string,
):
  | {
      readonly key: string;
      readonly origin: string;
      readonly userId: string;
      readonly client?: WorkspaceHttpClient;
    }
  | undefined {
  if (sessionId.trim() === "" || sessionId.length > MAX_SESSION_ID_LENGTH) return undefined;
  const identity = auth?.currentIdentity();
  const origin = auth?.effectiveOrigin().trim();
  if (identity === undefined || origin === undefined || origin === "") return undefined;
  const userId = identity.userId.trim();
  if (userId === "") return undefined;
  const key = workspaceSessionContextKey(origin, userId, sessionId);
  const client = auth?.currentClient();
  return client === undefined ? { key, origin, userId } : { key, origin, userId, client };
}

export function narrowWorkspaceSessionContextResource(
  raw: unknown,
  requestedId: string,
): WorkspaceSessionContextItem | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const envelope = raw as Record<string, unknown>;
  const resource = envelope.resource;
  const node = envelope.node;
  if (
    resource === null ||
    typeof resource !== "object" ||
    Array.isArray(resource) ||
    node === null ||
    typeof node !== "object" ||
    Array.isArray(node)
  )
    return undefined;
  const resourceRecord = resource as Record<string, unknown>;
  const nodeRecord = node as Record<string, unknown>;
  const nodeResource = nodeRecord.resource;
  if (nodeResource === null || typeof nodeResource !== "object" || Array.isArray(nodeResource))
    return undefined;
  const nodeResourceRecord = nodeResource as Record<string, unknown>;
  const resourceId = nonEmptyString(resourceRecord.id);
  const nodeResourceId = nonEmptyString(nodeResourceRecord.id);
  const unitId = nonEmptyString(resourceRecord.unitId);
  const nodeUnitId = nonEmptyString(nodeResourceRecord.unitId);
  const nodeId = nonEmptyString(nodeRecord.id);
  const spaceId = nonEmptyString(nodeRecord.spaceId);
  const name = nonEmptyString(nodeRecord.name);
  const unitType = resourceRecord.unitType;
  const nodeUnitType = nodeResourceRecord.unitType;
  const accessRole = nodeRecord.accessRole;
  if (
    resourceRecord.kind !== "univer" ||
    nodeResourceRecord.kind !== "univer" ||
    resourceId !== requestedId ||
    nodeResourceId !== resourceId ||
    unitId === undefined ||
    nodeUnitId !== unitId ||
    !["sheet", "doc", "slide", "board", "base"].includes(String(unitType)) ||
    nodeUnitType !== unitType ||
    nodeId === undefined ||
    spaceId === undefined ||
    name === undefined ||
    !["owner", "admin", "editor", "viewer"].includes(String(accessRole))
  )
    return undefined;
  return {
    resourceId,
    unitId,
    unitType: unitType as ResourceDescriptor["unitType"],
    nodeId,
    spaceId,
    name,
    accessRole: accessRole as ResourceDescriptor["accessRole"],
  };
}

async function resolveResource(
  client: WorkspaceHttpClient | undefined,
  resourceId: string,
  signal?: AbortSignal,
): Promise<
  | { readonly status: "resolved"; readonly item: ResourceDescriptor }
  | { readonly status: "inaccessible" }
  | { readonly status: "unavailable" }
> {
  if (client === undefined) return { status: "unavailable" };
  let response: Response;
  try {
    response = await client.request(`/api/resources/${encodeURIComponent(resourceId)}`, {
      headers: { accept: "application/json" },
      ...(signal === undefined ? {} : { signal }),
    });
  } catch {
    return { status: "unavailable" };
  }
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    return { status: "inaccessible" };
  }
  if (!response.ok) return { status: "unavailable" };
  try {
    const item = narrowWorkspaceSessionContextResource(await response.json(), resourceId);
    return item === undefined ? { status: "unavailable" } : { status: "resolved", item };
  } catch {
    return { status: "unavailable" };
  }
}

export function createWorkspaceSessionContextMessage(
  items: readonly WorkspaceSessionContextItem[],
): UserMessage {
  const text = projectionText(items);
  return createUserMessage({
    content: [{ type: "text", text }],
    source: {
      kind: "plugin",
      plugin: "dsh-univer-workspace-plugin",
      form: "snapshot",
      sections: [{ name: "workspace-resources", text }],
    },
  });
}

function projectionText(items: readonly ResourceDescriptor[]): string {
  return [
    "Workspace resources explicitly added to this conversation:",
    ...items.map((item) =>
      JSON.stringify({
        kind: "univer-workspace-resource",
        resourceId: item.resourceId,
        unitId: item.unitId,
        unitType: item.unitType,
        nodeId: item.nodeId,
        spaceId: item.spaceId,
        name: item.name,
        accessRole: item.accessRole,
      }),
    ),
  ].join("\n");
}

/** Service contract consumed by the browser route and the agent hook. */
export class WorkspaceSessionContextService extends Service {
  private table: ContextTable | undefined;
  private domain: Domain<typeof workspaceSessionContextDomainSpec> | undefined;

  constructor(private readonly context: Context) {
    super(context, "workspaceSessionContext");
    context.effect(
      () => () => {
        const domain = this.domain;
        this.domain = undefined;
        this.table = undefined;
        if (domain !== undefined) void domain.close();
      },
      "univer-workspace: session context domain close",
    );
  }

  async list(sessionId: string): Promise<readonly WorkspaceSessionContextItem[]> {
    const scope = identityScope(this.auth(), sessionId);
    if (scope === undefined) return [];
    const record = (await this.requireTable()).get(scope.key);
    if (record === undefined || record.resourceIds.length === 0) return [];
    return await this.resolveAndPrune(scope, record);
  }

  async add(
    sessionId: string,
    resourceId: string,
  ): Promise<readonly WorkspaceSessionContextItem[]> {
    const trimmed = resourceId.trim();
    const scope = identityScope(this.auth(), sessionId);
    if (scope === undefined || trimmed === "") throw new Error("workspace_connection_required");
    const descriptor = await resolveResource(scope.client, trimmed);
    if (descriptor.status === "inaccessible") throw new Error("workspace_resource_unavailable");
    if (descriptor.status !== "resolved") throw new Error("workspace_unavailable");
    const table = await this.requireTable();
    const current = table.get(scope.key);
    const resourceIds = [...new Set([...(current?.resourceIds ?? []), trimmed])].slice(
      0,
      MAX_RESOURCES,
    );
    await table.put(scope.key, {
      origin: scope.origin,
      userId: scope.userId,
      sessionId,
      resourceIds,
      updatedAt: Date.now(),
    });
    return await this.resolveAndPrune(scope, table.get(scope.key)!);
  }

  async remove(
    sessionId: string,
    resourceId: string,
  ): Promise<readonly WorkspaceSessionContextItem[]> {
    const scope = identityScope(this.auth(), sessionId);
    if (scope === undefined) throw new Error("workspace_connection_required");
    const table = await this.requireTable();
    const current = table.get(scope.key);
    if (current === undefined) return [];
    const resourceIds = current.resourceIds.filter((id) => id !== resourceId.trim());
    if (resourceIds.length === 0) {
      await table.delete(scope.key);
      return [];
    }
    await table.put(scope.key, { ...current, resourceIds, updatedAt: Date.now() });
    return await this.resolveAndPrune(scope, table.get(scope.key)!);
  }

  async modelContext(agent: Agent, signal: AbortSignal): Promise<UserMessage | undefined> {
    const sessionId = String(agent.session.id);
    const scope = identityScope(this.auth(), sessionId);
    if (scope === undefined) return undefined;
    const record = (await this.requireTable()).get(scope.key);
    if (record === undefined || record.resourceIds.length === 0) return undefined;
    const items = await this.resolveAndPrune(scope, record, signal);
    if (items.length === 0) return undefined;
    return createWorkspaceSessionContextMessage(items);
  }

  private auth(): WorkspaceAuth | undefined {
    return this.context.get("workspaceAuth") as WorkspaceAuth | undefined;
  }

  private async requireTable(): Promise<ContextTable> {
    if (this.table !== undefined) return this.table;
    const storageDomain = this.context.get("storageDomain") as
      | {
          open(
            spec: typeof workspaceSessionContextDomainSpec,
          ): Promise<Domain<typeof workspaceSessionContextDomainSpec>>;
        }
      | undefined;
    if (storageDomain === undefined) throw new Error("storageDomain service is unavailable");
    const domain = await storageDomain.open(workspaceSessionContextDomainSpec);
    this.domain = domain;
    this.table = domain.table("contexts");
    return this.table;
  }

  private async resolveAndPrune(
    scope: NonNullable<ReturnType<typeof identityScope>>,
    record: ContextRecord,
    signal?: AbortSignal,
  ): Promise<readonly WorkspaceSessionContextItem[]> {
    const resolved = await Promise.all(
      record.resourceIds.map((resourceId) => resolveResource(scope.client, resourceId, signal)),
    );
    const items = resolved.flatMap((value) => (value.status === "resolved" ? [value.item] : []));
    const inaccessible = resolved.filter((value) => value.status === "inaccessible").length;
    if (inaccessible > 0) {
      const table = await this.requireTable();
      const remainingIds = resolved.flatMap((value, index) =>
        value.status === "inaccessible" ? [] : [record.resourceIds[index]!],
      );
      if (remainingIds.length === 0) {
        await table.delete(scope.key);
      } else {
        await table.put(scope.key, {
          ...record,
          resourceIds: remainingIds,
          updatedAt: Date.now(),
        });
      }
    }
    return items;
  }
}

export const name = "univer-workspace-session-context";
export const inject = ["storageDomain"];

/** Register the public agent hook and the durable context service. */
export function apply(ctx: Context): void {
  const service = new WorkspaceSessionContextService(ctx);
  ctx.on(
    "agent/pre-step",
    async ({ agent, messages, signal }, next) => {
      const decision = await next();
      if (
        decision.kind === "reject" ||
        !messages.some((message) => message.source.kind === "user")
      ) {
        return decision;
      }
      const context = await service.modelContext(agent, signal);
      return context === undefined
        ? decision
        : { ...decision, messages: [...decision.messages, context] };
    },
    { prepend: true },
  );
}
