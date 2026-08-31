---
status: accepted
---

# Co-locate Workspace Agent clients with the Workspace product

Univer Workspace CLI and dsh-univer-work live in this monorepo and share Workspace
capabilities only through private Client Core package exports. This keeps product
protocol and SDK changes atomic across Client Shells while avoiding both CLI subprocess
integration and duplicated client implementations in separate repositories.
