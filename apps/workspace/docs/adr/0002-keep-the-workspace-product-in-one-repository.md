---
status: accepted
---

# Keep the Workspace product in one repository

The `univer-workspace` repository is the source and release boundary for the Workspace
browser and server, HTTP contract, Workspace CLI, and repository-internal reference
provider. Generic Collaboration SDK capabilities and generic CLI modules are consumed
through versioned internal npm packages so Workspace product code has one owner.
