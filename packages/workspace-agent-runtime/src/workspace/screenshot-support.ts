/** Original Workspace screenshot selection, limits and DSH attachment workflow. */
import { Buffer } from 'node:buffer';
import { isAbsolute, relative, sep } from 'node:path';
import type { UnitScreenshotInput } from '@univer-cli/unit-screenshot';
import type { JsonValue } from './json-value.js';
import { authorizedSessionPath } from './session-path.js';
import { screenshotUnit, type RenderUnitSource, type RenderRuntimeConfig } from './render-operations.js';

type UnitType = 'sheet' | 'doc' | 'slide' | 'board' | 'base';
type PageSelector = number | string;
type ScreenshotRunContext = { readonly signal: AbortSignal; readonly agent?: unknown };
export class ScreenshotSupportError extends Error {
  constructor(message: string, readonly code: string, options?: ErrorOptions) { super(message, options); this.name = 'ScreenshotSupportError'; }
}

export interface ScreenshotArguments {
  readonly unitId: string;
  readonly unitType: UnitType;
  readonly worktreeId?: string;
  readonly pages?: readonly PageSelector[];
  readonly output: string;
  readonly sheetName?: string;
  readonly range?: string;
  readonly contactSheet?: boolean;
  readonly tileColumns?: number;
  readonly tileRows?: number;
  readonly region?: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  readonly elementIds?: readonly string[];
  readonly padding?: number;
  readonly scale?: number;
}

export interface AttachmentStoreLike {
  readonly imageLimits: {
    readonly mediaTypes: readonly string[];
    readonly maxImagesPerMessage?: number;
    readonly maxMessageImageBytes: number;
    readonly maxImageBytes: number;
    readonly maxImagePixels?: number;
  };
  saveImages(
    inputs: readonly {
      readonly data: Uint8Array;
      readonly mediaType: "image/png";
      readonly name?: string;
    }[],
  ): Promise<readonly AttachmentRefLike[]>;
}

interface AttachmentRefLike {
  readonly attachmentId: string;
  readonly mediaType: "image/png";
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly name?: string;
}

interface ModelInfoLike {
  readonly inputModalities?: readonly string[];
}

export interface LlmServiceLike {
  resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<ModelInfoLike>;
}

export async function screenshotWithAttachments(
  args: ScreenshotArguments, exec: ScreenshotRunContext, attachments: AttachmentStoreLike | undefined,
  llm: LlmServiceLike | undefined, loadSource: () => Promise<RenderUnitSource>, config: RenderRuntimeConfig,
) {
  if (attachments === undefined) {
    throw new ScreenshotSupportError(
      "Screenshot attachments are unavailable in this deployment.",
      "SCREENSHOT_ATTACHMENTS_UNAVAILABLE",
    );
  }
  assertAttachmentPolicy(attachments);
  await assertImageCapableRoute(llm, exec);
  const source = await loadSource();
  const output = await authorizedSessionPath((exec.agent as { session?: { header?: { cwd?: string } } } | undefined)?.session?.header?.cwd, args.output, false);
  const captured = await screenshotUnit(
    source,
    output.path,
    screenshotTarget(args),
    config,
  );
  const decoded = captured.images.map((image) => ({
    image,
    bytes: Buffer.from(image.data, "base64"),
  }));
  validateAttachmentLimits(attachments, decoded);
  exec.signal.throwIfAborted();
  let refs: readonly AttachmentRefLike[];
  try {
    refs = await attachments.saveImages(
      decoded.map(({ image, bytes }) => ({
        data: new Uint8Array(bytes),
        mediaType: "image/png" as const,
        name: image.name,
      })),
    );
  } catch (error) {
    // Do not expose an attachment backend stack.  The hardened wrapper
    // assigns a stable operation code while retaining the cause locally.
    throw new ScreenshotSupportError(
      "Screenshot attachment persistence failed.",
      "SCREENSHOT_ATTACHMENT_WRITE_FAILED",
      { cause: error },
    );
  }
  if (refs.length !== decoded.length) {
    throw new ScreenshotSupportError(
      "Screenshot attachment service returned an incomplete image batch.",
      "SCREENSHOT_ATTACHMENT_RESULT_INVALID",
    );
  }
  const outputLabel = displaySessionPath(output.workspace, output.path);
  const images = decoded.map(({ image }, index) => {
    const ref = refs[index]!;
    return {
      // Absolute provider paths never cross the tool boundary. Keep a
      // session-relative label for follow-up tools instead.
      path: `${outputLabel}/${image.name}`,
      name: image.name,
      mediaType: image.mediaType,
      width: image.width,
      height: image.height,
      metadata: image.metadata,
      image: {
        attachmentId: ref.attachmentId,
        mediaType: ref.mediaType,
        bytes: ref.bytes,
        width: ref.width,
        height: ref.height,
        ...(ref.name === undefined ? {} : { name: ref.name }),
      },
    };
  });
  return {
    ok: true as const,
    operation: "screenshot" as const,
    unitId: captured.unitId,
    unitType: captured.unitType,
    output: outputLabel,
    result: {
      unitId: captured.unitId,
      unitType: captured.unitType,
      images: images as unknown as JsonValue,
    } as unknown as JsonValue,
  };
}

