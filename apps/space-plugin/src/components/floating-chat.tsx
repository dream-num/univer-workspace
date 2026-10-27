import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { Face } from '../client.js';
import type { State } from '../model.js';
import { Icon, Menu, button, iconButton } from './primitives.js';
export const ExpandedChat = createContext(false);
const ChatInteraction = createContext(() => {});
/** One native Conversation tree. Hiding chrome never clones a composer or transcript. */
export function NativeConversation(props: any) {
  const session = props.useSession((s: any) => s);
  const expand = useContext(ChatInteraction);
  const submitting = session.running || session.pendingSubmissions?.length > 0;
  const previous = useRef({ sessionId: props.sessionId, submitting });
  useEffect(() => {
    if (
      previous.current.sessionId === props.sessionId &&
      submitting &&
      !previous.current.submitting
    )
      expand();
    previous.current = { sessionId: props.sessionId, submitting };
  }, [props.sessionId, submitting, expand]);
  return props.renderFactorySlot(
    'conversation.content',
    {
      variant: 'embedded',
      phase: session.openState === 'loading' ? 'settling' : 'active',
      hero: false,
    },
    { slots: { views: NativeMessages } },
  );
}
function NativeMessages(props: any) {
  const expanded = useContext(ExpandedChat);
  return (
    <div className="sp-native-messages" hidden={!expanded}>
      {props.renderSlot('conversation.session', { view: 'chat' })}
    </div>
  );
}
export function FloatingChat({
  face,
  v,
  SessionProvider,
  renderSlot,
}: {
  face: Face;
  v: State;
  SessionProvider: React.ComponentType<any>;
  renderSlot: (n: string, a: object) => React.ReactNode;
}) {
  const [history, setHistory] = useState(false),
    [geometry, setGeometry] = useState({ width: 560, right: 16, bottom: 16 });
  const panel = useRef<HTMLElement>(null),
    seat = useRef<HTMLDivElement>(null),
    drag = useRef<{
      x: number;
      y: number;
      right: number;
      bottom: number;
      width: number;
      mode: 'move' | 'left' | 'right';
    }>();
  const expanded = v.chatMode === 'expanded',
    minimized = v.chatMode === 'minimized';
  const hidden =
    (!v.content && !v.opening && v.location !== 'space') ||
    (!v.sessionId && !v.ai);
  const positioned = useRef(false);
  const clamp = () => {
    const box = seat.current?.getBoundingClientRect();
    if (!box || hidden || box.width <= 0) return;
    setGeometry((g) => {
      const width = Math.min(g.width, Math.max(0, box.width - 32));
      const height = panel.current?.getBoundingClientRect().height ?? 52;
      return {
        ...g,
        width,
        right: positioned.current
          ? Math.max(16, Math.min(g.right, box.width - width - 16))
          : Math.max(16, (box.width - width) / 2),
        bottom: Math.min(g.bottom, Math.max(16, box.height - height - 16)),
      };
    });
  };
  useEffect(() => {
    clamp();
    const o = new ResizeObserver(clamp);
    if (seat.current) o.observe(seat.current);
    if (panel.current) o.observe(panel.current);
    return () => o.disconnect();
  }, [expanded, hidden]);
  useEffect(() => {
    setHistory(false);
  }, [v.content?.nodeId, v.space, v.sessionId]);
  useEffect(() => {
    if (!expanded) setHistory(false);
  }, [expanded]);
  useEffect(() => {
    if (!expanded) return;
    const collapse = (e: PointerEvent) => {
      if (
        !panel.current?.contains(e.target as globalThis.Node) &&
        (e.target as HTMLElement).closest(
          '.sp-page-body,.sp-browser,.sp-page-toolbar,.sp-navigation',
        )
      )
        face.update({ chatMode: 'compact' });
    };
    document.addEventListener('pointerdown', collapse);
    return () => document.removeEventListener('pointerdown', collapse);
  }, [expanded, face]);
  function start(e: React.PointerEvent, mode: 'move' | 'left' | 'right') {
    if (e.button !== 0) return;
    positioned.current = true;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ...geometry, mode };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current,
      box = seat.current?.getBoundingClientRect();
    if (!d || !box) return;
    const dx = e.clientX - d.x,
      dy = e.clientY - d.y;
    const minWidth = Math.min(280, Math.max(0, box.width - 32));
    const rightWidth = Math.max(
      minWidth,
      Math.min(d.width + d.right - 16, d.width + dx),
    );
    setGeometry(
      d.mode === 'move'
        ? {
            width: d.width,
            right: Math.max(
              16,
              Math.min(box.width - d.width - 16, d.right - dx),
            ),
            bottom: Math.max(
              16,
              Math.min(
                box.height -
                  (panel.current?.getBoundingClientRect().height ?? 52) -
                  16,
                d.bottom - dy,
              ),
            ),
          }
        : d.mode === 'left'
          ? {
              ...geometry,
              width: Math.max(
                minWidth,
                Math.min(box.width - d.right - 16, d.width - dx),
              ),
            }
          : {
              ...geometry,
              right: d.right + d.width - rightWidth,
              width: rightWidth,
            },
    );
  }
  const end = () => {
    drag.current = undefined;
  };
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
      face.update({ chatMode: 'compact' });
    }
  }

  return (
    <div ref={seat} className="sp-chat-seat" hidden={hidden}>
      <button
        hidden={!minimized}
        className={iconButton + ' sp-chat-restore'}
        aria-label="Restore floating chat"
        onClick={() => face.update({ chatMode: 'compact' })}
      >
        <Icon name="chat" size={20} />
      </button>
      <aside
        ref={panel}
        aria-label="Floating chat"
        data-mode={v.chatMode}
        data-session-id={v.sessionId ?? ''}
        hidden={minimized}
        className="sp-floating-chat"
        style={{
          width: geometry.width,
          right: geometry.right,
          bottom: geometry.bottom,
          height: expanded ? 'min(634px, calc(100% - 32px))' : 'auto',
        }}
      >
        <div className="sp-chat-header">
          <button
            className={button + ' sp-chat-title'}
            aria-label="View chat history"
            onClick={() => {
              setHistory(!history);
              face.update({ chatMode: 'expanded' });
            }}
          >
            <span className="tw-truncate">
              {history ? 'History' : v.sessionTitle || 'Work with this page'}
            </span>
            <Icon name="down" size={12} />
          </button>
          <button
            className={iconButton + ' sp-chat-expand'}
            aria-label={expanded ? 'Collapse messages' : 'Expand floating chat'}
            onClick={() => {
              setHistory(false);
              face.update({ chatMode: expanded ? 'compact' : 'expanded' });
            }}
          >
            <Icon name={expanded ? 'minimize' : 'expand'} size={15} />
          </button>
          <button
            className={iconButton + ' sp-chat-minimize'}
            aria-label="Minimize chat"
            onClick={() => face.update({ chatMode: 'minimized' })}
          >
            <Icon name="minimize" size={16} />
          </button>
          <Menu label="Chat menu" trigger={<Icon name="grip" size={16} />}>
            <button
              role="menuitem"
              disabled={v.busy}
              className={button + ' tw-w-full'}
              onClick={newChat}
            >
              <Icon name="plus" />
              New chat
            </button>
            <button
              role="menuitem"
              className={button + ' tw-w-full'}
              onClick={() => {
                setHistory(true);
                face.update({ chatMode: 'expanded' });
              }}
            >
              <Icon name="history" />
              View chat history
            </button>
            <button
              role="menuitem"
              className={button + ' tw-w-full'}
              onClick={() => face.update({ chatMode: 'minimized' })}
            >
              <Icon name="minimize" />
              Minimize composer
            </button>
          </Menu>
          <button
            className={iconButton + ' sp-chat-grip'}
            aria-label="Move floating chat"
            onPointerDown={(e) => start(e, 'move')}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onKeyDown={(e) => {
              const d = (
                {
                  ArrowLeft: [16, 0],
                  ArrowRight: [-16, 0],
                  ArrowUp: [0, 16],
                  ArrowDown: [0, -16],
                } as Record<string, number[]>
              )[e.key];
              if (d) {
                positioned.current = true;
                e.preventDefault();
                e.stopPropagation();
                setGeometry((g) => ({
                  ...g,
                  right: Math.max(16, g.right + d[0]),
                  bottom: Math.max(16, g.bottom + d[1]),
                }));
                requestAnimationFrame(clamp);
              }
            }}
          >
            <Icon name="grip" size={16} />
          </button>
        </div>
        {history && (
          <div className="sp-chat-history">
            <button
              className={button + ' tw-w-full'}
              disabled={v.busy}
              onClick={newChat}
            >
              <Icon name="plus" />
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
                  face.update({ chatMode: 'compact' });
                }}
              >
                <Icon name="chat" size={15} />
                <span className="tw-truncate">{session.title}</span>
                {v.sessionId === session.id && <Icon name="check" size={14} />}
              </button>
            ))}
          </div>
        )}
        <div
          hidden={history}
          className="sp-native-conversation"
          onFocusCapture={(e) => {
            if (
              (e.target as HTMLElement).matches('[role="textbox"],textarea')
            ) {
              face.update({ chatMode: 'expanded' });
            }
          }}
        >
          {v.sessionId ? (
            <ChatInteraction.Provider
              value={() => {
                setHistory(false);
                face.update({ chatMode: 'expanded' });
              }}
            >
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
                <Icon name="plus" />
                New conversation
              </button>
              <button
                className={button}
                onClick={() => {
                  setHistory(true);
                  face.update({ chatMode: 'expanded' });
                }}
              >
                Choose from history
              </button>
            </div>
          )}
        </div>
        {(['left', 'right'] as const).map((side) => (
          <div
            key={side}
            tabIndex={0}
            role="separator"
            aria-orientation="vertical"
            aria-label={'Resize chat width ' + side}
            aria-valuemin={Math.min(280, Math.round(geometry.width))}
            aria-valuenow={Math.round(geometry.width)}
            className={'sp-chat-resize sp-chat-resize-' + side}
            onPointerDown={(e) => start(e, side)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                e.stopPropagation();
                setGeometry((g) => ({
                  ...g,
                  width: Math.max(
                    280,
                    g.width + (e.key === 'ArrowRight' ? 16 : -16),
                  ),
                }));
                requestAnimationFrame(clamp);
              }
            }}
          />
        ))}
      </aside>
    </div>
  );
}
