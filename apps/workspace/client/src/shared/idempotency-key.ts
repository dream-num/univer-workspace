export function createIdempotencyKey(): string {
  const timestamp = Date.now().toString(36);
  const random = Array.from({ length: 3 }, () =>
    Math.random().toString(36).slice(2)
  ).join("");

  return `browser-${timestamp}-${random}`;
}
