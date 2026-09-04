/** Stable GitHub-backed identity authorized to use Observer. */
export interface ObservationMember {
  readonly githubUserId: string;
  readonly githubLogin: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly addedByGithubUserId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ObservationSession {
  readonly member: ObservationMember;
  readonly sessionId: string;
  readonly secretHash: string;
  readonly expiresAt: number;
}

export interface ObservationAccessEvent {
  readonly id: string;
  readonly actorGithubUserId: string | null;
  readonly actorGithubLogin: string | null;
  readonly targetGithubUserId: string | null;
  readonly targetGithubLogin: string | null;
  readonly action: "setup" | "add" | "remove";
  readonly result: "succeeded" | "rejected";
  readonly createdAt: number;
}
