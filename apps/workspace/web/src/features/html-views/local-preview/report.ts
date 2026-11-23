import { z } from "zod";
import { renderCheckSchema } from "../render-check";
import { BINDING_WARNINGS, MAX_BINDING_SAMPLES, type BindingSample } from "./bindings";

/** The contract between the preview route and apps/cli/skill-data/html-view/scripts/preview.mjs. */
export const localPreviewReportSchema = z.object({
  token: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  renderCheck: renderCheckSchema,
  bindings: z.array(z.object({
    attribute: z.string(),
    reference: z.string(),
    sample: z.unknown(),
    warnings: z.array(z.enum(BINDING_WARNINGS)),
  })).max(MAX_BINDING_SAMPLES),
  leftoverPlaceholders: z.array(z.string()),
  viewport: z.object({ width: z.number().nonnegative(), height: z.number().nonnegative() }),
  writeMode: z.enum(["trial", "saved"]),
});
export type LocalPreviewReport = z.infer<typeof localPreviewReportSchema>;

export async function sha256Hex(bytes: BufferSource): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildReport(input: Omit<LocalPreviewReport, "bindings"> & { bindings: BindingSample[] }): LocalPreviewReport {
  return localPreviewReportSchema.parse(input);
}

/** Sent as text/plain so the browser makes no preflight; the host reads the body as JSON. */
export async function postReport(src: string, report: LocalPreviewReport, signal?: AbortSignal): Promise<boolean> {
  const url = new URL("/report", src);
  url.searchParams.set("token", report.token);
  try {
    const response = await fetch(url, { method: "POST", credentials: "omit", redirect: "error", body: JSON.stringify(report), signal: signal ?? null });
    return response.ok;
  } catch {
    return false;
  }
}
