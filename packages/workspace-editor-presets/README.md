# Workspace editor presets

Workspace Web and the Space app embed the same Univer editors in different
interfaces. This package provides a shared place to compose their editor
plugins, reducing duplicated setup and the risk of one host missing a capability
when the other is updated.

## Consumers

- Workspace Web.
- The Space app.

## Boundary

This package shares editor composition, not a complete viewer or a common user
interface. Each host still owns its integration, component lifecycle, session
state and permissions.

Changes to the common editor composition belong here. Host-specific interaction
belongs in the consuming application; sharing this package does not make every
behavior in the two hosts identical.
