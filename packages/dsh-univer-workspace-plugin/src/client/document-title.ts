/** The product suffix used by the Harness browser title. */
export const HARNESS_PRODUCT_TITLE = "Univer Workspace Harness";

/**
 * Format the browser title for the selected DSH session.
 *
 * Keep the same title shape as the native renderer (`session — product`), but
 * own the product suffix in this composition so the published DSH shell does
 * not leak its DeepSeek branding into the Workspace service.
 */
export function formatHarnessDocumentTitle(sessionTitle: string | undefined): string {
  return sessionTitle === undefined
    ? HARNESS_PRODUCT_TITLE
    : `${sessionTitle} — ${HARNESS_PRODUCT_TITLE}`;
}
