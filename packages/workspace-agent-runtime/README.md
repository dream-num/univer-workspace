# Workspace Agent runtime

The Workspace Agent plugin hosted by DSH and the Space app both need to operate
on Workspace content. This package gives them a shared content execution layer,
so adding a second host does not mean maintaining a second implementation of
the same content operations.

## Consumers

- The DSH Workspace Agent plugin.
- The Space app.

## Boundary

Sharing content execution does not mean sharing chat or session orchestration.
Each host still owns its integration, credentials, configuration and lifecycle;
the Workspace server remains the authority for access control.

Changes intended for both hosts belong here. Host-specific interaction and
orchestration belong in the consuming application.
