import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { verifyPublicCli } from "./verify-cli-public.mjs";

const version = "0.7.1";
const registry = "https://registry.npmjs.org/";
const tarball = Buffer.from("fixture tarball bytes");
const integrity = (bytes) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
const expectedIntegrity = integrity(tarball);

function fixture({ packageName = "univer-workspace-cli", change, status = 200, published = tarball } = {}) {
  const tarballUrl = `${registry}${packageName}/-/${packageName}-${version}.tgz`;
  const meta = {
    name: packageName,
    version,
    dist: { tarball: tarballUrl, integrity: expectedIntegrity },
  };
  change?.(meta);
  const urls = [];
  return {
    tarballUrl,
    urls,
    request: {
      packageName,
      version,
      expectedIntegrity,
      fetcher: async (url, options) => {
        urls.push(url);
        assert.equal(options.method, "GET");
        assert.equal(options.redirect, "error");
        assert.deepEqual(Object.keys(options.headers).sort(), ["accept", "cache-control"]);
        if (url === `${registry}${packageName}/${version}`) {
          return status === 200 ? Response.json(meta) : new Response(null, { status });
        }
        assert.equal(url, tarballUrl);
        return new Response(published);
      },
    },
  };
}

for (const packageName of ["univer-workspace-cli", "univer-cli"]) {
  test(`verifies exact metadata and downloaded bytes for ${packageName}`, async () => {
    const f = fixture({ packageName });
    assert.deepEqual(await verifyPublicCli(f.request), {
      packageName, version, integrity: expectedIntegrity, tarballUrl: f.tarballUrl,
    });
    assert.deepEqual(f.urls, [`${registry}${packageName}/${version}`, f.tarballUrl]);
  });
}

test("rejects a different metadata digest without fetching tarball", async () => {
  const f = fixture({ change: (meta) => { meta.dist.integrity = integrity("different"); } });
  await assert.rejects(verifyPublicCli(f.request), /metadata integrity does not match/u);
  assert.equal(f.urls.length, 1);
});

test("rejects mismatched bytes even if the metadata digest matches", async () => {
  const f = fixture({ published: "changed bytes" });
  await assert.rejects(verifyPublicCli(f.request), /tarball bytes do not match/u);
  assert.equal(f.urls.length, 2);
});

for (const [field, value] of [["name", "another-package"], ["version", "9.0.0"]]) {
  test(`rejects different metadata ${field}`, async () => {
    const f = fixture({ change: (meta) => { meta[field] = value; } });
    await assert.rejects(verifyPublicCli(f.request), /different package name or version/u);
    assert.equal(f.urls.length, 1);
  });
}

test("does not verify a package not yet public or another HTTP failure", async () => {
  await assert.rejects(verifyPublicCli(fixture({ status: 404 }).request), /not visible/u);
  await assert.rejects(verifyPublicCli(fixture({ status: 503 }).request), /HTTP 503/u);
});

test("rejects untrusted registry, another artifact under npm and redirects", async () => {
  for (const url of [
    "https://example.invalid/univer-workspace-cli-0.7.1.tgz",
    `${registry}univer-workspace-cli/-/univer-workspace-cli-0.7.0.tgz`,
  ]) {
    const f = fixture({ change: (meta) => { meta.dist.tarball = url; } });
    await assert.rejects(verifyPublicCli(f.request), /exact trusted registry tarball/u);
    assert.equal(f.urls.length, 1);
  }
  const f = fixture();
  const originalFetch = f.request.fetcher;
  f.request.fetcher = (url, options) => url === f.tarballUrl
    ? Promise.resolve(Response.redirect("https://example.invalid/"))
    : originalFetch(url, options);
  await assert.rejects(verifyPublicCli(f.request), /tarball HTTP 302/u);
});

test("rejects invalid inputs before any network traffic", async () => {
  const f = fixture();
  for (const invalid of [
    { packageName: "my-pkg" },
    { version: "latest" },
    { version: "^0.7.1" },
    { version: "0.7.1\n" },
    { version: "0.7.1-01" },
    { expectedIntegrity: "sha512-wrong" },
  ]) {
    await assert.rejects(verifyPublicCli({ ...f.request, ...invalid }));
  }
  assert.equal(f.urls.length, 0);
});

test("workflow has one manual read-only job and does not interpolate inputs into shell", async () => {
  const yaml = await readFile(
    new URL("../../.github/workflows/verify-cli-public.yml", import.meta.url), "utf8",
  );
  assert.match(yaml, /^on:\n  workflow_dispatch:\n    inputs:/mu);
  assert.deepEqual([...yaml.matchAll(/^  ([\w-]+):\n/gmu)].map((match) => match[1]),
    ["workflow_dispatch", "verify"]);
  assert.match(yaml, /options:\n          - univer-workspace-cli\n          - univer-cli\n/u);
  assert.match(yaml, /expected_integrity:\n[^\n]*\n        required: true\n/u);
  assert.match(yaml, /^permissions:\n  contents: read$/mu);
  assert.match(yaml, /persist-credentials: false/u);
  assert.doesNotMatch(yaml, /secrets\.|id-token:|: write|publish-cli\.mjs|npm (publish|unpublish)/u);
  assert.deepEqual([...yaml.matchAll(/^\s*run: (.*)$/gmu)].map((match) => match[1]),
    ["node scripts/release/verify-cli-public.mjs"]);
});
