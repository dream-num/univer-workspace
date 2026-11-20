// What a tool call returned: structuredContent on success; on error the gateway sends
// {code, message, detail} as JSON in the first text item and no structuredContent.
// Errors this harness builds itself (transport failures) keep structuredContent.
export function toolOutput(result) {
  if (!result.isError || result.structuredContent) return result.structuredContent;
  const text = result.content?.find((item) => item.type === 'text')?.text;
  try { return JSON.parse(text); } catch { return { message: text }; }
}
