import React, { useContext, useSyncExternalStore } from 'react';
import type { Face } from '../client.js';
import { ExpandedChat } from './floating-chat.js';
import { Icon, button, iconButton } from './primitives.js';
/** Public conversation.input.dock entry: the current Page sits at the native input. */
export function PageContextDock(
  props: Face & {
    sessionId: string;
    usePanelInfo(select: (info: any) => boolean): boolean;
  },
) {
  const expanded = useContext(ExpandedChat);
  const v = useSyncExternalStore(
    props.store.subscribe,
    props.store.getSnapshot,
  );
  const active = props.usePanelInfo(
    (info) => info.activePanelId === 'space-plugin',
  );
  if (!active || props.sessionId !== v.sessionId || !v.content || !v.context)
    return null;
  const c = v.context;
  const context = (
    <div
      className="sp-context"
      data-page-context={c.file.nodeId}
      data-context-state={c.state}
      aria-live="polite"
    >
      <Icon name={c.file.type} size={16} />
      <span className="tw-truncate">{c.file.name}</span>
      <span className="tw-text-xs tw-text-muted">
        {
          {
            linking: '关联中…',
            linked: '当前文档',
            removed: '未关联',
            failed: '关联失败',
          }[c.state]
        }
      </span>
      {(c.state === 'removed' || c.state === 'failed') && (
        <button
          className={button + ' tw-py-1 tw-text-xs'}
          onClick={props.reconnectContext}
        >
          关联
        </button>
      )}
      {c.state !== 'removed' && (
        <button
          className={iconButton}
          disabled={c.state === 'linking'}
          aria-label="Remove document association"
          title="移除文档关联"
          onClick={props.removeContext}
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
  const label = `${c.file.name} · ${{ linking: '关联中…', linked: '当前文档', removed: '未关联', failed: '关联失败' }[c.state]}`;
  return (
    <div className="sp-shell sp-context-dock">
      {expanded ? (
        context
      ) : (
        <details className="sp-context-compact" data-context-state={c.state}>
          <summary className={iconButton} aria-label={label} title={label}>
            <Icon name={c.file.type} size={16} />
          </summary>
          {context}
        </details>
      )}
    </div>
  );
}
