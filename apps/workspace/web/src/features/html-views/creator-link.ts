import type { useI18n } from "../../shared/i18n";

export type HtmlViewCreatorRequest =
  | { readonly kind: "new" }
  | { readonly kind: "sheet"; readonly name: string; readonly resourceId: string }
  | { readonly kind: "change"; readonly name: string; readonly resourceId: string };

export function htmlViewCreatorLink(spaceId: string, request: HtmlViewCreatorRequest, t: ReturnType<typeof useI18n>["t"]) {
  const keys = { new: "htmlViewCreatorNewPrompt", sheet: "htmlViewCreatorSheetPrompt", change: "htmlViewCreatorChangePrompt" } as const;
  return {
    to: "/spaces/$spaceId/agents" as const,
    params: { spaceId },
    search: { prompt: `/html-view-creator ${t(keys[request.kind], request.kind === "new" ? undefined : { name: request.name, resourceId: request.resourceId })}` },
  };
}
