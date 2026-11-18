import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  assertPublishContext,
  INSIDER,
  npmPublishArguments,
  PACKAGE,
  preparePromotion,
  PUBLIC,
  publishPromotion,
  publishTarball,
  validateVersion,
} from "./promote-cli-public.mjs";

const execute = promisify(execFile);
const version = "0.7.0";
const env = {
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: "dream-num/univer-workspace",
  BASE_BRANCH: "main",
  GITHUB_REF: "refs/heads/main",
  GITHUB_WORKFLOW_REF:
    "dream-num/univer-workspace/.github/workflows/promote-cli-public.yml@refs/heads/main",
  GITHUB_SHA: "a".repeat(40),
  GITHUB_RUN_ID: "12",
  GITHUB_RUN_ATTEMPT: "1",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.invalid/oidc",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "synthetic-oidc",
  INSIDER_TOKEN: "synthetic-insider",
};

async function fixture(t, manifest = {}) {
  const directory = await mkdtemp(join(tmpdir(), "cli-promotion-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "source");
  await mkdir(join(source, "package"), { recursive: true });
  await writeFile(
    join(source, "package/package.json"),
    JSON.stringify({
      name: PACKAGE,
      version,
      publishConfig: { registry: INSIDER },
      scripts: { prepublishOnly: "exit 91", publish: "exit 92", postpublish: "exit 93" },
      ...manifest,
    }),
  );
  const tarball = join(directory, "original.tgz");
  await execute("tar", ["-czf", tarball, "-C", source, "package"]);
  const bytes = await readFile(tarball);
  const hash = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  const metadata = {
    name: PACKAGE,
    version,
    dist: {
      tarball: `${INSIDER}${PACKAGE}/-/${PACKAGE}-${version}.tgz`,
      integrity: hash,
    },
  };
  const plan = {
    status: "completed",
    dryRun: true,
    publicRegistryWriteVerified: false,
    packageCount: 1,
    packages: [{ name: PACKAGE, version, publicVersion: "publish" }],
  };
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/promotions?")) return Response.json(plan);
    if (String(url).endsWith(".tgz")) return new Response(bytes);
    return Response.json(metadata);
  };
  return { directory, bytes, tarball, hash, metadata, plan, calls, fetcher };
}

test("accepts only exact stable versions and gates public writes to the configured manual workflow", () => {
  assert.equal(validateVersion(version), version);
  for (const value of [
    undefined,
    "latest",
    "^0.7.0",
    "v0.7.0",
    "0.7.0-dev.1",
    "0.7.0-insider.1",
    "0.7.0+abc",
    "01.7.0",
    "0.7.0\n",
  ]) {
    assert.throws(() => validateVersion(value), /exact stable/u);
  }
  assert.doesNotThrow(() => assertPublishContext(env));
  for (const change of [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_REF: "refs/tags/v0.7.0" },
    { GITHUB_REPOSITORY: "someone/fork" },
    {
      GITHUB_WORKFLOW_REF: "dream-num/univer-workspace/.github/workflows/other.yml@refs/heads/main",
    },
    { ACTIONS_ID_TOKEN_REQUEST_TOKEN: "" },
  ])
    assert.throws(() => assertPublishContext({ ...env, ...change }), /manual dispatch/u);
});

test("validation sends one dry-run request, preserves original bytes, and never calls public writes", async (t) => {
  const f = await fixture(t);
  const record = await preparePromotion({ ...f, version, env });
  assert.equal(record.integrity, f.hash);
  assert.deepEqual(await readFile(join(f.directory, record.tarball)), f.bytes);
  assert.equal(record.plan.publicRegistryWriteVerified, false);
  assert.equal(f.calls.length, 3);
  const request = f.calls[0];
  assert.equal(request.url, `${INSIDER}-/insider/v1/promotions?wait=true&dryRun=true`);
  assert.deepEqual(JSON.parse(request.options.body), { packages: [{ name: PACKAGE, version }] });
  assert.equal(request.options.headers.authorization, "Bearer synthetic-insider");
  assert.equal(f.calls[2].options.headers, undefined);
  assert.ok(!JSON.stringify(record).includes("synthetic-insider"));
});

