import { isIPv4, isIPv6 } from "node:net";

const WINDOW_MS = 60 * 60 * 1000;
const BUCKET_CAPACITY = 10_000;

export interface SourceRateLimiter {
  /** Records one event for the source and returns true, or returns false when the source is over its limit. */
  take(ip: string | undefined): boolean;
}

/** In-process sliding one-hour window per source. A limit of 0 refuses every event. */
export function createSourceRateLimiter(
  limitPerHour: number,
  now: () => number
): SourceRateLimiter {
  const buckets = new Map<string, number[]>();
  return {
    take(ip) {
      const at = now();
      const windowStart = at - WINDOW_MS;
      for (const [key, times] of buckets) {
        if (times.at(-1)! <= windowStart) buckets.delete(key);
      }
      const key = sourceBucket(ip);
      const recent = (buckets.get(key) ?? []).filter((time) => time > windowStart);
      // At capacity a new source is refused, so the map never outgrows BUCKET_CAPACITY.
      if (recent.length >= limitPerHour || (recent.length === 0 && buckets.size >= BUCKET_CAPACITY)) {
        return false;
      }
      recent.push(at);
      buckets.set(key, recent);
      return true;
    },
  };
}

/**
 * One host owns a whole IPv6 /64, so the bucket is that prefix. IPv4-mapped IPv6 is the IPv4 host.
 * Anything that is not an address shares one bucket, so a forwarded header cannot mint buckets.
 */
function sourceBucket(ip: string | undefined): string {
  const address = (ip ?? "").replace(/%.*$/u, "");
  if (isIPv4(address)) return address;
  if (!isIPv6(address)) return "unknown";
  const hex = address.replace(
    /(\d+)\.(\d+)\.(\d+)\.(\d+)$/u,
    (_match, a, b, c, d) => `${((Number(a) << 8) | Number(b)).toString(16)}:${((Number(c) << 8) | Number(d)).toString(16)}`
  );
  const [head = "", tail] = hex.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const words = (tail === undefined
    ? left
    : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right]
  ).map((group) => Number.parseInt(group, 16));
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return `${words[6]! >> 8}.${words[6]! & 255}.${words[7]! >> 8}.${words[7]! & 255}`;
  }
  return `${words.slice(0, 4).map((word) => word.toString(16)).join(":")}::/64`;
}
