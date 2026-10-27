import React, { useEffect, useRef, useState } from 'react';
import {
  createUniver,
  LocaleType,
  LifecycleStages,
  mergeLocales,
} from '@univerjs/presets';
import {
  UniverDocsCorePreset,
  UniverDocsUIPlugin,
} from '@univerjs/preset-docs-core';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import docsLocale from '@univerjs/preset-docs-core/locales/zh-CN';
import sheetsLocale from '@univerjs/preset-sheets-core/locales/zh-CN';
import { Univer } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { CollaborationController } from '@univerjs-pro/collaboration-client';
import { EMPTY } from 'rxjs';
import type { Content } from './model.js';
import {
  officePreset,
  officeLocales,
  SetSlideZoomRatioOperation,
} from './office-presets.js';
import { viewerData } from './viewer-data.js';
import { UniverLicensePlugin } from '@univerjs-pro/license';
import { workspaceLicense } from './license.js';
import { contentType } from './content-types.js';

/** One disposable, disconnected SDK viewer. No collaboration/write transport. */
export function Viewer({ file }: { file: Content }) {
  return <OfficeViewer file={file} />;
}
function OfficeViewer({ file }: { file: Content }) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  useEffect(() => {
    const element = container.current!;
    let canceled = false;
    let runtime: ReturnType<typeof createUniver> | undefined;
    let fitObserver: ResizeObserver | undefined;
    let fitFrame = 0;
    let lifecycle: { dispose(): void } | undefined;
    let steadyLifecycle: { dispose(): void } | undefined;
    setStatus('loading');
    setError('');
    const timer = setTimeout(
      () => fail(new Error('阅读器初始化超时，请关闭文件后重试。')),
      15000,
    );
    try {
      const config = {
        container: element,
        header: false,
        toolbar: false,
        contextMenu: false,
        disableAutoFocus: true,
      } as const;
      runtime = createPreview({
        locale: LocaleType.ZH_CN,
        locales: {
          [LocaleType.ZH_CN]: mergeLocales(
            docsLocale,
            sheetsLocale,
            ...officeLocales,
          ),
        },
        presets: [
          { plugins: [[UniverLicensePlugin, { license: workspaceLicense }]] },
          file.type === 'doc'
            ? UniverDocsCorePreset({ ...config, footer: false })
            : file.type === 'sheet'
              ? UniverSheetsCorePreset({
                  ...config,
                  disableAutoFocus: true,
                  formulaBar: true,
                  footer: {
                    sheetBar: true,
                    statisticBar: false,
                    menus: false,
                    zoomSlider: true,
                    addSheetButtonConfig: { show: false },
                  },
                })
              : officePreset(file.type as 'slide' | 'base' | 'board', element),
          ...(file.type === 'doc'
            ? [
                {
                  plugins: [
                    [
                      UniverDocsUIPlugin,
                      {
                        fitToWidth: {
                          mode: 'fit-width',
                          target: 'container',
                          paddingX: 24,
                          minScale: 0.25,
                          maxScale: 1,
                          align: 'center',
                        },
                      },
                    ],
                  ],
                } as import('@univerjs/presets').IPreset,
              ]
            : []),
        ],
      });
      const api = runtime.univerAPI;
      const data = viewerData(file);
      // Node name is the authoritative product title; snapshot owns rich content.
      const document = file.type === 'doc'
        ? api.createDocument({ ...data, title: file.name }, { makeCurrent: false })
        : undefined;
      const permission = file.type === 'doc' ? Promise.resolve()
          : file.type === 'sheet'
            ? Promise.resolve(
                api
                  .createWorkbook({ ...data, name: file.name })
                  .setEditable(false),
              )
            : (file.type === 'slide'
                ? api.createPresentation(data)
                : file.type === 'base'
                  ? api.createBase(data)
                  : api.createBoard(data)
              )
                .getPermission()
                .setReadOnly();
      // Activate Docs after the SDK workbench has a sized render container.
      // Immediate activation can publish the first layout into a zero-size
      // canvas in a host slot. setCurrent is the public SDK activation API.
      const mounted =
        file.type !== 'doc'
          ? Promise.resolve()
          : new Promise<void>((resolve, reject) => {
              const activate = () => {
                if (canceled) return;
                lifecycle?.dispose();
                lifecycle = undefined;
                try {
                  api.setCurrent(file.unitId);
                  resolve();
                } catch (cause) {
                  reject(cause);
                }
              };
              if (api.getCurrentLifecycleStage() >= LifecycleStages.Rendered)
                activate();
              else
                lifecycle = api.addEvent(
                  api.Event.LifeCycleChanged,
                  ({ stage }) => {
                    if (stage >= LifecycleStages.Rendered) activate();
                  },
                );
            });
      const settled = new Promise<void>((resolve) => {
        const finish = () => {
          steadyLifecycle?.dispose(); steadyLifecycle = undefined;
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        };
        if (api.getCurrentLifecycleStage() >= LifecycleStages.Steady) finish();
        else steadyLifecycle = api.addEvent(api.Event.LifeCycleChanged, ({ stage }) => { if (stage >= LifecycleStages.Steady) finish(); });
      });
      void Promise.all([permission, mounted, settled])
        .then(async () => {
          // Docs UI refreshes header/footer fields during activation. Applying
          // read-only before that initialization emits a real permission error.
          // This disconnected Viewer cannot write to Server; autofocus is off
          // and its loading cover remains until permission has been installed.
          if (!canceled) await document?.getPermission().setReadOnly();
        })
        .then(() => {
          clearTimeout(timer);
          if (!canceled) {
            setStatus('ready');
            if (file.type === 'slide') {
              const size = api.getPresentation(file.unitId)?.getPageSize();
              if (size) {
                const fit = () => {
                  cancelAnimationFrame(fitFrame);
                  fitFrame = requestAnimationFrame(() => {
                    if (canceled) return;
                    void api.executeCommand(SetSlideZoomRatioOperation.id, {
                      unitId: file.unitId,
                      zoomRatio: Math.max(
                        0.1,
                        Math.min(
                          1,
                          (element.clientWidth - 390) / size.width,
                          (element.clientHeight - 90) / size.height,
                        ),
                      ),
                    });
                  });
                };
                fitObserver = new ResizeObserver(fit);
                fitObserver.observe(element);
                fit();
              }
            }
          }
        })
        .catch(fail);
    } catch (cause) {
      fail(cause);
    }
    function fail(cause: unknown) {
      clearTimeout(timer);
      if (!canceled) {
        setStatus('error');
        setError(
          cause instanceof Error ? cause.message : 'Univer 无法显示此文件',
        );
      }
    }
    return () => {
      canceled = true;
      clearTimeout(timer);
      lifecycle?.dispose();
      steadyLifecycle?.dispose();
      fitObserver?.disconnect();
      cancelAnimationFrame(fitFrame);
      queueMicrotask(() => runtime?.univer.dispose());
    };
  }, [file.nodeId, file.sha256]);
  return (
    <div
      className="sp-viewer"
      data-viewer-state={status}
      data-document-flavor={file.type === 'doc' ? 'modern' : undefined}
      aria-label={`${file.type} 阅读视图`}
    >
      <div className="sp-sdk" ref={container} />
      {status !== 'ready' && (
        <div
          className="sp-viewer-message"
          role={status === 'error' ? 'alert' : 'status'}
        >
          {status === 'loading' ? (
            <>
              <span className="sp-spinner" />
              正在打开 {contentType(file.type)?.createLabel ?? 'File'}…
            </>
          ) : (
            <>
              <strong>无法渲染文件</strong>
              <p>{error}</p>
              <p>请关闭文件后重新打开。</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Keep the other detached previews compatible with process-global Facade mixins.
 * Same pre-Facade registration used by Browser comparison-univer.ts. This stub
 * only disables the global event source; it creates no transport or editing grant.
 */
function createPreview(options: Parameters<typeof createUniver>[0]) {
  const { presets, plugins, ...config } = options;
  const univer = new Univer(config);
  univer.__getInjector().add([
    CollaborationController,
    {
      useValue: { entityInit$: EMPTY } as unknown as CollaborationController,
    },
  ]);
  const registry = new Map<string, import('@univerjs/presets').IPresetPlugin>();
  for (const preset of presets ?? [])
    for (const entry of (Array.isArray(preset) ? preset[0] : preset).plugins) {
      const ctor = Array.isArray(entry) ? entry[0] : entry;
      registry.set(ctor.pluginName, entry);
    }
  for (const entry of [...registry.values(), ...(plugins ?? [])]) {
    if (Array.isArray(entry)) univer.registerPlugin(entry[0], entry[1]);
    else univer.registerPlugin(entry);
  }
  return { univer, univerAPI: FUniver.newAPI(univer) };
}
