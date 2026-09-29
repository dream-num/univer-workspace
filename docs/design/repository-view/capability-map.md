# Capability Map: Repository View

Repository View is a second presentation of an existing Team Space. A Team Space is exactly one repository; there is no repository catalog independent of Spaces and no repository-specific ACL.

| Module id | Responsibility | Depends on |
|---|---|---|
| repository-navigation | Repository view entry, C-style sidebar, repository overview, and view switching | spaces, nodes, access |
| repository-app | Select and render one `.univer.html` from the current Team Space as the repository landing Page | html-views, blobs, nodes |
| repository-review | Present the current Team Space's existing Worktree review dashboard as PR/MR | worktrees |

Build order: `repository-navigation` → `repository-app`, `repository-review`.

The first slice reuses `spaces`, `nodes`, `views`, and `worktrees` contracts. It adds no repository table and no duplicate content model.
