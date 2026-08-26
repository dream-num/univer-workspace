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
