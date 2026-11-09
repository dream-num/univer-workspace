import { createServer, request as httpRequest, type Server } from "node:http";
import { spawn } from "node:child_process";
import { logger } from "../../server/src/logging/logger.js";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  assertCimdAddress, ClientMetadataDocumentError, createCimdLookup, createClientMetadataDocumentResolver,
  fetchClientMetadataDocument, isCimdClientId, parseCimdExemptNetworks, parseClientMetadataDocument,
  type CimdClientId, type FetchClientMetadataDocument,
} from "../../server/src/modules/identity/client-metadata-document.js";

function id(raw = "https://client.example/metadata"): CimdClientId {
  if (!isCimdClientId(raw, [])) throw new Error("Invalid test client_id");
  return raw;
}
const response = (clientId = id(), fields: Record<string, unknown> = {}, cacheControl?: string) => ({
  body: JSON.stringify({ client_id: clientId, redirect_uris: ["http://127.0.0.1/callback"], ...fields }),
  ...(cacheControl === undefined ? {} : { cacheControl }),
});
beforeEach(() => { vi.spyOn(logger, "info").mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

describe("CIMD URL and document validation", () => {
  it.each([
    "http://a.test/doc", "https://a.test", "https://a.test/", "https://u:p@a.test/doc", "https://@a.test/doc", "https://:@a.test/doc", "https://a.test/doc?", "https://a.test/doc#",
    "https://a.test/doc?q=x", "https://a.test/doc#x", "https://a.test/./doc", "https://a.test/a/../doc", "https://a.test/a/%2e%2e/doc",
    "https://a.test/a/.%2E/doc", "https://a.test/a/%2E./doc", "https://a.test/%2e/doc", "https://a.test/a/..", "https://a.test/a\\..\\doc",
    " https://a.test/doc", "https://a.test/a\nb", `https://a.test/${"x".repeat(2000)}`,
  ])("rejects %s before normalization", (raw) => expect(isCimdClientId(raw, [])).toBe(false));
  it("keeps identity verbatim and rejects issuer and resources by exact equality", () => {
    expect(id("https://A.test/a..b/%2efoo")).toBe("https://A.test/a..b/%2efoo");
    expect(isCimdClientId("https://a.test/doc", ["https://a.test/doc"])).toBe(false);
    expect(isCimdClientId("https://A.test/doc", ["https://a.test/doc"])).toBe(true);
    expect(isCimdClientId(`https://a.test/${"x".repeat(1985)}`, [])).toBe(true);
  });
  it.each([null, [], "x", 12])("requires a JSON object: %s", (value) => {
    expect(() => parseClientMetadataDocument(id(), { body: JSON.stringify(value) })).toThrow(ClientMetadataDocumentError);
  });
  it.each([
    { client_id: "https://other.test/doc" }, { client_secret: null }, { client_secret_expires_at: 0 }, { jwks: {} }, { jwks_uri: "https://a.test/key" },
    { token_endpoint_auth_method: "client_secret_basic" }, { token_endpoint_auth_method: null }, { token_endpoint_auth_methods_supported: ["private_key_jwt"] },
    { token_endpoint_auth_methods_supported: "none" }, { grant_types: ["refresh_token"] }, { grant_types: "authorization_code" }, { grant_types: null },
    { response_types: ["token"] }, { response_types: "code" }, { response_types: null }, { redirect_uris: [] }, { redirect_uris: null },
    { redirect_uris: Array(11).fill("https://a.test/cb") }, { redirect_uris: ["http://remote.test/cb"] }, { redirect_uris: ["https://a.test/cb#x"] },
    { redirect_uris: ["https://u:p@a.test/cb"] }, { redirect_uris: ["javascript:alert(1)"] }, { redirect_uris: ["myapp://callback"] },
  ])("rejects invalid metadata %j", (fields) => expect(() => parseClientMetadataDocument(id(), response(id(), fields))).toThrow(ClientMetadataDocumentError));
  it("defaults capabilities, ignores unsupported values and invalid names, and uses the DCR redirect policy", () => {
    expect(() => parseClientMetadataDocument(id(), { body: "{" })).toThrow();
    expect(parseClientMetadataDocument(id(), response()).grantTypes).toEqual(["authorization_code"]);
    for (const name of [42, null, "x".repeat(101), ""]) expect(parseClientMetadataDocument(id(), response(id(), { client_name: name })).clientName).toBeNull();
    const client = parseClientMetadataDocument(id(), response(id(), {
      client_name: "Claude Code", token_endpoint_auth_method: "none", token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
      grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:device_code"], response_types: ["code", "token"],
      redirect_uris: ["http://localhost/callback", "http://[::1]/callback", "https://a.test/cb", "com.example.app:/cb", "cursor://app/callback"], logo_uri: "https://a.test/logo",
    }));
    expect(client.grantTypes).toEqual(["authorization_code", "refresh_token"]);
    expect(client.clientName).toBe("Claude Code");
    expect(client.redirectUris).toHaveLength(5);
    expect(client).not.toHaveProperty("logo_uri");
  });
  it.each([[undefined, 300], ["max-age=1", 300], ["public, max-age=600", 600], ['max-age="1000"', 1000], ["max-age=90000", 86400], ["no-store, max-age=9999", 300], ["no-cache, max-age=9999", 300], ["max-age=invalid", 300]])("clamps TTL %s", (control, seconds) => {
    expect(parseClientMetadataDocument(id(), response(id(), {}, control), 100).expiresAt).toBe(100 + seconds! * 1000);
  });
});

describe("CIMD connection boundary", () => {
  it.each([
    "0.1.2.3", "10.1.2.3", "100.64.1.1", "127.0.0.1", "169.254.169.254", "172.31.1.1", "192.0.0.1", "192.0.2.2", "192.88.99.1", "192.168.1.1",
    "198.18.1.2", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::", "::1", "::7f00:1", "::a9fe:a9fe", "::ffff:127.0.0.1",
    "::ffff:169.254.169.254", "64:ff9b::101:101", "64:ff9b:1::1", "100::1", "2001::1", "2001:db8::1", "2002::1", "fc00::1", "fe80::1", "ff00::1",
  ])("blocks %s", (ip) => expect(() => assertCimdAddress(ip)).toThrow(ClientMetadataDocumentError));
  it.each(["1.1.1.1", "8.8.8.8", "::ffff:8.8.8.8", "2606:4700:4700::1111"])("allows public %s including mapped IPv4", (ip) => expect(() => assertCimdAddress(ip)).not.toThrow());
  it.each(["127.0.0.0/8", "127.0.0.1/32", "0.0.0.0/0", "126.0.0.0/7", "169.254.0.0/16", "::/0", "::1/128", "fe80::/10", "::ffff:127.0.0.0/104", "bad", "1.1.1.1/33"])("rejects unsafe exemption %s", (cidr) => expect(() => parseCimdExemptNetworks(cidr)).toThrow(/MCP_CIMD_EXEMPT_NETWORKS/u));
  it("exempts only the configured fake-IP network", () => {
    const exemptions = parseCimdExemptNetworks("198.18.0.0/15, 10.0.0.0/8");
    expect(() => assertCimdAddress("198.19.255.254", exemptions)).not.toThrow();
    expect(() => assertCimdAddress("127.0.0.1", exemptions)).toThrow();
    expect(() => assertCimdAddress("192.168.0.1", exemptions)).toThrow();
  });
  it("returns all checked addresses to Node's all:true callback and rejects a mixed DNS answer", async () => {
    const addresses = [{ address: "1.1.1.1", family: 4 }, { address: "2606:4700:4700::1111", family: 6 }];
    const lookup = createCimdLookup(undefined, async () => addresses);
    for (const all of [true, false]) await new Promise<void>((done) => lookup("example.test", { all }, (error, result, family) => {
      expect(error).toBeNull();
      expect(result).toEqual(all ? addresses : "1.1.1.1");
      expect(family).toBe(all ? undefined : 4);
      done();
    }));
    const mixed = createCimdLookup(undefined, async () => [...addresses, { address: "127.0.0.1", family: 4 }]);
    await new Promise<void>((done) => mixed("example.test", { all: true }, (error) => { expect(error).toBeInstanceOf(ClientMetadataDocumentError); done(); }));
  });
  it.each(["https://[::1]/doc", "https://[::ffff:127.0.0.1]/doc", "https://127.0.0.1/doc", "https://2130706433/doc"])("blocks literal %s before any request", async (raw) => {
    const request = vi.fn();
    await expect(fetchClientMetadataDocument(id(raw), { request })).rejects.toMatchObject({ temporary: false });
    expect(request).not.toHaveBeenCalled();
  });
  it("ignores NODE_USE_ENV_PROXY and HTTPS_PROXY so DNS checks cannot be bypassed", async () => {
    let tunnels = 0;
    const proxy = createServer();
    proxy.on("connect", (_req, socket) => { tunnels++; socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); });
    const port = await listen(proxy);
    try {
      const module = new URL("../../server/src/modules/identity/client-metadata-document.ts", import.meta.url).href;
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
        import { fetchClientMetadataDocument, createCimdLookup } from ${JSON.stringify(module)};
        let looked = false;
        try { await fetchClientMetadataDocument('https://metadata.example/doc', { lookup: createCimdLookup(undefined, async () => {
          looked = true; return [{address:'127.0.0.1',family:4}];
        }) }); process.exitCode=1; }
        catch (e) { console.log(JSON.stringify({looked, temporary:e.temporary})); }
      `], { env: { ...process.env, NODE_USE_ENV_PROXY: "1", HTTPS_PROXY: `http://127.0.0.1:${port}`, NO_PROXY: "" }, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (data) => { output += data; });
      const exit = await new Promise((done) => child.on("exit", done));
      expect(exit).toBe(0);
      expect(JSON.parse(output)).toEqual({ looked: true, temporary: false });
      expect(tunnels).toBe(0);
    } finally { await close(proxy); }
  });
});

async function listen(server: Server): Promise<number> {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No port");
  return address.port;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
}

it("requires HTTP 200, caps body bytes, and destroys a drip-fed response at the total deadline", async () => {
  const timers = new Set<ReturnType<typeof setInterval>>();
  const server = createServer((req, res) => {
    expect(req.method).toBe("GET");
    expect(req.headers.accept).toBe("application/json");
    expect(req.headers.cookie).toBeUndefined();
    if (req.url === "/drip") {
      res.writeHead(200); res.write("{");
      const timer = setInterval(() => res.write(" "), 50);
      timers.add(timer); res.on("close", () => { clearInterval(timer); timers.delete(timer); });
    } else if (req.url === "/large") res.end("x".repeat(5120));
    else if (req.url === "/ok") { res.setHeader("cache-control", "max-age=800"); res.end(response().body); }
    else { res.writeHead(Number(req.url?.slice(1)), { location: "/ok" }); res.end(); }
  });
  const port = await listen(server);
  const run = (path: string) => fetchClientMetadataDocument(id(`https://client.test${path}`), {
    request: (_url, options, callback) => httpRequest({ host: "127.0.0.1", port, path, method: options.method, headers: options.headers }, callback),
  });
  try {
    expect(await run("/ok")).toEqual({ body: response().body, cacheControl: "max-age=800" });
    for (const status of [201, 301, 302, 400, 404, 500, 503]) await expect(run(`/${status}`)).rejects.toMatchObject({ temporary: status >= 500 });
    await expect(run("/large")).rejects.toMatchObject({ temporary: false });
    const started = Date.now();
    await expect(run("/drip")).rejects.toMatchObject({ temporary: true, message: expect.stringContaining("5 seconds") });
    expect(Date.now() - started).toBeLessThan(6500);
  } finally {
    for (const timer of timers) clearInterval(timer);
    await close(server);
  }
}, 10_000);

describe("CIMD cache and fetch limits", () => {
  it("coalesces requests, counts joining users, and enforces per-user and global caps with stale fallback", async () => {
    let now = 0;
    let release: (() => void) | undefined;
    let gate: Promise<void> | undefined;
    const fetchDocument = vi.fn<FetchClientMetadataDocument>().mockImplementation(async (clientId) => { await gate; return response(clientId); });
    const resolve = createClientMetadataDocumentResolver({ fetchDocument, now: () => now });
    const cached = await resolve(id(), "owner");
    now = 300_001;
    gate = new Promise((done) => { release = done; });
    const first = resolve(id("https://a.test/doc"), "a");
    const joined = resolve(id("https://a.test/doc"), "b");
    await expect(resolve(id("https://b.test/doc"), "a")).rejects.toMatchObject({ temporary: true });
    await expect(resolve(id("https://b.test/doc"), "b")).rejects.toMatchObject({ temporary: true });
    expect(await resolve(id(), "a")).toBe(cached);
    const pending = Array.from({ length: 31 }, (_, i) => resolve(id(`https://busy.test/${i}`), `user${i}`));
    await expect(resolve(id("https://overflow.test/doc"), "new")).rejects.toMatchObject({ temporary: true });
    expect(await resolve(id(), "owner")).toBe(cached);
    release!();
    expect(await joined).toBe(await first);
    await Promise.all(pending);
    expect(fetchDocument).toHaveBeenCalledTimes(33);
    expect(logger.info).toHaveBeenCalledTimes(33);
    expect(logger.info).toHaveBeenCalledWith({ event: "oauth.cimd.fetch", client_id: id(), outcome: "success" }, "Client metadata fetch");
    await resolve(id("https://b.test/doc"), "a");
  });
  it("keeps stale documents for temporary errors for at most 24 h, drops invalid ones, and never caches failures", async () => {
    let now = 0;
    const fetchDocument = vi.fn<FetchClientMetadataDocument>().mockResolvedValue(response());
    const resolve = createClientMetadataDocumentResolver({ fetchDocument, now: () => now });
    const cached = await resolve(id(), "user");
    expect(await resolve(id(), "user")).toBe(cached);
    expect(fetchDocument).toHaveBeenCalledTimes(1);
    now = 300_001;
    fetchDocument.mockRejectedValue(new ClientMetadataDocumentError(true, "503"));
    expect(await resolve(id(), "user")).toBe(cached);
    now = 86400_000;
    await expect(resolve(id(), "user")).rejects.toThrow("503");
    fetchDocument.mockResolvedValue(response());
    await resolve(id(), "user");
    now += 300_001;
    fetchDocument.mockResolvedValue(response(id("https://other.test/doc")));
    await expect(resolve(id(), "user")).rejects.toMatchObject({ temporary: false });
    fetchDocument.mockRejectedValue(new ClientMetadataDocumentError(true, "offline"));
    await expect(resolve(id(), "user")).rejects.toThrow("offline");
    await expect(resolve(id(), "user")).rejects.toThrow("offline");
    expect(fetchDocument).toHaveBeenCalledTimes(7);
  });
  it("bounds the cache at 1000, evicting expired documents before the oldest insertion", async () => {
    let now = 0;
    const fetchDocument = vi.fn<FetchClientMetadataDocument>().mockImplementation(async (clientId) => response(clientId, {}, clientId.endsWith("/long") ? "max-age=86400" : undefined));
    const resolve = createClientMetadataDocumentResolver({ fetchDocument, now: () => now });
    await resolve(id("https://cache.test/long"), "u");
    for (let i = 0; i < 999; i++) await resolve(id(`https://cache.test/${i}`), "u");
    now = 300_001;
    await resolve(id("https://cache.test/new"), "u");
    await resolve(id("https://cache.test/long"), "u");
    expect(fetchDocument).toHaveBeenCalledTimes(1001);
    for (let i = 0; i < 999; i++) await resolve(id(`https://new.test/${i}`), "u");
    await resolve(id("https://cache.test/long"), "u");
    expect(fetchDocument).toHaveBeenCalledTimes(2001);
  });
});
