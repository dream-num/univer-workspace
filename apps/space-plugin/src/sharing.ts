export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
}
export type ShareRole = 'viewer' | 'editor' | 'admin';
export interface Invite {
  user: PublicUser;
  role: ShareRole;
}
export interface ShareTarget {
  kind: 'space' | 'node';
  id: string;
  name: string;
  invite?: Invite;
  error?: string;
}
export interface SharingInput {
  action:
    | 'users'
    | 'members'
    | 'set-member'
    | 'remove-member'
    | 'space-access'
    | 'file'
    | 'set-grant'
    | 'remove-grant'
    | 'link-access';
  id?: string;
  user?: string;
  role?: string;
  query?: string;
  publicRead?: boolean;
  enabled?: boolean;
}
export interface MemberList {
  space: import('./model.js').Space;
  owner: PublicUser;
  members: { user: PublicUser; role: ShareRole }[];
}

export interface FileAccess {
  node: import('./model.js').Node;
  space: import('./model.js').Space | null;
  owner?: { id: string; username: string };
  grants: {
    user: PublicUser;
    role: 'viewer' | 'editor';
    effectiveRole: string;
  }[];
  inherited: {
    id: string;
    name: string;
    grants: { user: PublicUser; role: string; effectiveRole: string }[];
    link?: { enabled: boolean; role: string };
  }[];
  members?: MemberList;
  link?: { enabled: boolean; role: 'viewer' | 'editor' };
}
