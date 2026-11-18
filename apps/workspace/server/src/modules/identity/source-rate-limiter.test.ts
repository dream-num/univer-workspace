import { describe, expect, it } from "vitest";
import { createSourceRateLimiter } from "./source-rate-limiter.js";

const HOUR = 60 * 60 * 1000;

describe("source rate limiter", () => {
  it("allows the limit per IPv4 address and refuses the next creation", () => {
    const limiter = createSourceRateLimiter(2, () => 0);
    expect([limiter.take("203.0.113.7"), limiter.take("203.0.113.7"), limiter.take("203.0.113.7")]).toEqual([true, true, false]);
    expect(limiter.take("203.0.113.8")).toBe(true);
  });

  it("counts every address of one IPv6 /64 together", () => {
    const limiter = createSourceRateLimiter(1, () => 0);
    expect(limiter.take("2001:db8:1:2::1")).toBe(true);
    expect(limiter.take("2001:db8:1:2:ffff:ffff:ffff:ffff")).toBe(false);
    expect(limiter.take("2001:0db8:0001:0002:0:0:0:9%eth0")).toBe(false);
    expect(limiter.take("2001:db8:1:3::1")).toBe(true);
  });

  it("counts IPv4-mapped IPv6 as the IPv4 address", () => {
    const limiter = createSourceRateLimiter(1, () => 0);
    expect(limiter.take("::ffff:203.0.113.7")).toBe(true);
    expect(limiter.take("203.0.113.7")).toBe(false);
    expect(limiter.take("::ffff:cb00:7107")).toBe(false);
    expect(limiter.take("::1")).toBe(true);
    expect(limiter.take("::2")).toBe(false);
  });

  it("slides the window: a creation stops counting one hour later", () => {
    let now = 0;
    const limiter = createSourceRateLimiter(2, () => now);
    expect(limiter.take("203.0.113.7")).toBe(true);
    now = HOUR / 2;
    expect(limiter.take("203.0.113.7")).toBe(true);
    now = HOUR - 1;
    expect(limiter.take("203.0.113.7")).toBe(false);
    now = HOUR;
    expect(limiter.take("203.0.113.7")).toBe(true);
    expect(limiter.take("203.0.113.7")).toBe(false);
    now = HOUR + HOUR / 2;
    expect(limiter.take("203.0.113.7")).toBe(true);
  });

  it("refuses every creation when the limit is 0", () => {
    const limiter = createSourceRateLimiter(0, () => 0);
    expect(limiter.take("203.0.113.7")).toBe(false);
    expect(limiter.take(undefined)).toBe(false);
  });

  it("shares one bucket between requests without a valid address", () => {
    const limiter = createSourceRateLimiter(1, () => 0);
    expect(limiter.take(undefined)).toBe(true);
    expect(limiter.take("not-an-address")).toBe(false);
    expect(limiter.take("another, forged value")).toBe(false);
    expect(limiter.take("203.0.113.7")).toBe(true);
  });

  it("refuses new sources at capacity and admits them again once old buckets expire", () => {
    let now = 0;
    const limiter = createSourceRateLimiter(1, () => now);
    for (let index = 0; index < 10_000; index += 1) {
      expect(limiter.take(`10.${index >> 16}.${(index >> 8) & 255}.${index & 255}`)).toBe(true);
    }
    expect(limiter.take("203.0.113.7")).toBe(false);
    now = HOUR;
    expect(limiter.take("203.0.113.7")).toBe(true);
  });

  it("admits new sources at capacity when asked to, and still limits the sources it tracks", () => {
    const limiter = createSourceRateLimiter(1, () => 0, "admit");
    for (let index = 0; index < 10_000; index += 1) {
      expect(limiter.take(`10.${index >> 16}.${(index >> 8) & 255}.${index & 255}`)).toBe(true);
    }
    expect([limiter.allows("203.0.113.7"), limiter.take("203.0.113.7"), limiter.take("203.0.113.7")]).toEqual([true, true, true]);
    expect(limiter.take("10.0.0.0")).toBe(false);
  });
});
