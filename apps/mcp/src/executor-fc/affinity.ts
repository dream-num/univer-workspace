import { createHash } from "node:crypto";

// FC HeaderField session affinity: key and Session ID derivation.
// Design: docs/design/workspace-mcp/fc-headerfield.zh-CN.md sections 3.2 and 3.3.

/** FC HeaderField affinity header. Rename only together with the deployed trigger configuration. */
export const AFFINITY_HEADER = "x-executor-key";

// FC HeaderField limits: name 5-40 characters, letter first, never the `x-fc-` namespace.
const HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]{4,39}$/;
// FC HeaderField limits: value 1-64 characters, letter/digit/underscore first.
const HEADER_VALUE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;
const RESERVED_HEADER_PREFIX = "x-fc-";

/**
 * The routing key the gateway pins to one FC Session. `unitId` is `null` for operations that
 * have no Unit; unlike the gateway router's per-request fallback, this stays stable across
 * calls so the same caller keeps the same Session.
 */
export interface RuntimeKey {
  readonly userId: string;
  readonly scope: string;
  readonly unitId: string | null;
}

/**
 * Canonical key string: `userId\0scope\0unitId`. Stable across gateway replicas.
 * An empty scope is the "no Unit context" bucket (for example `diagnostics.probe`), not an
 * error: throwing there would break an operation instead of routing it.
 */
export function affinityKey(key: RuntimeKey): string {
  assertKeyPart("user ID", key.userId);
  assertKeyPart("scope", key.scope, true);
  assertKeyPart("Unit ID", key.unitId ?? "", true);
  return [key.userId, key.scope, key.unitId ?? ""].join("\0");
}

export function isValidAffinityHeaderName(name: string): boolean {
  return HEADER_NAME.test(name) && !name.toLowerCase().startsWith(RESERVED_HEADER_PREFIX);
}

export function isValidAffinityHeaderValue(value: string): boolean {
  return HEADER_VALUE.test(value);
}

export function assertAffinityHeaderName(name: string): void {
  if (!isValidAffinityHeaderName(name))
    throw new Error(
      `Invalid FC affinity header name ${JSON.stringify(name)}: expected 5-40 characters, a letter first, and no "x-fc-" prefix`,
    );
}

export function assertAffinityHeaderValue(value: string): void {
  if (!isValidAffinityHeaderValue(value))
    throw new Error(
      `Invalid FC affinity header value ${JSON.stringify(value)}: expected 1-64 characters from [A-Za-z0-9_-], a letter, digit or underscore first`,
    );
}

/**
 * `k` + the first 32 hex characters of sha256(`<key>:<epoch>`).
 * Deterministic, so every gateway replica derives the same Session for the same epoch.
 */
export function deriveSessionId(key: string, epoch: number): string {
  if (!Number.isSafeInteger(epoch) || epoch < 0)
    throw new Error("An affinity epoch must be a non-negative safe integer");
  return `k${createHash("sha256").update(`${key}:${epoch}`).digest("hex").slice(0, 32)}`;
}

function assertKeyPart(name: string, value: string, optional = false): void {
  if (value === "" && optional) return;
  if (value === "") throw new Error(`An affinity key requires a ${name}`);
  if (value.includes("\0"))
    throw new Error(`An affinity key ${name} must not contain a NUL separator`);
}
