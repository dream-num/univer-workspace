import { randomUUID } from "node:crypto";
import { Router, json, type ErrorRequestHandler } from "express";
import { CollabError, type RequiredUnitPermission } from "@univerjs-pro/collaboration-service";
import { ErrorCode, ObjectScope, UnitAction, UnitObject, UnitRole } from "@univerjs/protocol";
import type { AccessResolver, ResourceContentAccess } from "../../modules/access/index.js";
import { ANONYMOUS_USER_ID, type IdentityModule } from "../../modules/identity/index.js";
import {
  canManageContentPermission,
  type ContentPermissionWriteResult,
  type ContentPermissionsRepository,
  type ContentPermissionObject,
  type ContentCollaborator,
} from "../../modules/content-permissions/index.js";
import type { WorktreesModule } from "../../modules/worktrees/index.js";
import { protocolUser } from "./protocol-user.js";

const objectTypes = new Map<number, string>([
  [UnitObject.Worksheet, "sheet"],
  [UnitObject.SelectRange, "sheet"],
  [UnitObject.DocumentSection, "doc"],
  [UnitObject.DocumentParagraph, "doc"],
  [UnitObject.DocumentEntity, "doc"],
  [UnitObject.SlidePage, "slide"],
  [UnitObject.SlideElement, "slide"],
  [UnitObject.SlideMaster, "slide"],
  [UnitObject.BoardElement, "board"],
  [UnitObject.BaseTable, "base"],
  [UnitObject.BaseField, "base"],
  [UnitObject.BaseRecord, "base"],
  [UnitObject.BaseView, "base"],
  [UnitObject.BaseDashboard, "base"],
]);
const readActions = new Set([
  UnitAction.View,
  UnitAction.Comment,
  UnitAction.Print,
  UnitAction.Copy,
  UnitAction.Export,
  UnitAction.IHistory,
  UnitAction.ViemRwHgtClWdt,
  UnitAction.ViewFilter,
  UnitAction.SelectProtectedCells,
  UnitAction.SelectUnProtectedCells,
  UnitAction.ViewHistory,
]);
const management = new Set([
  UnitAction.ManageCollaborator,
  UnitAction.Delete,
  UnitAction.CreatePermissionObject,
]);
/** Universer DefaultUnitPermStrategy uses Reader for these actions when a rule stores none. */
const readerDefaults = new Set([
  UnitAction.View,
  UnitAction.Copy,
  UnitAction.Comment,
  UnitAction.ViewHistory,
]);
const scopeValues = new Set<number>([
  ObjectScope.SomeCollaborator,
  ObjectScope.AllCollaborator,
  ObjectScope.OneSelf,
]);
const knownAction = (value: unknown): value is UnitAction =>
  typeof value === "number" && value >= 0 && typeof UnitAction[value] === "string";
const ok = { code: ErrorCode.OK, message: "" };

/** Preserve the product envelope, including viewer comments and anonymous reads. */
export function unitActionAllowed(
  resource: ResourceContentAccess | null,
  action: unknown,
): boolean {
  if (!resource?.capabilities.openContent || !knownAction(action) || action === UnitAction.Share)
    return false;
  if (readActions.has(action)) return true;
  if (!resource.capabilities.editContent) return false;
  if (resource.role === "owner" || resource.role === "admin") return true;
  return action !== UnitAction.ManageCollaborator && action !== UnitAction.Delete;
}

