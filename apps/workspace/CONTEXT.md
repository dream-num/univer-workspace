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

## Issues

**Issue**:
A Team Space discussion item with a Space-scoped number, Markdown body, open or closed
state, comments, labels, assignees, and references to Nodes. It records a need or defect.
It does not change Space content itself; it names the pull requests that do, each a Team
Worktree of the same Space linked to it.
_Avoid_: Ticket, Task

**Issue Number**:
The Space-scoped `#N` that identifies an Issue for people, the CLI, and agents. It is
never reused inside a Space.
_Avoid_: Issue ID

**Issue Label**:
A Space-defined name with a palette color that classifies Issues. Only a Space Owner or
Admin manages labels.
_Avoid_: Tag

**Issue Reference**:
A link from an Issue to a Node in the same Space. It reads as unavailable once the Node
enters Trash.
_Avoid_: Attachment

**Issue Link**:
The Issue a Team Worktree names as the one it serves, in the same Team Space. A Team
Worktree has at most one; an Issue lists the linked Team Worktrees its reader may discover.
_Avoid_: Task link

**Verdict**:
One step of handing an Issue over: an assignee submits it, and whoever may close it accepts
or sends it back with a reason. Verdicts are only appended; each has an actor, a body, and a time.
_Avoid_: Review, Approval

**Acceptance**:
The state of an Issue's handover, read from its latest Verdict: submitted, accepted, or sent
back. Accepting closes the Issue as completed. An Issue that was never submitted has none.
_Avoid_: Task status, Ticket status

## Change preparation

**Trunk**:
The current shared state of a Unit outside any Worktree.
_Avoid_: Main branch, production

**Worktree**:
A user-created container for isolated draft changes to one or more Units. It has
exactly one author, its creator. People and agents collaborate on Trunk, each in
their own Worktrees, not inside one Worktree. Only the author edits its draft.
Whoever merges it needs edit access to every Unit it changes: the author, the
human who claimed the authoring agent, or, for a Team Worktree shared with its
Space, a Space Owner, Admin or Editor.
_Avoid_: Task, branch

**User Worktree**:
A creator-owned, creator-private Worktree that may contain any Resources the
creator can edit, even when those Resources belong to different Spaces. The
human who claimed the creating agent can also see, review, ready, reopen,
merge and discard it, but not edit it.
_Avoid_: User-space Worktree, Personal Worktree

**Team Worktree**:
A Worktree belonging to one Team Space whose visibility may be creator-private
or shared with current Space Members. Anyone who may propose in the Space creates
one from the Units they can read: any Space Member, and while the Space reads
publicly, the readers its proposals setting admits. A proposer without edit access
proposes a change there and a Member with edit access merges it. Marking one ready shares it with the Space
when its author cannot merge it, and merging one shares it whatever its visibility was while it was open.
Space Owners and Admins may reopen, discard or
change the visibility of a Team Worktree, without gaining access to the draft
content of a private one, and do not merge a private one someone else created.
_Avoid_: Space-scoped Worktree, Team branch

**Fork**:
A User's named view of a whole Team Space, its upstream. It is one product record
that copies no Node, Resource or Unit, and only its owner sees it. Its name shares
the owner's namespace with Team Space slugs. Only someone who can propose in the
upstream (its owner, the human who claimed its agent owner, a Space Member, or a
reader its proposals setting admits) may fork it. A fork's state is derived from its one open Team Worktree in the upstream.
Deleting a fork leaves that Worktree and its history as an ordinary Team Worktree.
_Avoid_: Copy, clone, branch

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

**Declared Check**:
A named check a Team Space asks its Team Worktrees to pass, one `## name` heading in
the Trunk file `.agents/checks.md`. The text under the heading says what to verify.
_Avoid_: CI job, test, status check

**Check Result**:
One reporter's passed or failed on one check, bound to the exact content a ready
Worktree had: its Units' draft and Trunk revisions and its pending drafts. A later
Trunk edit to one of its Units, or a reopen that changes it, leaves the result out of
date. A result counts while current when its reporter may merge the Worktree.
_Avoid_: Approval, review, status

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
