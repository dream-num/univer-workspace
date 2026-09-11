/**
 * Web Crypto-based authentication, password hashing, and session management.
 * Pure Web Standards (crypto.subtle), zero node native dependencies.
 */

const PBKDF2_ITERATIONS = 100_000;
const KEY_LEN = 32;

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function hexToBuffer(hex: string): Uint8Array {
  const len = hex.length / 2;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Hashes a plaintext password using PBKDF2 with SHA-256 and a random 16-byte salt.
 * Output format: `pbkdf2:sha256:<salt_hex>:<hash_hex>`
 */
export async function hashPassword(password: string, customSaltHex?: string): Promise<string> {
  const salt = customSaltHex ? hexToBuffer(customSaltHex) : crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256"
    },
    keyMaterial,
    KEY_LEN * 8
  );

  const saltHex = bufferToHex(salt.buffer);
  const hashHex = bufferToHex(derivedBits);
  return `pbkdf2:sha256:${saltHex}:${hashHex}`;
}

/**
 * Verifies a plaintext password against a stored PBKDF2 hash.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") {
    return false;
  }
  const saltHex = parts[2];
  const expectedHashHex = parts[3];

  const calculated = await hashPassword(password, saltHex);
  const calculatedParts = calculated.split(":");
  const calculatedHashHex = calculatedParts[3];

  return calculatedHashHex === expectedHashHex;
}

/**
 * Generates a cryptographically random 32-byte session token encoded as hex.
 */
export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bufferToHex(bytes.buffer);
}

/**
 * Hashes a session token with SHA-256 for secure database storage.
 */
export async function hashToken(token: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(token));
  return bufferToHex(digest);
}

/**
 * Parses a specific cookie value from the `Cookie` HTTP request header.
 */
export function parseCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Serializes a session cookie for `Set-Cookie` response headers.
 */
export function serializeSessionCookie(
  token: string,
  maxAgeSec: number = 7 * 24 * 3600,
  secure: boolean = false
): string {
  let cookie = `workspace_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
  if (secure) {
    cookie += "; Secure";
  }
  return cookie;
}

/**
 * Serializes an expired session cookie to clear it on the client.
 */
export function serializeClearSessionCookie(secure: boolean = false): string {
  let cookie = "workspace_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
  if (secure) {
    cookie += "; Secure";
  }
  return cookie;
}
