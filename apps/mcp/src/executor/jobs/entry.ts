import type { WorkspaceUnitExchangeDependencies } from "@univerjs/univer-workspace-client-core";
import type { JobRequest } from "./protocol.js";

process.once("disconnect", () => process.exit(0));

process.once("message", (message: JobRequest) => {
  void (async () => {
    try {
      let value: unknown;
      if (message.kind === "typst.compile") {
        const { compilerOperation } = await import("../ops/compiler-errors.js");
        const { validateTypstBundle } = await import("./typst-bundle.js");
        validateTypstBundle(message.bundle);
        const { WorkspaceCompileTypstFeature } =
          await import("@univerjs/univer-workspace-client-core");
        value = await new WorkspaceCompileTypstFeature({
          materializer: {
            materialize: async () => {
              throw new Error("Compile-only job cannot materialize.");
            },
          },
          units: {
            create: async () => {
              throw new Error("Compile-only job cannot create a Unit.");
            },
          },
        })
          .execute({ bundle: message.bundle })
          .catch((error) =>
            compilerOperation("typst", async () => {
              throw error;
            }),
          );
      } else if (message.kind === "markdown.materialize") {
        const { materializeWorkspaceDocument } =
          await import("@univerjs/univer-workspace-client-core/document-materialize");
        value = await materializeWorkspaceDocument(message, {
          format: message.format ?? "Markdown",
          license: message.license,
        });
      } else {
        const { importBuffer, exportToBuffer } = await import("@univerjs-pro/exchange-node");
        const exportOfficeBuffer = exportToBuffer as unknown as NonNullable<
          WorkspaceUnitExchangeDependencies["exportToBuffer"]
        >;
        value =
          message.kind === "import"
            ? await importBuffer(
                Buffer.from(
                  message.bytes.buffer,
                  message.bytes.byteOffset,
                  message.bytes.byteLength,
                ),
                message.options,
              )
            : await exportOfficeBuffer(message.data, {
                ...message.options,
                license: message.license,
                licenseKey: message.licenseKey,
              });
      }
      if (message.kind === "import" || message.kind === "markdown.materialize") {
        const size = Buffer.byteLength(JSON.stringify(value));
        if (size > 900 * 1024) {
          process.send?.(
            {
              ok: false,
              error: {
                code: "workspace-import-too-large",
                message: `Converted UnitData is ${size} bytes, above the 900 KiB Workspace client limit. Reduce the source document and retry.`,
                detail: { size, maxBytes: 900 * 1024 },
              },
            },
            () => process.disconnect(),
          );
          return;
        }
      }
      process.send?.({ ok: true, value }, () => process.disconnect());
    } catch (error) {
      process.send?.(
        {
          ok: false,
          error: {
            code:
              error instanceof Error && "code" in error && typeof error.code === "string"
                ? error.code
                : "workspace-exchange-conversion-failed",
            message: error instanceof Error ? error.message : "Office conversion failed.",
            ...(error instanceof Error && "detail" in error ? { detail: error.detail } : {}),
          },
        },
        () => process.disconnect(),
      );
    }
  })();
});
