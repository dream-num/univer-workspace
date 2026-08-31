# Univer Workspace

Univer Workspace organizes collaborative office content, controls who may access it,
and lets users prepare isolated changes before merging them into shared content.

## Product

**Univer Workspace**:
The product and repository that provide the Workspace browser, server, HTTP contract,
CLI, and repository-internal extensions. Workspace is a product name, not a content or
access boundary.
_Avoid_: Workspace (when referring to a Space or tenant)

**Univer Workspace CLI**:
The installable command-line client for operating a remote Univer Workspace and its
content. It belongs to the Univer Workspace product but has its own release version.
_Avoid_: Univer CLI, Workspace Agent

## Agent clients

**Workspace Agent Client**:
A Node-hosted application through which an Agent operates a remote Univer Workspace.
Univer Workspace CLI and dsh-univer-work are distinct Workspace Agent Clients.
_Avoid_: Workspace Browser, universal client

**Workspace Client Core**:
The repository-internal Node-hosted capability layer shared by Workspace Agent Clients.
It is independent of any delivery-specific command or Harness shell.
_Avoid_: CLI library, Browser SDK, universal client

**Client Shell**:
The delivery-specific boundary that exposes Workspace Client Core capabilities and owns
environment-specific interaction, configuration, credentials, and lifecycle.
_Avoid_: Client Core, Workspace Server adapter

## Delivery

**Stable Release Tag**:
An immutable `vX.Y.Z` repository source coordinate used by the stable Univer Workspace
CLI release and by a manually selected Workspace deployment. Creating the tag does not
deploy Workspace or promote the CLI to a public registry.
_Avoid_: Deployment, Public Release

**SDK Baseline**:
The one exact release shared by every version-coupled `@univer-cli/*`, `@univerjs/*`,
and `@univerjs-pro/*` dependency in the repository. It is independent of the Stable
Release Tag and the Univer Workspace CLI release version.
_Avoid_: CLI version, Workspace version

## Content

**Space**:
The ownership and access boundary that contains a hierarchy of Nodes.
_Avoid_: Workspace, tenant

**Personal Space**:
A space owned by one user whose Nodes may be shared directly with other users.
_Avoid_: My workspace, user scope

**Team Space**:
A space owned by one user and shared through space-level membership.
_Avoid_: Organization

**Node**:
The durable navigation identity in a Space hierarchy. Every Node may have child
Nodes and may own zero or one Resource.
_Avoid_: Catalog Entry, item

**Group**:
The product label for a Node without a Resource. Group is not a separate
persistence type.
_Avoid_: Folder, directory

**Resource**:
The durable product content identity owned by exactly one Node. A Resource's
kind-specific data lives in one extension table.
_Avoid_: File, document, Unit

**Univer Resource**:
The Resource extension that binds one Resource to a Sheet, Doc, Slide, Board,
or Base Unit.
_Avoid_: File mapping

**Unit**:
The globally unique collaborative content identity managed by the Univer
collaboration services and referenced by a Univer Resource.
_Avoid_: Node, Resource

## Access

**Space Owner**:
The single user who owns a space and has full control over its membership and
content.

**Space Member**:
A user granted an admin, editor, or viewer role in a team space.
_Avoid_: Collaborator

**Direct Share**:
The act of granting a specific user editor or viewer access to a Node
in a personal space.
_Avoid_: Resource member, link share

**Node Grant**:
An explicit editor or viewer grant on a personal-space Node. The grant applies
to the Node and its descendants.
_Avoid_: ACL, Node member

**Space Access**:
A user's authority over a Space and its Nodes, derived from ownership or team
membership.
_Avoid_: Workspace permission

**Node Access**:
A user's authority to discover, browse, or modify a Node, derived from Space
Access or applicable Node Grants.
_Avoid_: Group permission

**Resource Access**:
A user's authority to read or edit one Resource's content, derived from its
Node Access.
_Avoid_: Unit permission

## Change preparation

**Trunk**:
The current shared state of a Unit outside any Worktree.
_Avoid_: Main branch, production

**Worktree**:
A user-created container for isolated draft changes to one or more Units.
_Avoid_: Task, branch

**User Worktree**:
A creator-owned, creator-private Worktree that may contain any Resources the
creator can edit, even when those Resources belong to different Spaces.
_Avoid_: User-space Worktree, Personal Worktree

**Team Worktree**:
A Worktree belonging to one Team Space whose visibility may be creator-private
or shared with current Space Members. Space Owners and Admins may manage a
private Team Worktree without gaining access to its draft content.
_Avoid_: Space-scoped Worktree, Team branch

**Worktree Unit**:
A Unit participating in a Worktree, either trunk-backed or Worktree-local.
_Avoid_: Draft Resource

**Worktree-local Unit**:
A Unit created inside a Worktree that has no persistent Node or Resource until
its merge into Trunk is successfully activated in the target Space.
_Avoid_: Staged Resource, temporary Resource

**Draft**:
The isolated state of a Worktree Unit before it is merged into trunk.

**Activation**:
The product operation that creates a Node and Resource for a successfully
merged Worktree-local Unit.
_Avoid_: Publish, provisioning

## Identity

**User**:
The durable product identity that owns content, receives access, and may prove
itself through one or more authentication methods.
_Avoid_: Account, GitHub User

**System Username**:
The case-insensitive, globally unique handle of a User inside Univer Workspace.
It may be chosen locally or initialized from an external identity.
_Avoid_: Login name, GitHub username

**External Identity**:
An identity issued by an external provider and explicitly linked to exactly one
User.
_Avoid_: Social account, external User

**Login Session**:
A persistent authenticated browser login that identifies one User without
capturing any of the User's current authorization.
_Avoid_: Auth token, Collaboration Session

## Views and lifecycle

**Trash**:
The set of Nodes removed from normal navigation but still recoverable.
_Avoid_: Deleted Resources

**Trash Batch**:
The recoverable group of Nodes placed in Trash by one recursive user
action and restored together.
_Avoid_: Deleted Group, trash item

**Recent Resource**:
A Resource ordered by the last time a particular user opened it with authorized
access.
_Avoid_: Recently modified Resource

**Shared With Me**:
Personal-space Nodes directly shared with a user.
_Avoid_: Team Resources
