/**
 * Viewer bootstrap fetcher shared by the review surfaces (module-level
 * memoization so concurrently mounting panels share one request).
 * @module dsh-univer-workspace-plugin/client/viewer-bootstrap
 */

export interface ViewerBootstrap {
  readonly user: {
    readonly id: string;
    readonly displayName: string;
    readonly avatarUrl: string | null;
  };
  readonly license: string;
}

let bootstrapPromise: Promise<ViewerBootstrap> | undefined;

/** Fetch the viewer bootstrap (identity + license) from the harness host. */
export function loadViewerBootstrap(): Promise<ViewerBootstrap> {
  if (bootstrapPromise === undefined) {
    bootstrapPromise = fetch("/univer-workspace/api/viewer-bootstrap", {
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`viewer bootstrap answered ${response.status}`);
        const body = (await response.json()) as {
          user?: { id?: unknown; displayName?: unknown; avatarUrl?: unknown };
          license?: unknown;
        };
        if (
          typeof body.user?.id !== "string" ||
          typeof body.user.displayName !== "string" ||
          typeof body.license !== "string"
        ) {
          throw new Error("viewer bootstrap returned an unexpected payload");
        }
        return {
          user: {
            id: body.user.id,
            displayName: body.user.displayName,
            avatarUrl: typeof body.user.avatarUrl === "string" ? body.user.avatarUrl : null,
          },
          license: body.license,
        } satisfies ViewerBootstrap;
      })
      .catch((error: unknown) => {
        bootstrapPromise = undefined;
        throw error;
      });
  }
  return bootstrapPromise;
}
