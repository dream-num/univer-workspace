import React, { useEffect, useRef, useState } from 'react';
import type { Face } from '../client.js';
import type { State } from '../model.js';
import { Icon, Menu, button, iconButton } from './primitives.js';
import { ExpandedChat, ChatInteraction } from './conversation-surface.js';
import { useChatDocking } from './use-chat-docking.js';
export { NativeConversation } from './conversation-surface.js';

export function FloatingChat({
  face,
  v,
  SessionProvider,
  renderSlot,
}: {
  face: Face;
  v: State;
  SessionProvider: React.ComponentType<any>;
  renderSlot: (name: string, args: object) => React.ReactNode;
}) {
  const [history, setHistory] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const panel = useRef<HTMLElement>(null),
    seat = useRef<HTMLDivElement>(null);
  const expanded = v.chatMode === 'expanded',
    minimized = v.chatMode === 'minimized';
  const hidden =
    (!v.content && !v.opening && v.location !== 'space') ||
    (!v.sessionId && !v.ai);
  const docking = useChatDocking(
    panel,
    seat,
    expanded,
    !hidden,
    `${v.content?.nodeId ?? ''}:${v.contentLoadId ?? ''}:${minimized}`,
  );
  const chrome = expanded || engaged;
  const reveal = () => {
    setHistory(false);
    setEngaged(true);
    face.update({ chatMode: 'expanded' });
  };
  const toggle = () => {
    setHistory(false);
    setEngaged(true);
    face.update({ chatMode: expanded ? 'compact' : 'expanded' });
  };
  useEffect(() => {
    setHistory(false);
  }, [v.content?.nodeId, v.space, v.sessionId]);
  useEffect(() => {
    setEngaged(false);
    docking.setPlacement('bottom');
  }, [v.content?.nodeId]);
  useEffect(() => {
    if (!expanded) setHistory(false);
  }, [expanded]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!expanded && !panel.current?.contains(event.target as Node))
        setEngaged(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [expanded]);
  async function newChat() {
    const before = face.store.getSnapshot();
    await face.newConversation();
    const after = face.store.getSnapshot();
    if (
      after.sessionId !== before.sessionId &&
      after.content?.nodeId === before.content?.nodeId &&
      after.space === before.space
    ) {
      setHistory(false);
      setEngaged(false);
      face.update({ chatMode: 'compact' });
    }
  }
  const control = iconButton + ' sp-chat-control';
  return (
    <div ref={seat} className="sp-chat-seat" hidden={hidden}>
      {docking.preview && (
        <div
          className="sp-chat-drop-preview"
          aria-hidden="true"
          style={docking.preview}
        />
      )}
      <button
        hidden={!minimized}
        className={control + ' sp-chat-restore'}
        aria-label="Restore floating chat"
        style={{
          left: docking.frame.left + docking.frame.width / 2 - 18,
          top: docking.frame.top,
        }}
        onClick={() => {
          setEngaged(true);
          face.update({ chatMode: 'compact' });
        }}
      >
        <Icon name="chat" size={16} />
      </button>
      <aside
        ref={panel}
        aria-label="Floating chat"
        data-mode={v.chatMode}
        data-chrome={chrome}
        data-dock={docking.placement}
        data-dragging={docking.dragging || undefined}
        data-session-id={v.sessionId ?? ''}
        hidden={minimized}
        className="sp-floating-chat"
        style={{
          left: docking.frame.left,
          top: docking.frame.top,
          width: docking.frame.width,
          height: expanded ? docking.frame.height : undefined,
          maxHeight: Math.max(0, docking.bounds.height - 20),
          visibility: docking.bounds.width ? 'visible' : 'hidden',
        }}
      >
        <div className="sp-chat-surface">
          <header className="sp-chat-header" hidden={!chrome}>
            <button
              className={control}
              aria-label="Minimize chat"
              onClick={() => face.update({ chatMode: 'minimized' })}
            >
              <Icon name="minimize" size={16} />
            </button>
            <button
              className={button + ' sp-chat-title'}
              aria-label="View chat history"
              aria-expanded={history}
              onClick={() => {
                setHistory(!history);
                setEngaged(true);
                face.update({ chatMode: 'expanded' });
              }}
            >
              <Icon name="chat" size={16} />
              <span className="tw-truncate">
                {history ? 'History' : v.sessionTitle || 'Work with this page'}
              </span>
              <Icon name="down" size={12} />
            </button>
            <button
              className={control + ' sp-chat-grip'}
              aria-label="Move floating chat"
              aria-description="Drag to an edge to dock. Arrow keys change the dock position."
              onPointerDown={(event) => docking.begin(event, 'move')}
              onLostPointerCapture={docking.cancel}
              onClick={() => {
                if (!docking.consumeDrag()) toggle();
              }}
              onKeyDown={(event) => {
                if (event.key.startsWith('Arrow')) {
                  event.preventDefault();
                  event.stopPropagation();
                  const left = docking.placement.endsWith('left');
                  docking.setPlacement(
                    event.key === 'ArrowDown'
                      ? 'bottom'
                      : event.key === 'ArrowUp'
                        ? left
                          ? 'top-left'
                          : 'top-right'
                        : event.key === 'ArrowLeft'
                          ? docking.placement.startsWith('top')
                            ? 'top-left'
                            : 'bottom-left'
                          : docking.placement.startsWith('top')
                            ? 'top-right'
                            : 'bottom-right',
                  );
                }
              }}
            >
              <Icon name={expanded ? 'minimize' : 'expand'} size={16} />
            </button>
            <button
              className={control + ' sp-chat-expand'}
              aria-label={
                expanded ? 'Show compact floating chat' : 'Expand floating chat'
              }
              aria-expanded={expanded}
              onClick={toggle}
            >
              <Icon name={expanded ? 'minimize' : 'expand'} size={16} />
            </button>
            <Menu
              label="Dock Chat"
              className="sp-chat-menu"
              trigger={<Icon name="grip" size={16} />}
            >
              <button
                role="menuitem"
                disabled={v.busy}
                className={button + ' tw-w-full'}
                onClick={newChat}
              >
                <Icon name="plus" size={16} />
                New chat
              </button>
              <button
                role="menuitem"
                className={button + ' tw-w-full'}
                onClick={() => {
                  setHistory(true);
                  setEngaged(true);
                  face.update({ chatMode: 'expanded' });
                }}
              >
                <Icon name="history" size={16} />
                View chat history
              </button>
              <button
                role="menuitem"
                className={button + ' tw-w-full'}
                onClick={() => face.update({ chatMode: 'minimized' })}
              >
                <Icon name="minimize" size={16} />
                Minimize composer
              </button>
            </Menu>
          </header>
          {history && (
            <div className="sp-chat-history">
              <button
                className={button + ' tw-w-full'}
                disabled={v.busy}
                onClick={newChat}
              >
                <Icon name="plus" size={16} />
                New chat
              </button>
              {v.sessions.map((session) => (
                <button
                  key={session.id}
                  data-session-option={session.id}
                  aria-pressed={v.sessionId === session.id}
                  className={
                    button +
                    ' tw-w-full tw-text-left' +
                    (v.sessionId === session.id ? ' sp-selected' : '')
                  }
                  onClick={() => {
                    face.link(session.id);
                    setHistory(false);
                    setEngaged(false);
                    face.update({ chatMode: 'compact' });
                  }}
                >
                  <Icon name="chat" size={16} />
                  <span className="tw-truncate">{session.title}</span>
                  {v.sessionId === session.id && (
                    <Icon name="check" size={16} />
                  )}
                </button>
              ))}
            </div>
          )}
          <div
            hidden={history}
            className="sp-native-conversation"
            onPointerDownCapture={(event) => {
              if (
                (event.target as HTMLElement).closest(
                  '[role="textbox"],textarea',
                )
              )
                setEngaged(true);
            }}
            onKeyDownCapture={() => setEngaged(true)}
            onInputCapture={() => setEngaged(true)}
          >
            {v.sessionId ? (
              <ChatInteraction.Provider value={reveal}>
                <ExpandedChat.Provider value={expanded}>
                  <SessionProvider session={face.reference()}>
                    {renderSlot('space.conversation', {})}
                  </SessionProvider>
                </ExpandedChat.Provider>
              </ChatInteraction.Provider>
            ) : (
              <div className="tw-flex tw-flex-col tw-gap-2 tw-p-4">
                <p className="tw-m-0 tw-text-sm">
                  Continue with a DSH conversation
                </p>
                <button
                  className={button + ' tw-bg-hover'}
                  disabled={v.busy}
                  onClick={newChat}
                >
                  <Icon name="plus" size={16} />
                  New conversation
                </button>
                <button
                  className={button}
                  onClick={() => {
                    setHistory(true);
                    setEngaged(true);
                    face.update({ chatMode: 'expanded' });
                  }}
                >
                  Choose from history
                </button>
              </div>
            )}
          </div>
        </div>
        {(['left', 'right'] as const).map((side) => (
          <div
            key={side}
            tabIndex={0}
            role="separator"
            aria-orientation="vertical"
            aria-label={'Resize chat width ' + side}
            aria-valuemin={Math.min(280, Math.round(docking.frame.width))}
            aria-valuenow={Math.round(docking.frame.width)}
            className={'sp-chat-resize sp-chat-resize-' + side}
            onPointerDown={(event) => docking.begin(event, side)}
            onLostPointerCapture={docking.cancel}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                event.stopPropagation();
                docking.resize(
                  docking.frame.width + (event.key === 'ArrowRight' ? 16 : -16),
                );
              }
            }}
          />
        ))}
        {expanded && (
          <div
            role="separator"
            tabIndex={0}
            aria-label="Resize chat height"
            aria-orientation="horizontal"
            aria-valuenow={Math.round(docking.frame.height)}
            className={
              'sp-chat-height ' +
              (docking.placement.startsWith('top')
                ? 'sp-chat-height-bottom'
                : 'sp-chat-height-top')
            }
            onPointerDown={(event) => docking.begin(event, 'height')}
            onLostPointerCapture={docking.cancel}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                event.stopPropagation();
                docking.resize(
                  docking.frame.width,
                  docking.frame.height + (event.key === 'ArrowUp' ? 16 : -16),
                );
              }
            }}
          />
        )}
      </aside>
    </div>
  );
}
