import { randomUUID } from "node:crypto";
import { Router, json, type ErrorRequestHandler } from "express";
import { CollabError, type RequiredUnitPermission } from "@univerjs-pro/collaboration-service";
import { ErrorCode, ObjectScope, UnitAction, UnitObject, UnitRole } from "@univerjs/protocol";
import type { AccessResolver, ResourceContentAccess } from "../../modules/access/index.js";
import { ANONYMOUS_USER_ID, type IdentityModule } from "../../modules/identity/index.js";
import type {
  ContentPermissionsRepository,
  ContentPermissionObject,
  ContentCollaborator,
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

  function allowed(
    userId: string,
    requirement: Pick<RequiredUnitPermission, "unitID" | "objectID" | "objectType" | "action">,
    draft = false,
  ): boolean {
    const { unitID, objectID, objectType, action } = requirement;
    if (!knownAction(action)) return false;
    // Draft rules are inherited; neither bindings nor policy can be managed here.
    if (draft && management.has(action)) return false;
    const resource = access.resolveUnitContent(userId, unitID);
    if (objectID === unitID) {
      // Worktree-local Units have no published Resource yet. The caller MUST first
      // authorize the mapped Worktree Unit through authorizeProtocol.
      if (draft && !resource) return !management.has(action) && action !== UnitAction.Share;
      return unitActionAllowed(resource, action);
    }
    if (!resource?.unitType || objectTypes.get(objectType) !== resource.unitType) return false;
    const object = repository.get(unitID, objectID);
    if (!object || object.objectType !== objectType) return false;
    if (readActions.has(action)) return resource.capabilities.openContent;
    if (!resource.capabilities.editContent || action === UnitAction.Share) return false;
    if (resource.role === "owner" || resource.role === "admin") return true;
    const creator = object.creatorUserId === userId;
    if (management.has(action)) return creator;
    if (creator) return true;
    const role =
      object.editScope === ObjectScope.AllCollaborator
        ? UnitRole.Editor
        : object.editScope === ObjectScope.OneSelf
          ? undefined
          : object.collaborators.find((user) => user.userId === userId)?.role;
    const minimum =
      object.strategies.find((strategy) => strategy.action === action)?.role ?? UnitRole.Editor;
    return role !== undefined && role >= minimum;
  }

  function requireUnit(userId: string, unitId: string, edit = false) {
    const resource = access.resolveUnitContent(userId, unitId);
    if (!resource?.capabilities.openContent || (edit && !resource.capabilities.editContent)) deny();
    return resource;
  }
  function requireManaged(userId: string, unitId: string, objectId: string) {
    const object = repository.get(unitId, objectId);
    if (
      !object ||
      !allowed(userId, {
        unitID: unitId,
        objectID: objectId,
        objectType: object.objectType,
        action: UnitAction.ManageCollaborator,
      })
    )
      deny();
    return object;
  }
  function collaborators(value: unknown, creator: string, unitId: string): ContentCollaborator[] {
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
      if (
        !identity.findUsers([userId]).length ||
        !access.resolveUnitContent(userId, unitId)?.capabilities.openContent
      ) {
        invalid("Collaborator must already have access to this Unit.");
      }
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
  function editScope(value: unknown, previous = ObjectScope.OneSelf): number {
    if (value === undefined) return previous;
    const scope = record(value);
    // This feature protects edits, not snapshot/history/export visibility.
    if (scope.read !== ObjectScope.AllCollaborator) invalid("Content hiding is not supported.");
    if (
      ![ObjectScope.AllCollaborator, ObjectScope.OneSelf, ObjectScope.SomeCollaborator].includes(
        scope.edit as number,
      )
    ) {
      invalid("Invalid edit scope.");
    }
    return scope.edit as number;
  }
  function actionResults(
    userId: string,
    value: Record<string, unknown>,
    draft = false,
    canWrite = true,
  ) {
    const unitID = string(value.unitID);
    const objectID = string(value.objectID ?? unitID);
    const objectType = Number(value.objectType);
    return array(value.actions).map((action) => ({
      action,
      allowed:
        (canWrite || readActions.has(action as UnitAction)) &&
        allowed(userId, { unitID, objectID, objectType, action: action as UnitAction }, draft),
    }));
  }
  function toCollaborators(entries: readonly ContentCollaborator[]) {
    const users = new Map(
      identity.findUsers(entries.map((entry) => entry.userId)).map((user) => [user.id, user]),
    );
    return entries.flatMap((entry) => {
      const user = users.get(entry.userId);
      return user ? [{ id: user.id, role: entry.role, subject: protocolUser(user) }] : [];
    });
  }

  const router = Router({ mergeParams: true });
  router.use(json({ limit: "1mb" }));
  router.use((request, response, next) => {
    const session = identity.getSession(request.headers.cookie);
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
  router.post("/-/object/-/batch_allowed", (request, response) => {
    const body = record(request.body);
    response.json({
      error: ok,
      objectActions: array(body.requests).map((raw) => {
        const item = record(raw);
        return {
          unitID: string(item.unitID),
          objectID: string(item.objectID ?? item.unitID),
          actions: actionResults(
            response.locals.contentUserId,
            item,
            response.locals.contentDraft,
            response.locals.contentCanWrite,
          ),
        };
      }),
    });
  });
  router.post("/:objectType/object/:objectId/allowed", (request, response) => {
    response.json({
      error: ok,
      actions: actionResults(
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
  router.post("/-/object/list", (request, response) => {
    const body = record(request.body);
    const unitId = string(body.unitID);
    if (!response.locals.contentDraft) requireUnit(response.locals.contentUserId, unitId);
    const objects = array(body.objectIDs).flatMap((id) => {
      const object = repository.get(unitId, string(id));
      if (!object) return [];
      const creator = identity.findUsers([object.creatorUserId])[0];
      return [
        {
          unitID: unitId,
          objectID: object.id,
          objectType: object.objectType,
          name: object.name,
          creator: creator ? protocolUser(creator) : undefined,
          strategies: object.strategies,
          scope: { read: ObjectScope.AllCollaborator, edit: object.editScope },
          shareOn: false,
          shareRole: UnitRole.Owner,
          shareScope: 0,
          actions: actionResults(
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
        },
      ];
    });
    response.json({ error: ok, objects });
  });
  router.post("/:objectType/object", (request, response) => {
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
    const resource = requireUnit(userId, unitId, true);
    if (resource.unitType !== kind) invalid("Object type does not belong to this Unit.");
    const object: ContentPermissionObject = {
      id: randomUUID(),
      unitId,
      objectType,
      creatorUserId: userId,
      name: string(input.name ?? "", true),
      strategies: strategies(input.strategies),
      editScope: editScope(input.scope),
      collaborators: collaborators(input.collaborators, userId, unitId),
    };
    // Persist before the SDK submits the binding. Retain unattached ACLs for retry,
    // undo and history; only permanent Resource deletion cascades their removal.
    repository.create(object);
    response.json({ error: ok, objectID: object.id });
  });
  router.put("/:objectType/object/:objectId", (request, response) => {
    const body = record(request.body);
    const objectId = string(request.params.objectId);
    const unitId = string(body.unitID);
    const object = requireManaged(response.locals.contentUserId, unitId, objectId);
    if (
      body.objectID !== objectId ||
      body.objectType !== object.objectType ||
      Number(request.params.objectType) !== object.objectType
    ) {
      invalid("Object identity mismatch.");
    }
    const nextStrategies = strategies(body.strategies);
    repository.update({
      ...object,
      name: string(body.name ?? object.name, true),
      strategies: body.strategies === undefined ? object.strategies : nextStrategies,
      editScope: editScope(body.scope, object.editScope),
      collaborators:
        body.collaborators === undefined
          ? object.collaborators
          : collaborators(record(body.collaborators).collaborators, object.creatorUserId, unitId),
    });
    response.json({ error: ok });
  });
  router.get("/collaborator", (request, response) => {
    const unitId = string(request.query.unitID);
    const objectId = string(request.query.objectID);
    requireUnit(response.locals.contentUserId, unitId);
    let entries: readonly ContentCollaborator[];
    if (objectId === unitId) {
      entries = repository.candidateUserIds(unitId).flatMap((userId) => {
        const resource = access.resolveUnitContent(userId, unitId);
        return resource
          ? [
              {
                userId,
                role:
                  resource.role === "owner" || resource.role === "admin"
                    ? UnitRole.Owner
                    : resource.capabilities.editContent
                      ? UnitRole.Editor
                      : UnitRole.Reader,
              },
            ]
          : [];
      });
    } else {
      const object = repository.get(unitId, objectId);
      if (!object) deny();
      entries = [{ userId: object.creatorUserId, role: UnitRole.Owner }, ...object.collaborators];
    }
    response.json({
      error: ok,
      collaborators: toCollaborators(entries),
      cfgEnableObjInherit: false,
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
function invalid(message: string): never {
  throw new CollabError("INVALID_REQUEST", message);
}
function deny(): never {
  throw new CollabError("PERMISSION_DENIED", "Content permission denied.");
}

export type ContentPermissions = ReturnType<typeof createContentPermissions>;
