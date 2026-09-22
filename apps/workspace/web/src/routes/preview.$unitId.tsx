import { createFileRoute } from "@tanstack/react-router";
import { anonymousUser, sessionQueryOptions } from "../features/auth";
import { ResourceEditor } from "../features/editor";
import { openNativeUnit } from "../features/resources";

/** Separate browsing context keeps Office UI Facades out of the HTML Binding Engine. */
export const Route = createFileRoute("/preview/$unitId")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" && /^[\w-]{1,128}$/.test(search.token) ? search.token : undefined,
  }),
  loader: async ({ context, params, abortController }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions);
    const opened = await openNativeUnit(params.unitId, abortController.signal);
    return { ...opened, user: session.authenticated ? session.user : anonymousUser };
  },
  component: NativeUnitPage,
});

function NativeUnitPage() {
  const { resource, user } = Route.useLoaderData();
  const { token } = Route.useSearch();
  return (
    <section className="flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-background">
      <ResourceEditor key={resource.unitId} unitId={resource.unitId} unitType={resource.unitType}
        user={user} readOnly {...(token ? { previewToken: token } : {})} />
    </section>
  );
}
