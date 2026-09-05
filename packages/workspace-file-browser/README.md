# @univerjs/univer-workspace-file-browser

Private shared Workspace file-navigation module used by Workspace Web and the local DSH Harness.

The package owns the Personal/Team Space tree, lazy Node expansion, selection, drag-and-drop movement, resource icons, creation and upload menus, node actions, sharing/rename/trash dialogs, mutation feedback, and navigation styling. A consumer supplies normalized Space data, one-level Node queries, capability-authorized mutations, stable Node URLs, and host navigation callbacks.

It does not own Workspace authentication, HTTP transport, application routing, the product Trash/Recent/Shared surfaces, Viewer state, DSH slots, or the right-side Conversation. Consumers must import the package root and must not depend on `src` paths. The package must not depend on an application-private path or a DSH package.
