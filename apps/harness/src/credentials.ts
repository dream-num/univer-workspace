/**
 * Durable storage for per-User Workspace session credentials.
 *
 * The harness exchanges each user's OAuth authorization code for a Workspace
 * login session token and keeps it here, keyed by the opaque Workspace user
 * id, so product and collaboration calls can be made with the user's own
 * permissions until the token expires. There is no refresh grant: an expired
 * or rejected token is cleared and the user re-runs the OAuth flow.
 * @module @univerjs/univer-workspace-harness/credentials
 */

import { z } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";

/** One stored Workspace session credential. */
export const credentialRecord = z.object({
  /** The `workspace_session` token value (`<id>.<secret>`). */
  token: z.string(),
  /** Unix milliseconds when the token expires. */
  expiresAt: z.number(),
});

/** The credentials domain declaration: one table keyed by opaque user id. */
export const credentialsDomainSpec = defineDomain({
  name: "univer_workspace_harness_credentials",
  version: 1,
  tables: { credentials: domainTable(credentialRecord) },
});

export type CredentialRecord = z.infer<typeof credentialRecord>;