test("policy/dependency/auth rejection stops immediately and invalidates stale preparation", async (t) => {
  for (const status of [401, 403, 409, 500]) {
    const f = await fixture(t);
    await writeFile(join(f.directory, "promotion.json"), "stale");
    let calls = 0;
    await assert.rejects(
      preparePromotion({
        ...f,
        version,
        env,
        fetcher: async () => {
          calls += 1;
          return Response.json(
            { error: "REJECTED", message: "policy or public dependency rejected" },
            { status },
          );
        },
      }),
      new RegExp(`\\(${status}\\).*REJECTED`, "u"),
    );
    assert.equal(calls, 1);
    await assert.rejects(readFile(join(f.directory, "promotion.json")), /ENOENT/u);
  }
});

test("rejects missing credentials, incomplete or expanded plans, tampering, and non-insider sources", async (t) => {
  const f = await fixture(t);
  await assert.rejects(preparePromotion({ ...f, version, env: {} }), /INSIDER_TOKEN/u);
  for (const change of [
    { status: "running" },
    { dryRun: false },
    { publicRegistryWriteVerified: true },
    { packageCount: 2 },
    { packages: [{ name: "other", version, publicVersion: "publish" }] },
    { packages: [{ name: PACKAGE, version: "0.8.0", publicVersion: "publish" }] },
  ]) {
    await assert.rejects(
      preparePromotion({
        ...f,
        version,
        env,
        fetcher: async () => Response.json({ ...f.plan, ...change }),
      }),
      /exact completed CLI-only plan/u,
    );
  }
  f.metadata.dist.integrity = "sha512-wrong";
  await assert.rejects(preparePromotion({ ...f, version, env }), /integrity mismatch/u);
  f.metadata.dist.tarball = `${PUBLIC}${PACKAGE}/-/original.tgz`;
  await assert.rejects(preparePromotion({ ...f, version, env }), /still be hosted/u);
  const wrong = await fixture(t, { name: "another-package" });
  await assert.rejects(preparePromotion({ ...wrong, version, env }), /tarball manifest/u);
  const privatePackage = await fixture(t, { private: true });
  await assert.rejects(preparePromotion({ ...privatePackage, version, env }), /tarball manifest/u);
});

test("publishes only the reviewed tarball then verifies public version and integrity", async (t) => {
  const f = await fixture(t);
  await preparePromotion({ ...f, version, env });
  let reads = 0;
  let publishes = 0;
  const result = await publishPromotion({
    ...f,
    version,
    env,
    fetcher: async (url) => {
      assert.equal(url, `${PUBLIC}${PACKAGE}/${version}`);
      return ++reads === 1 ? new Response(null, { status: 404 }) : Response.json(f.metadata);
    },
    publisher: async (path) => {
      publishes += 1;
      assert.deepEqual(await readFile(path), f.bytes);
    },
  });
  assert.equal(publishes, 1);
  assert.equal(result.action, "published");
  assert.equal(result.publicRegistryWriteVerified, true);
});

test("reuses an identical public artifact without claiming OIDC writes were verified", async (t) => {
  const f = await fixture(t);
  await preparePromotion({ ...f, version, env });
  const result = await publishPromotion({
    ...f,
    version,
    env,
    publisher: () => assert.fail("must not publish"),
  });
  assert.equal(result.action, "reused");
  assert.equal(result.publicRegistryWriteVerified, false);
});

test("rejects context, run, version, bytes and public conflicts before publishing", async (t) => {
  const f = await fixture(t);
  await preparePromotion({ ...f, version, env });
  const options = { ...f, version, env, publisher: () => assert.fail("must not publish") };
  for (const change of [
    { GITHUB_RUN_ID: "13" },
    { GITHUB_RUN_ATTEMPT: "2" },
    { GITHUB_SHA: "b".repeat(40) },
  ]) {
    await assert.rejects(
      publishPromotion({ ...options, env: { ...env, ...change } }),
      /this workflow run/u,
    );
  }
  await assert.rejects(publishPromotion({ ...options, version: "0.8.0" }), /exact completed/u);
  f.metadata.dist.integrity = "sha512-conflict";
  await assert.rejects(publishPromotion(options), /readback does not match/u);
  await writeFile(join(f.directory, "univer-workspace-cli.tgz"), "tampered");
  await assert.rejects(publishPromotion(options), /integrity mismatch/u);
});

