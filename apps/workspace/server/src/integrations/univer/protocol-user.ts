import type { IUser } from "@univerjs/protocol";

export function protocolUser(user: {
  readonly id: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
}): IUser {
  return {
    userID: user.id,
    name: user.displayName,
    avatar: user.avatarUrl ?? "",
    anonymous: false,
    canBindAnonymous: false,
    phone: "",
    email: "",
    createTimestamp: 0,
  };
}

// The protocol needs a string identity. Product authorization uses null instead;
// visitors never become Users or Login Sessions. Each socket has its own member ID.
export const ANONYMOUS_PROTOCOL_USER_ID = "workspace:anonymous";

export const anonymousProtocolUser: IUser = {
  ...protocolUser({
    id: ANONYMOUS_PROTOCOL_USER_ID,
    displayName: "Anonymous",
    avatarUrl: null,
  }),
  anonymous: true,
};

export function productUserId(protocolUserId: string): string | null {
  return protocolUserId === ANONYMOUS_PROTOCOL_USER_ID ? null : protocolUserId;
}
