/** Cross-application origins used by the Workspace shell. */

/**
 * Resolve the Harness URL without baking a production hostname into the
 * browser bundle.  Local Vite development has a deterministic companion at
 * 3081; deployed environments must provide the explicit Vite variable.
 */
export function workspaceHarnessOrigin(): string | undefined {
  const configured = import.meta.env.VITE_UNIVER_WORKSPACE_HARNESS_ORIGIN?.trim();
  if (configured !== undefined && configured !== "") return normalizeHttpOrigin(configured);

  // The production server serves the Vite bundle as static assets, so
  // `import.meta.env.DEV` is false even when the local Workspace process is
  // running on the development port.  Keep the local two-app setup useful
  // without baking a production hostname into the bundle: only loopback
  // origins get the deterministic companion port, while deployed builds
  // still require the explicit VITE setting above.
  if (typeof window !== "undefined") {
    const { hostname, port, protocol } = window.location;
    if (
      (hostname === "127.0.0.1" || hostname === "localhost") &&
      (port === "4020" || port === "") &&
      (protocol === "http:" || protocol === "https:")
    ) {
      return `${protocol}//${hostname}:3081`;
    }
  }

  return undefined;
}

function normalizeHttpOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.pathname = url.pathname.replace(/\/+$/u, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/u, "");
  } catch {
    return undefined;
  }
}