test("public read failure, publish failure, and wrong final integrity fail closed without retries", async (t) => {
  const f = await fixture(t);
  await preparePromotion({ ...f, version, env });
  await assert.rejects(
    publishPromotion({
      ...f,
      version,
      env,
      fetcher: async () => new Response(null, { status: 403 }),
      publisher: () => assert.fail("must not publish"),
    }),
    /readback failed \(403\)/u,
  );
  let publishes = 0;
  await assert.rejects(
    publishPromotion({
      ...f,
      version,
      env,
      fetcher: async () => new Response(null, { status: 404 }),
      publisher: () => {
        publishes += 1;
        throw new Error("uncertain upload");
      },
    }),
    /uncertain upload/u,
  );
  assert.equal(publishes, 1);
  await assert.rejects(
    publishPromotion({
      ...f,
      version,
      env,
      fetcher: async () => new Response(null, { status: 404 }),
      publisher: async () => {},
    }),
    /readback does not match/u,
  );
});

test("public npm subprocess receives OIDC context without insider or token credentials", async (t) => {
  const f = await fixture(t);
  const bin = join(f.directory, "bin");
  await mkdir(bin);
  await writeFile(
    join(bin, "npm"),
    `#!${process.execPath}\nconsole.log(JSON.stringify({env:process.env,args:process.argv.slice(2),cwd:process.cwd()}));\n`,
  );
  await chmod(join(bin, "npm"), 0o755);
  const result = await publishTarball(f.tarball, {
    ...env,
    PATH: bin,
    NPM_TOKEN: "synthetic-secret",
    NODE_AUTH_TOKEN: "synthetic-secret",
    NPM_CONFIG_REGISTRY: INSIDER,
    NPM_CONFIG_USERCONFIG: "/private/npmrc",
  });
  const observed = JSON.parse(result.stdout);
  for (const key of [
    "INSIDER_TOKEN",
    "NPM_TOKEN",
    "NODE_AUTH_TOKEN",
    "NPM_CONFIG_REGISTRY",
    "NPM_CONFIG_USERCONFIG",
  ]) {
    assert.equal(observed.env[key], undefined);
  }
  assert.equal(observed.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
  assert.deepEqual(observed.args, npmPublishArguments(f.tarball));
  assert.notEqual(observed.cwd, process.cwd());
});

test("real npm overrides the tarball insider publishConfig and uploads byte-identical original to loopback", async (t) => {
  const f = await fixture(t);
  const requests = [];
  const server = createServer(async (request, reply) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({
      method: request.method,
      url: request.url,
      body: Buffer.concat(chunks).toString(),
    });
    reply.setHeader("content-type", "application/json");
    if (request.method === "PUT") reply.end(JSON.stringify({ ok: true }));
    else {
      reply.statusCode = 404;
      reply.end(JSON.stringify({ error: "not_found" }));
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  const port = server.address().port;
  const registry = `http://127.0.0.1:${port}/`;
  const args = [
    ...npmPublishArguments(f.tarball, registry),
    `--//127.0.0.1:${port}/:_authToken=synthetic-loopback-only`,
  ];
  await execute("npm", args, {
    cwd: f.directory,
    timeout: 60_000,
    env: {
      PATH: process.env.PATH,
      HOME: f.directory,
      NPM_CONFIG_CACHE: join(f.directory, "cache"),
      NPM_CONFIG_GLOBALCONFIG: join(f.directory, "empty-global.npmrc"),
    },
  });
  const uploads = requests.filter((request) => request.method === "PUT");
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].url, `/${PACKAGE}`);
  const document = JSON.parse(uploads[0].body);
  const attachment = Object.values(document._attachments)[0];
  assert.deepEqual(Buffer.from(attachment.data, "base64"), f.bytes);
  assert.equal(document.versions[version].dist.integrity, f.hash);
  assert.equal(document.versions[version].publishConfig.registry, INSIDER);
  assert.deepEqual(await readFile(f.tarball), f.bytes);
});
