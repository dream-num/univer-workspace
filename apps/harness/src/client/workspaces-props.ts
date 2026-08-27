/**
 * Composed props of the harness sidebar component.
 *
 * `PropsRuntime<'sidebar.workspaces'>` derives the owner share the shell hands
 * over (`wide`, `expandSidebar`) plus the framework global seat
 * (`useSessions`, `useWorkspaces`). The injected face supplies the
 * route-facing callbacks.
 * @module @univerjs/univer-workspace-harness/client/workspaces-props
 */

import type { PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { UwhInjected } from "./index.tsx";

/** Full props of the sidebar-browsing component. */
export type UwhWorkspacesProps = PropsRuntime<"sidebar.workspaces"> & PropsLocale<"univer-workspace-harness"> & UwhInjected;
