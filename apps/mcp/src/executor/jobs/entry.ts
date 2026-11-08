import { importBuffer, exportToBuffer } from "@univerjs-pro/exchange-node";
import type { WorkspaceUnitExchangeDependencies } from "@univerjs/univer-workspace-client-core";
import type { ConversionJob, JobCredentials } from "./protocol.js";

const exportOfficeBuffer = exportToBuffer as unknown as NonNullable<
  WorkspaceUnitExchangeDependencies["exportToBuffer"]
>;

process.once("message", (message: ConversionJob & JobCredentials) => {
  void (async () => {
    try {
      const value =
        message.kind === "import"
          ? await importBuffer(Buffer.from(message.bytes), message.options)
          : await exportOfficeBuffer(message.data, {
              ...message.options,
              license: message.license,
              licenseKey: message.licenseKey,
            });
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
          },
        },
        () => process.disconnect(),
      );
    }
  })();
});