/** Return a stable session-relative path label, never an absolute host path. */
function displaySessionPath(workspace: string, path: string): string {
  const value = relative(workspace, path);
  if (value === "" || value === ".") return ".";
  if (value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value)) return "[workspace]";
  return value.split(sep).join("/");
}

/** Keep pending-call presentation free of absolute paths supplied by a model. */
export function displayPathArgument(value: string): string {
  if (!isAbsolute(value)) return value;
  const normalized = value.replaceAll("\\", "/");
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  return basename === "" ? "[workspace]" : basename;
}

function assertAttachmentPolicy(attachments: AttachmentStoreLike): void {
  if (!attachments.imageLimits.mediaTypes.includes("image/png")) {
    throw new ScreenshotSupportError(
      "This deployment does not accept PNG screenshot attachments.",
      "SCREENSHOT_MEDIA_TYPE_UNAVAILABLE",
    );
  }
  const { maxMessageImageBytes, maxImageBytes } = attachments.imageLimits;
  if (
    !Number.isSafeInteger(maxMessageImageBytes) ||
    maxMessageImageBytes < 1 ||
    !Number.isSafeInteger(maxImageBytes) ||
    maxImageBytes < 1
  ) {
    throw new ScreenshotSupportError(
      "The screenshot attachment policy is unavailable.",
      "SCREENSHOT_ATTACHMENT_POLICY_INVALID",
    );
  }
}

function validateAttachmentLimits(
  attachments: AttachmentStoreLike,
  images: readonly {
    readonly image: {
      readonly name: string;
      readonly width: number;
      readonly height: number;
      readonly bytes: number;
    };
    readonly bytes: Uint8Array;
  }[],
): void {
  const limits = attachments.imageLimits;
  if (limits.maxImagesPerMessage !== undefined && images.length > limits.maxImagesPerMessage) {
    throw new ScreenshotSupportError(
      "Screenshot returned more images than the attachment limit.",
      "SCREENSHOT_ATTACHMENT_LIMIT_EXCEEDED",
    );
  }
  const totalBytes = images.reduce((sum, item) => sum + item.bytes.byteLength, 0);
  if (totalBytes > limits.maxMessageImageBytes) {
    throw new ScreenshotSupportError(
      "Screenshot images exceed the attachment message limit; capture fewer pages or a smaller range.",
      "SCREENSHOT_ATTACHMENT_LIMIT_EXCEEDED",
    );
  }
  for (const { image, bytes } of images) {
    if (bytes.byteLength > limits.maxImageBytes) {
      throw new ScreenshotSupportError(
        "A screenshot image exceeds the per-image attachment limit.",
        "SCREENSHOT_ATTACHMENT_LIMIT_EXCEEDED",
      );
    }
    if (limits.maxImagePixels !== undefined && image.width * image.height > limits.maxImagePixels) {
      throw new ScreenshotSupportError(
        "A screenshot image exceeds the pixel limit.",
        "SCREENSHOT_ATTACHMENT_LIMIT_EXCEEDED",
      );
    }
  }
}

async function assertImageCapableRoute(
  llm: LlmServiceLike | undefined,
  exec: ScreenshotRunContext,
): Promise<void> {
  const agent = exec.agent as unknown as
    | {
        readonly session?: {
          readonly requestHeader?: () =>
            | { readonly config?: { readonly provider?: string; readonly model?: string } }
            | undefined;
        };
        readonly options?: { readonly provider?: string; readonly model?: string };
      }
    | undefined;
  const routed = agent?.session?.requestHeader?.()?.config;
  const provider = routed?.provider ?? agent?.options?.provider;
  const model = routed?.model ?? agent?.options?.model;
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new ScreenshotSupportError(
      "The current model route cannot accept screenshot input.",
      "SCREENSHOT_MODEL_ROUTE_UNAVAILABLE",
    );
  }
  const info = await llm.resolveModelInfo(provider, model, exec.signal);
  if (info.inputModalities === undefined || !info.inputModalities.includes("image")) {
    throw new ScreenshotSupportError(
      "The current model does not support image input.",
      "SCREENSHOT_MODEL_NOT_IMAGE_CAPABLE",
    );
  }
}

