/**
 * Browser type seam for the DSH release-train migration.
 *
 * The current profile still runs rc.2, where these browser-facing types are
 * exported by `dsh-client-runtime`. Alpha.4 moves them into the split
 * `dsh-api-*` and client UI packages. Keeping the imports here means the
 * Harness adapters can migrate at one boundary without spreading a release
 * specific package name through application code.
 */
export type { Context as ClientContext } from "@deepseek-ai/cordis";
export type { ISessions } from "@deepseek-ai/dsh-api-session-controller/client";
