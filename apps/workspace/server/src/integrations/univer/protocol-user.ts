import type { IUser } from "@univerjs/protocol";
import { ANONYMOUS_USER_ID } from "../../modules/identity/index.js";

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

export const anonymousProtocolUser: IUser = {
  ...protocolUser({
    id: ANONYMOUS_USER_ID,
    displayName: "Anonymous",
    avatarUrl: null,
  }),
  anonymous: true,
};
