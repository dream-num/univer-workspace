/** Read-only policy and locale overrides for embedded Viewer instances. */

import {
  CommandType,
  CustomCommandExecutionError,
  ICommandService,
  IPermissionService,
  type ILanguagePack,
} from "@univerjs/core";
import {
  WorkbookCreateProtectPermission,
  WorkbookEditablePermission,
  WorkbookPrintPermission,
} from "@univerjs/sheets";
import type { ViewerUnitType } from "../viewer-types.ts";

export type ViewerReadOnlyEnforcement = "none" | "sheet-permission" | "mutation-gate";

/** Resolve read-only enforcement from scope-owned editability, never a Unit allowlist. */
export function resolveViewerReadOnlyEnforcement(
  unitType: ViewerUnitType,
  editable: boolean,
): ViewerReadOnlyEnforcement {
  if (editable) return "none";
  return unitType === "sheet" ? "sheet-permission" : "mutation-gate";
}

/** Disable Sheet actions whose Ribbon state is governed by workbook permissions. */
export function enforceSheetViewerReadOnlyPermissions(
  permissionService: Pick<IPermissionService, "addPermissionPoint" | "getPermissionPoint" | "updatePermissionPoint">,
  unitId: string,
): void {
  const points = [
    new WorkbookEditablePermission(unitId),
    new WorkbookCreateProtectPermission(unitId),
    new WorkbookPrintPermission(unitId),
  ];
  for (const point of points) {
    if (!permissionService.getPermissionPoint(point.id)) {
      permissionService.addPermissionPoint(point);
    }
    permissionService.updatePermissionPoint(point.id, false);
  }
}

/** Keep a viewer navigable while rejecting local model mutations. */
export function blockLocalEditingCommands(
  commandService: Pick<ICommandService, "beforeCommandExecuted">,
): void {
  commandService.beforeCommandExecuted((commandInfo, options) => {
    if (
      commandInfo.type === CommandType.MUTATION &&
      options?.fromCollab !== true &&
      options?.onlyLocal !== true
    ) {
      throw new CustomCommandExecutionError("viewer is read-only");
    }
  });
}

export interface ReadOnlyLocaleCopy {
  readonly title: string;
  readonly message: string;
}

const permissionErrorKeys = [
  "alertContent", "commonErr", "editErr", "pasteErr", "setStyleErr", "copyErr",
  "workbookCopyErr", "setRowColStyleErr", "moveRowColErr", "moveRangeErr",
  "insertRowColErr", "removeRowColErr", "autoFillErr", "filterErr",
  "operatorSheetErr", "insertOrDeleteMoveRangeErr", "printErr", "formulaErr",
  "hyperLinkErr", "commentErr",
] as const;

function permissionMessages(message: string): Record<string, string> {
  return Object.fromEntries(permissionErrorKeys.map((key) => [key, message]));
}

/** The beta.2 mergeLocales helper is shallow; permission overrides need deep merge. */
function mergeLocalePacks(...packs: readonly ILanguagePack[]): ILanguagePack {
  const merge = (target: Record<string, unknown>, source: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(source)) {
      const current = target[key];
      if (isPlainRecord(current) && isPlainRecord(value)) {
        merge(current, value);
      } else {
        target[key] = value;
      }
    }
  };
  const result: Record<string, unknown> = {};
  for (const pack of packs) merge(result, pack as unknown as Record<string, unknown>);
  return result as ILanguagePack;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Override permission copy only in a read-only viewer; editable keeps native text. */
export function withReadOnlyPermissionLocale(
  localePack: ILanguagePack,
  copy: ReadOnlyLocaleCopy,
): ILanguagePack {
  const messages = permissionMessages(copy.message);
  return mergeLocalePacks(localePack, {
    sheets: { permission: { dialog: messages } },
    "sheets-ui": { permission: { dialog: { ...messages, alert: copy.title } } },
    "sheets-drawing-ui": { permission: { dialog: { editErr: copy.message } } },
  } as unknown as ILanguagePack);
}

export const READ_ONLY_COPY: Record<"zh-CN" | "en-US", ReadOnlyLocaleCopy> = {
  "zh-CN": { title: "只读视图", message: "当前视图为只读；提交确认的修改请在对应 worktree 中进行。" },
  "en-US": { title: "Read-only view", message: "This view is read-only; confirmed edits live in their worktree." },
};
