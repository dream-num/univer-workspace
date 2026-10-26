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
import type { Content } from './model.js';
import { viewerData } from './viewer-data.js';

/** One disposable, disconnected SDK viewer. No collaboration/write transport. */
export function Viewer({ file }: { file: Content }) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  useEffect(() => {
    const element = container.current!;
    let canceled = false;
    let runtime: ReturnType<typeof createUniver> | undefined;
    let lifecycle: { dispose(): void } | undefined;
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
      } as const;
      runtime = createUniver({
        locale: LocaleType.ZH_CN,
        locales: { [LocaleType.ZH_CN]: mergeLocales(docsLocale, sheetsLocale) },
        presets: [
          file.type === 'doc'
            ? UniverDocsCorePreset({ ...config, footer: false })
            : UniverSheetsCorePreset({
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
              }),
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
      const permission =
        file.type === 'doc'
          ? api
              .createDocument(
                { ...data, title: file.name },
                { makeCurrent: false },
              )
              .getPermission()
              .setReadOnly()
          : Promise.resolve(
              api
                .createWorkbook({ ...data, name: file.name })
                .setEditable(false),
            );
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
      void Promise.all([permission, mounted])
        .then(() => {
          clearTimeout(timer);
          if (!canceled) setStatus('ready');
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
      queueMicrotask(() => runtime?.univer.dispose());
    };
  }, [file.nodeId, file.sha256]);
  return (
    <div
      className="sp-viewer"
      data-document-flavor={file.type === 'doc' ? 'modern' : undefined}
      aria-label={`${file.type === 'doc' ? 'Document' : 'Sheet'} 阅读视图`}
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
              正在打开 {file.type === 'doc' ? 'Document' : 'Sheet'}…
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
