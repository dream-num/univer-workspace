export interface PublicUser { id: string; username: string; displayName: string; avatarUrl?: string | null }
export type ShareRole = 'viewer' | 'editor' | 'admin';
export interface Invite { user: PublicUser; role: ShareRole }
export interface ShareTarget { kind: 'space'; id: string; name: string; invite?: Invite; error?: string }
export interface SharingInput {
  action: 'users' | 'members' | 'set-member' | 'remove-member' | 'space-access';
  id?: string; user?: string; role?: string; query?: string; publicRead?: boolean;
}
export interface MemberList {
  space: import('./model.js').Space;
  owner: PublicUser;
  members: { user: PublicUser; role: ShareRole }[];
}
