import {
  CommandType,
  CustomCommandExecutionError,
  ICommandService,
  LocaleType,
  LogLevel,
  Univer,
  UniverInstanceType,
  type ILanguagePack,
} from "@univerjs/core";
import { CollaborationController } from "@univerjs-pro/collaboration-client";
import { UniverLicensePlugin } from "@univerjs-pro/license";
import {
  type IPreset,
  type IPresetPlugin,
} from "@univerjs/presets";
import {
  defaultTheme,
  greenTheme,
  purpleTheme,
  redTheme,
  yellowTheme,
  type Theme,
} from "@univerjs/themes";
import type {
  IUnitComparisonUniverInstance,
  UnitComparisonUniverFactory,
} from "@univer/unit-comparison-viewer";
import { EMPTY } from "rxjs";
import type { AppLanguage } from "../../shared/i18n";
import { resolveUniverLicense } from "./univer-license";

interface ComparisonRenderingDefinition {
  readonly licenseProvidedByPreset?: boolean;
  readonly locales: Readonly<Record<AppLanguage, ILanguagePack>>;
  readonly presets: IPreset[];
  readonly theme: Theme;
}

export const createComparisonUniver: UnitComparisonUniverFactory = async (
  options
): Promise<IUnitComparisonUniverInstance> => {
  options.container.id ||= `workspace-comparison-pane-${Math.random()
    .toString(36)
    .slice(2)}`;
  const license = resolveUniverLicense();
  const language =
    options.locale === LocaleType.ZH_CN ? "zh-CN" : "en-US";
  const definition = await loadComparisonRenderingDefinition(
    options.unitType,
    options.container,
    license
  );
  const licensePreset: IPreset[] = definition.licenseProvidedByPreset
    ? []
    : [
        {
          plugins: [
            [
              UniverLicensePlugin,
              {
                license,
              },
            ],
          ],
        },
      ];
  const univer = createComparisonUniverRuntime({
    locale: options.locale,
    locales: {
      [options.locale]: definition.locales[language],
    },
    theme: definition.theme,
    darkMode: options.darkMode,
    logLevel: LogLevel.WARN,
    presets: [...licensePreset, ...definition.presets],
  });

  try {
    const injector = univer.__getInjector();
    blockComparisonEditingCommands(injector.get(ICommandService));

    let disposed = false;
    return {
      univer,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        univer.dispose();
      },
    };
  } catch (error) {
    univer.dispose();
    throw error;
  }
};

interface CreateComparisonUniverRuntimeOptions {
  readonly darkMode: boolean;
  readonly locale: LocaleType;
  readonly locales: Readonly<Record<string, ILanguagePack>>;
  readonly logLevel: LogLevel;
  readonly presets: readonly IPreset[];
  readonly theme: Theme;
}

/**
 * Build the local comparison runtime without asking the preset helper to create
 * a Facade API. Collaboration Facade mixins are process-global and resolve the
 * controller while an API is being created, so the local stub must exist first.
 */
export function createComparisonUniverRuntime(
  options: CreateComparisonUniverRuntimeOptions
): Univer {
  const { presets, ...univerOptions } = options;
  const univer = new Univer(univerOptions);
  const injector = univer.__getInjector();
  injector.add([
    CollaborationController,
    {
      useValue: {
        entityInit$: EMPTY,
      } as unknown as CollaborationController,
    },
  ]);
  registerComparisonPresets(univer, presets);
  return univer;
}

function registerComparisonPresets(
  univer: Univer,
  presets: readonly IPreset[]
): void {
  const pluginsByName = new Map<string, IPresetPlugin>();
  for (const preset of presets) {
    for (const plugin of preset.plugins) {
      const pluginConstructor = Array.isArray(plugin) ? plugin[0] : plugin;
      if (pluginsByName.has(pluginConstructor.pluginName)) {
        pluginsByName.delete(pluginConstructor.pluginName);
      }
      pluginsByName.set(pluginConstructor.pluginName, plugin);
    }
  }

  for (const plugin of pluginsByName.values()) {
    if (Array.isArray(plugin)) {
      univer.registerPlugin(plugin[0], plugin[1]);
    } else {
      univer.registerPlugin(plugin);
    }
  }
}

async function loadComparisonRenderingDefinition(
  unitType: Parameters<UnitComparisonUniverFactory>[0]["unitType"],
  container: HTMLElement,
  license: string
): Promise<ComparisonRenderingDefinition> {
  switch (unitType) {
    case UniverInstanceType.UNIVER_SHEET: {
      const { createSheetEditorPresets, sheetEditorLocales } = await import(
        "./sheet-presets"
      );
      return {
        licenseProvidedByPreset: true,
        locales: sheetEditorLocales,
        presets: createSheetEditorPresets({
          container,
          license,
          universerEndpoint: window.location.origin,
          threadCommentsEnabled: false,
          collaborationEnabled: false,
          workbenchChrome: "hidden",
        }),
        theme: greenTheme,
      };
    }
    case UniverInstanceType.UNIVER_DOC: {
      const { createDocComparisonPresets, docEditorLocales } = await import(
        "./doc-editor"
      );
      return {
        locales: docEditorLocales,
        presets: createDocComparisonPresets(container),
        theme: defaultTheme,
      };
    }
    case UniverInstanceType.UNIVER_SLIDE: {
      const { createSlideComparisonPresets, slideEditorLocales } = await import(
        "./slide-editor"
      );
      return {
        locales: slideEditorLocales,
        presets: createSlideComparisonPresets(container),
        theme: purpleTheme,
      };
    }
    case UniverInstanceType.UNIVER_BASE: {
      const { baseEditorLocales, createBaseComparisonPresets } = await import(
        "./base-editor"
      );
      return {
        locales: baseEditorLocales,
        presets: createBaseComparisonPresets(container),
        theme: yellowTheme,
      };
    }
    case UniverInstanceType.UNIVER_BOARD: {
      const { boardEditorLocales, createBoardComparisonPresets } = await import(
        "./board-editor"
      );
      return {
        locales: boardEditorLocales,
        presets: createBoardComparisonPresets(container),
        theme: redTheme,
      };
    }
    default:
      throw new Error(`Unsupported comparison unit type: ${String(unitType)}`);
  }
}

function blockComparisonEditingCommands(
  commandService: Pick<ICommandService, "beforeCommandExecuted">
): void {
  commandService.beforeCommandExecuted((commandInfo, options) => {
    if (
      commandInfo.type === CommandType.MUTATION &&
      options?.fromCollab !== true &&
      options?.onlyLocal !== true
    ) {
      throw new CustomCommandExecutionError(
        "Unit comparison viewer is read-only."
      );
    }
  });
}
