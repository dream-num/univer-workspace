import React, { useSyncExternalStore } from 'react';
import type { Face } from './client.js';
import { PageViewer } from './components/page-viewer.js';
import { Navigation } from './components/navigation.js';
import { ContentBrowser } from './components/content-browser.js';
import { Settings } from './components/settings.js';
import { Icon, button, iconButton, Empty } from './components/primitives.js';

export { NativeConversation } from './components/floating-chat.js';
import { FloatingChat } from './components/floating-chat.js';

export function SpaceView(
  props: Face & {
    SessionProvider: React.ComponentType<any>;
    renderSlot: (name: string, args: object) => React.ReactNode;
  },
) {
  const v = useSyncExternalStore(
    props.store.subscribe,
    props.store.getSnapshot,
  );
  return (
    <div className="sp-shell">
      <div className="tw-relative tw-flex tw-h-full tw-w-full tw-min-w-0 tw-overflow-hidden tw-bg-canvas tw-font-sans tw-text-[13px] tw-text-ink">
        <Navigation face={props} v={v} />
        <main
          style={{ containerType: 'inline-size', containerName: 'sp-main' }}
          className="tw-flex tw-min-h-0 tw-min-w-0 tw-flex-1 tw-flex-col"
        >
          {(v.error || v.notice) && (
            <div
              role={v.error ? 'alert' : 'status'}
              className="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-bg-hover tw-px-5 tw-py-2 tw-text-xs"
            >
              <span>{v.error || v.notice}</span>
              <button
                className={iconButton}
                aria-label="关闭提示"
                onClick={() => props.update({ error: '', notice: '' })}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
          {v.busy && (
            <div
              role="status"
              aria-label="加载中"
              className="tw-absolute tw-inset-x-0 tw-top-0 tw-z-30 tw-h-0.5 tw-bg-neutral-300"
            />
          )}
          {v.status.state !== 'connected' ? (
            <Empty title="连接你的 Workspace">
              <p>浏览文档与表格，在已有对话中一起工作。</p>
              <button
                className={button + ' tw-bg-hover'}
                onClick={() => props.update({ settings: true })}
              >
                连接 Workspace
              </button>
            </Empty>
          ) : v.content ? (
            <PageViewer face={props} v={v} />
          ) : (
            <ContentBrowser
              key={`${v.location}:${v.space}:${v.parent}`}
              face={props}
              v={v}
            />
          )}
        </main>
        <FloatingChat
          face={props}
          v={v}
          SessionProvider={props.SessionProvider}
          renderSlot={props.renderSlot}
        />
        {v.settings && <Settings face={props} v={v} />}
      </div>
    </div>
  );
}
