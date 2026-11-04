import type { IPresetPlugin } from "@univerjs/presets";
import { api } from "../../../../shared/api/client";
import {
  WORKSPACE_EXCHANGE_DEFINITIONS,
  type WorkspaceExchangeUnitType,
} from "./definitions";
import { createWorkspaceImportExportPlugin } from "./plugin";

export { exchangeIds, WORKSPACE_EXCHANGE_DEFINITIONS } from "./definitions";
export type { WorkspaceExchangeUnitType } from "./definitions";

const plugins = new Map<
  WorkspaceExchangeUnitType,
  ReturnType<typeof createWorkspaceImportExportPlugin>
>();

async function resolveUnitNode(unitId: string) {
  const { data } = await api.GET("/api/unit-resources/{unitId}", {
    params: { path: { unitId } },
  });
  return data?.node;
}

/** The server imports into the Personal Space root; open the new Node there. */
async function resolveImportedUnitLink(unitId: string): Promise<string | undefined> {
  const node = await resolveUnitNode(unitId);
  return node ? new URL(`/nodes/${node.id}`, window.location.origin).href : undefined;
}

async function resolveUnitName(unitId: string): Promise<string | undefined> {
  return (await resolveUnitNode(unitId))?.name;
}

/** Workspace import/export UI for one editor; add it with the headless exchange plugins. */
export function createWorkspaceImportExportFeature(
  unitType: WorkspaceExchangeUnitType,
  options: { readonly mobile: boolean }
): IPresetPlugin {
  let plugin = plugins.get(unitType);
  if (!plugin) {
    plugin = createWorkspaceImportExportPlugin(WORKSPACE_EXCHANGE_DEFINITIONS[unitType]);
    plugins.set(unitType, plugin);
  }
  return [
    plugin,
    { mobile: options.mobile, resolveUnitLink: resolveImportedUnitLink, resolveUnitName },
  ];
}
