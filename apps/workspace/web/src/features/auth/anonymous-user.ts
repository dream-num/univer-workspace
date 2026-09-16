/** Display identity for the SDK; it grants no product permissions or login session. */
export const anonymousUser = {
  id: "workspace:anonymous",
  displayName: "Anonymous",
  avatarUrl: null,
  anonymous: true,
} as const;
