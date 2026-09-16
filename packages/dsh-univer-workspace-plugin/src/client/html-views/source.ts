/** Source identity and editability always come from Workspace's authenticated product API. */
export async function resolveHtmlViewSource(
  unitId: string,
  signal: AbortSignal,
): Promise<{ editorMode: "edit" | "readOnly" }> {
  const read = async (path: string, method = "GET") => {
    const response = await fetch(`/univer-workspace/api${path}`, {
      method,
      signal,
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTML view source access failed (${response.status}).`);
    return (await response.json()) as { resource?: Record<string, unknown> };
  };
  const resolved = await read(`/unit-resources/${encodeURIComponent(unitId)}`);
  if (typeof resolved.resource?.id !== "string")
    throw new Error("HTML view source resource is unavailable.");
  const opened = await read(`/resources/${encodeURIComponent(resolved.resource.id)}/open`, "POST");
  const source = opened.resource;
  if (
    source?.id !== resolved.resource.id ||
    source.kind !== "univer" ||
    source.unitType !== "sheet" ||
    source.unitId !== unitId ||
    (source.editorMode !== "edit" && source.editorMode !== "readOnly")
  ) {
    throw new Error(
      "HTML view source must be an accessible Sheet with an authoritative editor mode.",
    );
  }
  return { editorMode: source.editorMode };
}
