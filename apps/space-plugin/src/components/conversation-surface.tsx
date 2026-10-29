import React, { createContext, useContext, useEffect, useRef } from 'react';
export const ExpandedChat = createContext(false);
export const ChatInteraction = createContext(() => {});

/** One Host Conversation factory and one native composer through all layouts. */
export function NativeConversation(props: any) {
  const session = props.useSession((state: any) => state);
  const reveal = useContext(ChatInteraction);
  const submitting = session.running || session.pendingSubmissions?.length > 0;
  const previous = useRef({ sessionId: props.sessionId, submitting });
  useEffect(() => {
    if (
      previous.current.sessionId === props.sessionId &&
      submitting &&
      !previous.current.submitting
    )
      reveal();
    previous.current = { sessionId: props.sessionId, submitting };
  }, [props.sessionId, submitting, reveal]);
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
