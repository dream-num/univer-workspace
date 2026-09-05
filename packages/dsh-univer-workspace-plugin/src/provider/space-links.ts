/**
 * The Space↔dsh-workspace shadow mapping.
 *
 * dsh workspace records have no metadata field and require a real directory,
 * so the capability plugin keeps its own durable mapping between a Univer
 * Workspace Space (`spaceId`) and the mechanical dsh workspace that carries
 * it. The mapping is keyed by the dsh workspace id; a session's `cwd` is
 * resolved back through the workspace registry's own path canonicalization.
 * @module dsh-univer-workspace-plugin/space-links
 */

import { z } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";

/** One link record: the space a dsh workspace carries, and who it belongs to. */
export const spaceLinkRecord = z.object({
  /** Univer Workspace Space id. */
  spaceId: z.string(),
  /** Opaque Workspace user id the Space was resolved for. */
  userId: z.string(),
  /** Canonical Workspace origin; optional for records written before origin isolation. */
  origin: z.string().optional(),
});

/** The space-links domain: one table keyed by dsh workspace id. */
export const spaceLinksDomainSpec = defineDomain({
  name: "univer_workspace_space_links",
  version: 1,
  tables: { links: domainTable(spaceLinkRecord) },
});

export type SpaceLinkRecord = z.infer<typeof spaceLinkRecord>;
