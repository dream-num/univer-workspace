/** The product suffix used by the Harness browser title. */
export const AGENT_PRODUCT_TITLE = "Univer Workspace Agent";

/**
 * Format the browser title for the selected DSH session.
 *
 * Keep the same title shape as the native renderer (`session — product`), but
 * own the product suffix in this composition so the published DSH shell does
 * not leak its DeepSeek branding into the Workspace service.
 */
export function formatAgentDocumentTitle(sessionTitle: string | undefined): string {
  return sessionTitle === undefined
    ? AGENT_PRODUCT_TITLE
    : `${sessionTitle} — ${AGENT_PRODUCT_TITLE}`;
}
