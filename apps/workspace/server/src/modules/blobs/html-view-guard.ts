import { isHtmlViewFilename } from "@univerjs-labs/html-view";
import { ApplicationError } from "../../middleware/errors.js";
import type { Principal } from "../identity/index.js";

export function assertNotDelegatedPageWrite(actor: Principal, names: readonly string[]): void {
  if (actor.tokenIssued && names.some(isHtmlViewFilename)) {
    throw new ApplicationError(
      "HTML_VIEW_DRAFT_REQUIRED",
      403,
      "Pages (.univer.html) from Agents must go through html_view_create or html_view_replace drafts.",
    );
  }
}
