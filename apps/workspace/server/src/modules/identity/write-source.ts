export type WriteSource = "browser" | "agent";
export type WriteSourceView = WriteSource | "unknown";

export function writeSourceView(value: WriteSource | null): WriteSourceView {
  return value ?? "unknown";
}