function screenshotTarget(args: ScreenshotArguments): UnitScreenshotInput["target"] | undefined {
  const usesSheet = args.sheetName !== undefined || args.range !== undefined;
  const usesPaged =
    args.pages !== undefined ||
    args.contactSheet === true ||
    args.tileColumns !== undefined ||
    args.tileRows !== undefined;
  const usesBoard =
    args.region !== undefined || args.elementIds !== undefined || args.padding !== undefined;
  if ([usesSheet, usesPaged, usesBoard].filter(Boolean).length > 1) {
    throw new ScreenshotSupportError(
      "Sheet, paged-Unit, and Board screenshot selectors cannot be combined.",
      "SCREENSHOT_INPUT_INVALID",
    );
  }
  if (args.scale !== undefined && (args.scale < 0.1 || args.scale > 4)) {
    throw new ScreenshotSupportError(
      "Screenshot scale must be between 0.1 and 4.",
      "SCREENSHOT_INPUT_INVALID",
    );
  }
  if (args.unitType === "sheet" && usesSheet) {
    if (args.range === undefined || args.range.trim() === "") {
      throw new ScreenshotSupportError("sheetName requires a non-empty range.", "SCREENSHOT_INPUT_INVALID");
    }
    return {
      kind: "sheet-range",
      range: args.range,
      ...(args.sheetName === undefined ? {} : { sheetName: args.sheetName }),
      ...(args.scale === undefined ? {} : { scale: args.scale }),
    } as UnitScreenshotInput["target"];
  }
  if (args.unitType === "doc" && usesPaged) {
    const pages = args.pages;
    if (pages !== undefined && pages.some((page) => typeof page !== "number")) {
      throw new ScreenshotSupportError(
        "Doc screenshots accept numeric pages only.",
        "SCREENSHOT_INPUT_INVALID",
      );
    }
    if (
      args.contactSheet === true ||
      args.tileColumns !== undefined ||
      args.tileRows !== undefined
    ) {
      throw new ScreenshotSupportError(
        "Doc screenshots do not support contact sheets.",
        "SCREENSHOT_INPUT_INVALID",
      );
    }
    return {
      kind: "doc-pages",
      ...(pages === undefined ? {} : { pages: pages as readonly number[] }),
      ...(args.scale === undefined ? {} : { scale: args.scale }),
    } as UnitScreenshotInput["target"];
  }
  if (args.unitType === "slide" && usesPaged) {
    const hasColumns = args.tileColumns !== undefined;
    const hasRows = args.tileRows !== undefined;
    if (hasColumns !== hasRows || (hasColumns && args.contactSheet !== true)) {
      throw new ScreenshotSupportError(
        "tileColumns and tileRows must be provided together with contactSheet.",
        "SCREENSHOT_INPUT_INVALID",
      );
    }
    return {
      kind: "slide-pages",
      ...(args.pages === undefined ? {} : { pages: args.pages }),
      ...(args.contactSheet === true
        ? {
            contactSheet:
              hasColumns && hasRows
                ? { tile: { columns: args.tileColumns!, rows: args.tileRows! } }
                : {},
          }
        : {}),
      ...(args.scale === undefined ? {} : { scale: args.scale }),
    } as UnitScreenshotInput["target"];
  }
  if (args.unitType === "board" && usesBoard) {
    return {
      kind: "board-content",
      ...(args.region === undefined ? {} : { region: args.region }),
      ...(args.elementIds === undefined ? {} : { elementIds: args.elementIds }),
      ...(args.padding === undefined ? {} : { padding: args.padding }),
      ...(args.scale === undefined ? {} : { scale: args.scale }),
    } as UnitScreenshotInput["target"];
  }
  if (usesSheet || usesPaged || usesBoard) {
    throw new ScreenshotSupportError(
      `Screenshot selectors are not supported for ${args.unitType} Units.`,
      "SCREENSHOT_INPUT_INVALID",
    );
  }
  if (args.scale === undefined) return undefined;
  if (args.unitType === "sheet")
    return { kind: "sheet-viewport", scale: args.scale } as UnitScreenshotInput["target"];
  if (args.unitType === "doc")
    return { kind: "doc-pages", scale: args.scale } as UnitScreenshotInput["target"];
  if (args.unitType === "slide")
    return { kind: "slide-pages", scale: args.scale } as UnitScreenshotInput["target"];
  if (args.unitType === "base")
    return { kind: "base-view", scale: args.scale } as UnitScreenshotInput["target"];
  return { kind: "board-content", scale: args.scale } as UnitScreenshotInput["target"];
}
