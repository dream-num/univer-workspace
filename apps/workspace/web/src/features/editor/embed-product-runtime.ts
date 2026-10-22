import {
  LocaleService,
  LocaleType,
  UniverInstanceType,
  type ILanguagePack,
  type Univer,
} from "@univerjs/core";
import type { IPreset, IPresetPlugin } from "@univerjs/presets";

interface EmbedProductDefinition {
  readonly presets: readonly IPreset[];
  readonly locales: Readonly<Record<"zh-CN" | "en-US", ILanguagePack>>;
}

/** Product runtimes belong to this editor, not to an individual embed shape. */
export function createEmbedProductRuntime(input: {
  readonly univer: Univer;
  readonly container: HTMLElement;
  readonly license: string;
  readonly plugins: readonly IPresetPlugin[];
}) {
  const registered = new Set(input.plugins.map(pluginName));
  const products = new Map<UniverInstanceType, Promise<void>>();
  let registration = Promise.resolve();
  let disposed = false;
  const workers = new Set<Worker>();
  const dispose = () => {
    disposed = true;
    for (const worker of workers) worker.terminate();
    workers.clear();
  };
  const lifecycle = input.univer.onDispose(dispose);

  return {
    ensure(unitType: UniverInstanceType): Promise<void> {
      if (disposed) return Promise.reject(new Error("The embed editor was disposed."));
      const existing = products.get(unitType);
      if (existing) return existing;
      let registrationStarted = false;
      const pending = registration.then(async () => {
        if (disposed) throw new Error("The embed editor was disposed.");
        const createDefinition = await loadEmbedProduct(
          unitType,
          input.container,
          input.license,
          registered,
          (worker) => workers.add(worker),
        );
        if (disposed) throw new Error("The embed editor was disposed.");
        const definition = createDefinition();
        input.univer
          .__getInjector()
          .get(LocaleService)
          .load({
            [LocaleType.ZH_CN]: definition.locales["zh-CN"],
            [LocaleType.EN_US]: definition.locales["en-US"],
          });
        for (const preset of definition.presets) {
          for (const plugin of preset.plugins) {
            const name = pluginName(plugin);
            if (registered.has(name)) continue;
            try {
              registrationStarted = true;
              if (Array.isArray(plugin)) input.univer.registerPlugin(plugin[0], plugin[1]);
              else input.univer.registerPlugin(plugin);
            } catch (error) {
              // shortcut: SDK 1.0.3 auto-registers dependencies but exposes no hasPlugin().
              // Remove this duplicate-only fallback when the SDK exposes a registry query.
              if (
                !(error instanceof Error) ||
                !error.message.startsWith(`[PluginService]: duplicated plugin name for "${name}".`)
              )
                throw error;
            }
            registered.add(name);
          }
        }
      });
      // Imports can be retried. A failed SDK registration can leave its registry
      // partially initialized, so keep that product failed until this editor closes.
      registration = pending.catch(() => {
        if (!registrationStarted) products.delete(unitType);
      });
      products.set(unitType, pending);
      return pending;
    },
    dispose() {
      dispose();
      lifecycle.dispose();
    },
  };
}

function pluginName(plugin: IPresetPlugin): string {
  return (Array.isArray(plugin) ? plugin[0] : plugin).pluginName;
}

async function loadEmbedProduct(
  unitType: UniverInstanceType,
  container: HTMLElement,
  license: string,
  registered: ReadonlySet<string>,
  onWorker: (worker: Worker) => void,
): Promise<() => EmbedProductDefinition> {
  switch (unitType) {
    case UniverInstanceType.UNIVER_SHEET: {
      const { createSheetComparisonPresets, sheetEditorLocales } =
        await import("./units/sheet/sheet-comparison-presets");
      return () => ({
        locales: sheetEditorLocales,
        presets: createSheetComparisonPresets({ container, license }),
      });
    }
    case UniverInstanceType.UNIVER_DOC: {
      const { createDocComparisonPresets, docEditorLocales } =
        await import("./units/doc/doc-editor");
      return () => ({ locales: docEditorLocales, presets: createDocComparisonPresets(container) });
    }
    case UniverInstanceType.UNIVER_SLIDE: {
      const { createSlideComparisonPresets, slideEditorLocales } =
        await import("./units/slide/slide-editor");
      return () => ({
        locales: slideEditorLocales,
        presets: createSlideComparisonPresets(container, true),
      });
    }
    case UniverInstanceType.UNIVER_BASE: {
      const { createBaseComparisonPresets, baseEditorLocales } =
        await import("./units/base/base-editor");
      return () => ({
        locales: baseEditorLocales,
        presets: createBaseComparisonPresets(container, {
          collaboration: true,
          onWorker,
          worker: !registered.has("UNIVER_RPC_MAIN_THREAD_PLUGIN"),
        }),
      });
    }
    case UniverInstanceType.UNIVER_BOARD: {
      const { createBoardComparisonPresets, boardEditorLocales } =
        await import("./units/board/board-editor");
      return () => ({
        locales: boardEditorLocales,
        presets: createBoardComparisonPresets(container, true),
      });
    }
    default:
      throw new Error(`Unsupported embed product: ${String(unitType)}`);
  }
}
