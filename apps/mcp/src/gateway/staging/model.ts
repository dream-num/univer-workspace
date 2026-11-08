import { z } from "zod";

export const purposeSchema = z.enum([
  "office-import",
  "blob",
  "markdown-assets",
  "svg-assets",
  "typst-bundle",
]);
export type UploadPurpose = z.infer<typeof purposeSchema>;
export const uploadInputSchema = z.object({
  purpose: purposeSchema,
  file_name: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine(
      (value) => value !== "." && value !== ".." && !/[\\/\x00-\x1f\x7f]/.test(value),
      "Expected a plain file name",
    ),
  size: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .optional()
    .describe("Optional size upper limit in bytes; smaller files are accepted."),
  media_type: z
    .string()
    .max(255)
    .regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/)
    .transform((value) => value.toLowerCase()),
});
export type UploadInput = z.infer<typeof uploadInputSchema>;
export const objectSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["upload", "download"]),
  owner: z.string().min(1),
  purpose: purposeSchema,
  fileName: z.string().min(1),
  mediaType: uploadInputSchema.shape.media_type,
  size: uploadInputSchema.shape.size.unwrap(),
  maxBytes: uploadInputSchema.shape.size,
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  state: z.enum(["pending", "ready"]),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type StagingObject = z.infer<typeof objectSchema>;
export type UploadLimits = Readonly<Record<UploadPurpose, number>>;
export const defaultLimits: UploadLimits = {
  "office-import": 50 * 1024 * 1024,
  blob: 512 * 1024 * 1024,
  "markdown-assets": 50 * 1024 * 1024,
  "svg-assets": 50 * 1024 * 1024,
  "typst-bundle": 50 * 1024 * 1024,
};
export const uploadLinkSchema = z.object({
  upload: z.object({
    upload_id: z.string(),
    upload_url: z.url(),
    page_url: z.url(),
    expires_at: z.iso.datetime(),
    max_bytes: z.number(),
  }),
});
export const downloadSchema = z.object({
  url: z.url(),
  expires_at: z.iso.datetime(),
  file_name: z.string(),
  media_type: z.string(),
  size: z.number(),
});
export interface StagingStore {
  readonly limits: UploadLimits;
  createUpload(owner: string, input: UploadInput): Promise<z.infer<typeof uploadLinkSchema>>;
  requireUpload(owner: string, id: string, purpose: UploadPurpose): Promise<StagingObject>;
  withUpload<T>(
    owner: string,
    id: string,
    purpose: UploadPurpose,
    consume: (object: StagingObject, path: string) => Promise<T>,
  ): Promise<T>;
  createDownload(input: {
    owner: string;
    fileName: string;
    mediaType: string;
    size?: number;
    content: AsyncIterable<Uint8Array>;
  }): Promise<z.infer<typeof downloadSchema>>;
  handle(request: Request): Promise<Response>;
  sweep(): Promise<void>;
  close(): Promise<void>;
}
