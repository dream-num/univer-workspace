export interface CanonicalJsonMeasurement {
  readonly bytes: number;
  readonly depth: number;
}

export function measureCanonicalJson(value: unknown): CanonicalJsonMeasurement {
  let maxDepth = 0;
  const visiting = new Set<object>();
  const visit = (candidate: unknown, depth: number): void => {
    maxDepth = Math.max(maxDepth, depth);
    if (
      candidate === null
      || typeof candidate === "string"
      || typeof candidate === "boolean"
      || (typeof candidate === "number" && Number.isFinite(candidate))
    ) return;
    if (typeof candidate !== "object" || visiting.has(candidate)) throw new TypeError("Value is not lossless JSON.");
    visiting.add(candidate);
    try {
      const keys = Reflect.ownKeys(candidate);
      if (Array.isArray(candidate)) {
        if (keys.length !== candidate.length + 1) throw new TypeError("Value is not lossless JSON.");
        for (let index = 0; index < candidate.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
          if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
            throw new TypeError("Value is not lossless JSON.");
          }
          visit(descriptor.value, depth + 1);
        }
      } else {
        const prototype = Object.getPrototypeOf(candidate);
        if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Value is not lossless JSON.");
        for (const key of keys) {
          if (typeof key !== "string") throw new TypeError("Value is not lossless JSON.");
          const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
          if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
            throw new TypeError("Value is not lossless JSON.");
          }
          visit(descriptor.value, depth + 1);
        }
      }
    } finally {
      visiting.delete(candidate);
    }
  };
  visit(value, 0);
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Value is not lossless JSON.");
  return { bytes: Buffer.byteLength(serialized), depth: maxDepth };
}