export function createContentPermissions(options: {
  repository: ContentPermissionsRepository;
  access: AccessResolver;
  identity: IdentityModule;
  worktrees: WorktreesModule;
}) {
  const { repository, access, identity } = options;

  async function allowed(
    userId: string,
    requirement: Pick<RequiredUnitPermission, "unitID" | "objectID" | "objectType" | "action">,
    /** In a Worktree, how far authorizeProtocol let the caller in. The caller MUST have asked it first. */
    draft: false | "review" | "write" = false,
  ): Promise<boolean> {
    const { unitID, objectID, objectType, action } = requirement;
    if (!knownAction(action)) return false;
    // Draft rules are inherited; neither bindings nor policy can be managed here.
    if (draft && management.has(action)) return false;
    const resource = await access.resolveUnitContent(userId, unitID);
    if (objectID === unitID) {
      // Worktree-local Units have no published Resource yet.
      if (draft && !resource) return action !== UnitAction.Share;
      // The Worktree decides who writes its draft. Trunk edit access is checked on merge, for whoever merges.
      if (draft === "write") return Boolean(resource?.capabilities.openContent) && action !== UnitAction.Share;
      return unitActionAllowed(resource, action);
    }
    if (!resource?.unitType || objectTypes.get(objectType) !== resource.unitType) return false;
    const object = await repository.get(unitID, objectID);
    if (!object || object.objectType !== objectType) return false;
    // An object grant cannot widen file access. Object ManageCollaborator is not the file
    // action of the same name: the creator, and the current file Owner or Admin, can manage
    // the rule while they can still edit the file.
    if (
      !unitActionAllowed(resource, action) &&
      !(management.has(action) && canManageContentPermission(userId, object.creatorUserId, resource))
    ) {
      return false;
    }
    const explicit = object.collaborators.find((user) => user.userId === userId)?.role;
    const role =
      object.creatorUserId === userId || resource.role === "owner" || resource.role === "admin"
        ? UnitRole.Owner
        : explicit !== undefined
          ? explicit
          : object.editScope === ObjectScope.AllCollaborator &&
              resource.capabilities.editContent &&
              !management.has(action)
            ? UnitRole.Editor
            : undefined;
    // OneSelf blocks every non-owner action. All-collaborator read can still allow View.
    if (object.editScope === ObjectScope.OneSelf && role !== UnitRole.Owner) {
      return action === UnitAction.View && object.readScope === ObjectScope.AllCollaborator;
    }
    if (action === UnitAction.View && object.readScope === ObjectScope.AllCollaborator) return true;
    const stored = object.strategies.find((strategy) => strategy.action === action)?.role;
    const minimum =
      stored ??
      (management.has(action)
        ? UnitRole.Owner
        : readerDefaults.has(action)
          ? UnitRole.Reader
          : UnitRole.Editor);
    return role !== undefined && role >= minimum;
  }

  async function requireUnit(userId: string, unitId: string, edit = false) {
    const resource = await access.resolveUnitContent(userId, unitId);
    if (!resource?.capabilities.openContent || (edit && !resource.capabilities.editContent)) deny();
    return resource;
  }
  async function requireManaged(userId: string, unitId: string, objectId: string) {
    const object = await repository.get(unitId, objectId);
    if (
      !object ||
      !(await allowed(userId, {
        unitID: unitId,
        objectID: objectId,
        objectType: object.objectType,
        action: UnitAction.ManageCollaborator,
      }))
    )
      deny();
    return object;
  }
  function collaborators(value: unknown, creator: string): ContentCollaborator[] {
    const entries = array(value ?? []);
    const users = new Map<string, ContentCollaborator>();
    for (const raw of entries) {
      const entry = record(raw);
      const subjectId = entry.subject === undefined ? undefined : record(entry.subject).userID;
      const userId = string(entry.id || subjectId);
      if (subjectId !== undefined && subjectId !== userId)
        invalid("Collaborator identity mismatch.");
      if (userId === creator) continue;
      if (entry.role !== UnitRole.Reader && entry.role !== UnitRole.Editor)
        invalid("Invalid collaborator role.");
      users.set(userId, { userId, role: entry.role });
    }
    return [...users.values()];
  }
  function strategies(value: unknown): ContentPermissionObject["strategies"] {
    const result = new Map<number, { action: number; role: number }>();
    for (const raw of array(value ?? [])) {
      const entry = record(raw);
      if (
        !knownAction(entry.action) ||
        ![UnitRole.Reader, UnitRole.Editor, UnitRole.Owner].includes(entry.role as number)
      ) {
        invalid("Invalid permission strategy.");
      }
      result.set(entry.action, { action: entry.action, role: entry.role as number });
    }
    return [...result.values()];
  }
  function scopes(value: unknown): { readonly read: number; readonly edit: number } {
    if (value === undefined) return { read: ObjectScope.SomeCollaborator, edit: ObjectScope.OneSelf };
    const scope = record(value);
    if (!scopeValues.has(scope.read as number) || !scopeValues.has(scope.edit as number)) {
      invalid("Invalid object scope.");
    }
    return { read: scope.read as number, edit: scope.edit as number };
  }
  async function actionResults(
    userId: string,
    value: Record<string, unknown>,
    draft = false,
    canWrite = true,
  ) {
    const unitID = string(value.unitID);
    const objectID = string(value.objectID ?? unitID);
    const objectType = Number(value.objectType);
    const results = [];
    for (const action of array(value.actions)) {
      results.push({
        action,
        allowed:
          (canWrite || readActions.has(action as UnitAction)) &&
          await allowed(
            userId,
            { unitID, objectID, objectType, action: action as UnitAction },
            draft && (canWrite ? "write" : "review"),
          ),
      });
    }
    return results;
  }
  async function toCollaborators(entries: readonly ContentCollaborator[]) {
    const users = new Map(
      (await identity.findUsers(entries.map((entry) => entry.userId))).map((user) => [user.id, user]),
    );
    return entries.flatMap((entry) => {
      const user = users.get(entry.userId);
      return user ? [{ id: user.id, role: entry.role, subject: protocolUser(user) }] : [];
    });
  }

  const router = Router({ mergeParams: true });
  router.use(json({ limit: "1mb" }));
  router.use(async (request, response, next) => {
    const session = await identity.getSession(request.headers.cookie);
    response.locals.contentUserId = session.authenticated ? session.user.id : ANONYMOUS_USER_ID;
    response.setHeader("Cache-Control", "private, no-store");
    next();
  });
  router.use(async (request, response, next) => {
    const worktreeId =
      request.params.worktreeId === undefined ? undefined : string(request.params.worktreeId);
    response.locals.contentDraft = Boolean(worktreeId);
    response.locals.contentCanWrite = true;
    if (worktreeId) {
      if (
        !["/-/object/-/batch_allowed", "/-/object/list", "/collaborator"].includes(request.path) &&
        !request.path.endsWith("/allowed")
      )
        deny();
      const body = request.method === "GET" ? request.query : record(request.body);
      const requests =
        request.path === "/-/object/-/batch_allowed" ? array(body.requests).map(record) : [body];
      let canWrite = true;
      for (const item of requests) {
        const unitId = string(item.unitID);
        if (
          !(await options.worktrees.authorizeProtocol({
            userId: response.locals.contentUserId,
            worktreeId,
            unitId,
            write: false,
          }))
        )
          deny();
        canWrite =
          canWrite &&
          (await options.worktrees.authorizeProtocol({
            userId: response.locals.contentUserId,
            worktreeId,
            unitId,
            write: true,
          }));
      }
      response.locals.contentCanWrite = canWrite;
    }
    next();
  });
  router.post("/-/object/-/batch_allowed", async (request, response) => {
    const body = record(request.body);
    const objectActions = [];
    for (const raw of array(body.requests)) {
      const item = record(raw);
      objectActions.push({
        unitID: string(item.unitID),
        objectID: string(item.objectID ?? item.unitID),
        actions: await actionResults(
          response.locals.contentUserId,
          item,
          response.locals.contentDraft,
          response.locals.contentCanWrite,
        ),
      });
    }
    response.json({ error: ok, objectActions });
  });
  router.post("/:objectType/object/:objectId/allowed", async (request, response) => {
    response.json({
      error: ok,
      actions: await actionResults(
        response.locals.contentUserId,
        {
          ...record(request.body),
          objectID: request.params.objectId,
          objectType: request.params.objectType,
        },
        response.locals.contentDraft,
        response.locals.contentCanWrite,
      ),
    });
  });
  router.use((_request, response, next) => {
    if (response.locals.contentUserId === ANONYMOUS_USER_ID) deny();
    next();
  });
  router.post("/-/object/list", async (request, response) => {
    const body = record(request.body);
    const unitId = string(body.unitID);
    if (!response.locals.contentDraft) await requireUnit(response.locals.contentUserId, unitId);
    const objects = [];
    for (const id of array(body.objectIDs)) {
      const object = await repository.get(unitId, string(id));
      if (!object) continue;
      const [creator] = await identity.findUsers([object.creatorUserId]);
      objects.push({
        unitID: unitId,
        objectID: object.id,
        objectType: object.objectType,
        name: object.name,
        creator: creator ? protocolUser(creator) : undefined,
        strategies: object.strategies,
        scope: { read: object.readScope, edit: object.editScope },
        shareOn: false,
        shareRole: UnitRole.Owner,
        shareScope: 0,
        actions: await actionResults(
          response.locals.contentUserId,
          {
            unitID: unitId,
            objectID: object.id,
            objectType: object.objectType,
            actions: body.actions ?? [],
          },
          response.locals.contentDraft,
          response.locals.contentCanWrite,
        ),
      });
    }
    response.json({ error: ok, objects });
  });
  router.post("/:objectType/object", async (request, response) => {
    const userId = response.locals.contentUserId as string;
    const body = record(request.body);
    const objectType = Number(request.params.objectType);
    if (body.objectType !== objectType || !objectTypes.has(objectType))
      invalid("Invalid object type.");
    const kind = objectTypes.get(objectType)!;
    const key =
      objectType === UnitObject.SelectRange
        ? "selectRangeObject"
        : objectType === UnitObject.Worksheet
          ? "worksheetObject"
          : {
              doc: "documentObject",
              slide: "slideObject",
              board: "boardObject",
              base: "baseObject",
            }[kind];
    const input = record(body[key!]);
    const unitId = string(input.unitID);
    const resource = await requireUnit(userId, unitId, true);
    if (!resource.unitType || resource.unitType !== kind) invalid("Object type does not belong to this Unit.");
    const scope = scopes(input.scope);
    const object: ContentPermissionObject = {
      id: randomUUID(),
      unitId,
      objectType,
      creatorUserId: userId,
      name: string(input.name ?? "", true),
      strategies: strategies(input.strategies),
      readScope: scope.read,
      editScope: scope.edit,
      collaborators: collaborators(input.collaborators, userId),
    };
    // Persist before the SDK submits the binding. Retain unattached ACLs for retry,
    // undo and history; only permanent Resource deletion cascades their removal.
    requireSaved(await repository.create(object, resource.unitType));
    response.json({ error: ok, objectID: object.id });
  });
  router.put("/:objectType/object/:objectId", async (request, response) => {
    const body = record(request.body);
    const objectId = string(request.params.objectId);
    const unitId = string(body.unitID);
    const object = await requireManaged(response.locals.contentUserId, unitId, objectId);
    if (
      body.objectID !== objectId ||
      body.objectType !== object.objectType ||
      Number(request.params.objectType) !== object.objectType
    ) {
      invalid("Object identity mismatch.");
    }
    const scope = body.scope === undefined ? null : scopes(body.scope);
    // The sheet panel sends an empty strategies array when only people or scope change.
    const nextStrategies =
      body.strategies === undefined ||
      (Array.isArray(body.strategies) && body.strategies.length === 0)
        ? null
        : strategies(body.strategies);
    const result = await repository.update(response.locals.contentUserId, unitId, objectId, {
      name: body.name == null ? null : string(body.name, true),
      strategies: nextStrategies,
      scope,
      collaborators: body.collaborators === undefined
        ? null
        : collaborators(record(body.collaborators).collaborators, object.creatorUserId),
    });
    requireSaved(result);
    response.json({ error: ok });
  });
  router.get("/collaborator", async (request, response) => {
    const unitId = string(request.query.unitID);
    const objectId = string(request.query.objectID);
    await requireUnit(response.locals.contentUserId, unitId);
    const entries: ContentCollaborator[] = [];
    if (objectId === unitId) {
      for (const userId of await repository.candidateUserIds(unitId)) {
        const resource = await access.resolveUnitContent(userId, unitId);
        if (!resource) continue;
        const role = resource.role === "owner" || resource.role === "admin"
          ? UnitRole.Owner
          : resource.capabilities.editContent ? UnitRole.Editor : UnitRole.Reader;
        entries.push({ userId, role });
      }
    } else {
      const object = await repository.get(unitId, objectId);
      if (!object) deny();
      entries.push({ userId: object.creatorUserId, role: UnitRole.Owner }, ...object.collaborators);
    }
    response.json({
      error: ok,
      collaborators: await toCollaborators(entries),
      cfgEnableObjInherit: true,
    });
  });

  router.use(((error: unknown, _request, response, next) => {
    if (!(error instanceof CollabError)) {
      next(error);
      return;
    }
    const forbidden = error.code === "PERMISSION_DENIED";
    response.status(forbidden ? 403 : 400).json({
      error: {
        code: forbidden ? ErrorCode.PERMISSION_DENIED : ErrorCode.INVALID_ARGUMENT,
        message: error.message,
      },
    });
  }) satisfies ErrorRequestHandler);
  return { router, allowed };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Expected an object.");
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 1000)
    invalid("Expected an array with at most 1000 items.");
  return value;
}
function string(value: unknown, empty = false): string {
  if (typeof value !== "string" || (!empty && !value) || value.length > 1000)
    invalid("Invalid string.");
  return value;
}
function requireSaved(result: ContentPermissionWriteResult): void {
  if (result === "denied") deny();
  if (result === "invalid-collaborator") invalid("Collaborator must already have access to this Unit.");
}
function invalid(message: string): never {
  throw new CollabError("INVALID_REQUEST", message);
}
function deny(): never {
  throw new CollabError("PERMISSION_DENIED", "Content permission denied.");
}

export type ContentPermissions = ReturnType<typeof createContentPermissions>;
