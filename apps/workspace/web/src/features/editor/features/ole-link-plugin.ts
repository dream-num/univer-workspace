import {
  IConfigService,
  Injector,
  Plugin,
  UniverInstanceType,
  setDependencies,
} from "@univerjs/core";
import type { IUniverDrawingConfig } from "@univerjs/drawing";

const DRAWING_CONFIG_KEY = "drawing.config";

/** The Workspace page that opens a Unit by its ID, used for converted Office attachments. */
export function workspaceUnitLink(unitId: string): string {
  return `/preview/${encodeURIComponent(unitId)}`;
}

/**
 * SDK 1.4 Office attachments offer "convert to online document" and "open" only when
 * `drawing.config.ole.getLink` resolves a Unit to an application URL. The drawing presets
 * expose no `ole` option, so this plugin adds the link the same way `collaboration-client`
 * adds `attachmentIo`: on top of the config that is already there, never replacing it.
 */
export class WorkspaceOleLinkPlugin extends Plugin {
  static override pluginName = "WORKSPACE_OLE_LINK_PLUGIN";
  static override packageName = "@univerjs/univer-workspace";
  static override type = UniverInstanceType.UNIVER_UNKNOWN;

  constructor(
    _config: undefined,
    protected override readonly _injector: Injector,
    private readonly _configService: IConfigService,
  ) {
    super();
  }

  override onReady(): void {
    const drawing = this._configService.getConfig<IUniverDrawingConfig>(DRAWING_CONFIG_KEY) ?? {};
    if (drawing.ole?.getLink) return;
    this._configService.setConfig(DRAWING_CONFIG_KEY, {
      ...drawing,
      ole: {
        ...drawing.ole,
        getLink: (unitId: string) => workspaceUnitLink(unitId),
      },
    });
  }
}

setDependencies(WorkspaceOleLinkPlugin, [Injector, IConfigService]);
