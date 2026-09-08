// Keep the upstream collaboration worker protocol, but add a last-resort
// diagnostic bridge for failures outside the worker-child request promise.
// The runtime pool intentionally ignores child stdout/stderr, so an
// uncaught exception otherwise degrades to the unhelpful "exit code 1".

let activeRequestId;

process.on("message", (message) => {
  if (message !== null && typeof message === "object" && Number.isSafeInteger(message.id)) {
    activeRequestId = message.id;
  }
});

function serializeError(reason) {
  if (reason instanceof Error) {
    return {
      code: "COLLABORATION_WORKER_FATAL",
      invalidatesInstance: true,
      message: reason.message,
      name: reason.name,
      stack: reason.stack,
    };
  }
  return {
    code: "COLLABORATION_WORKER_FATAL",
    invalidatesInstance: true,
    message: String(reason),
    name: "Error",
  };
}

function reportFatal(reason) {
  const error = serializeError(reason);
  console.error(
    "[uwh-worker]",
    JSON.stringify({ event: "fatal", requestId: activeRequestId, error }),
  );
  if (activeRequestId !== undefined && process.send !== undefined) {
    try {
      process.send({ id: activeRequestId, type: "error", error });
    } catch {
      // The IPC channel may already be closed while the process is exiting.
    }
  }
}

process.on("uncaughtException", (error) => {
  reportFatal(error);
  process.exitCode = 1;
  setImmediate(() => process.exit(1));
});

process.on("unhandledRejection", (reason) => {
  reportFatal(reason);
  process.exitCode = 1;
  setImmediate(() => process.exit(1));
});

await import("./worker-child-upstream.mjs");
