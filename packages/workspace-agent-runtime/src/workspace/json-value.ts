/** JSON-compatible value shared by tool implementations and render metadata. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
