import React from 'react';
import type { IMember } from '@univerjs/protocol';

/** Room members come from the formal runtime. Multiple connections dedupe by user. */
export function Collaborators({
  members,
  currentUserId,
}: {
  members: readonly IMember[];
  currentUserId?: string;
}) {
  const users = [
    ...new Map(members.map((member) => [member.userID, member])).values(),
  ];
  if (!users.length) return null;
  const label = (member: IMember) =>
    `${member.name || member.userID}${member.userID === currentUserId ? ' (you)' : ''} · Online`;
  return (
    <details className="sp-collaborators" aria-label="Online collaborators">
      <summary aria-label={`${users.length} online collaborators`}>
        {users.slice(0, 4).map((member) => (
          <span
            key={member.userID}
            className="sp-avatar"
            data-user-id={member.userID}
            aria-label={label(member)}
            title={label(member)}
          >
            {member.avatar ? (
              <img src={member.avatar} alt="" referrerPolicy="no-referrer" />
            ) : (
              (member.name || member.userID).slice(0, 1).toUpperCase()
            )}
          </span>
        ))}
        {users.length > 4 && (
          <span className="sp-avatar">+{users.length - 4}</span>
        )}
      </summary>
      <div className="sp-presence-list" role="list">
        {users.map((member) => (
          <div role="listitem" key={member.userID}>
            {label(member)}
          </div>
        ))}
      </div>
    </details>
  );
}
