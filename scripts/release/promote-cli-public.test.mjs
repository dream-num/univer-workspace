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
  downloadInsiderTarball,
  INSIDER,
  npmPublishArguments,
  npmTagArguments,
  preparePromotion,
  PUBLIC,
  publishPromotion,
  publishTarball,
  setLatest,
  validatePackageName,
  validateVersion,
} from "./promote-cli-public.mjs";

const execute = promisify(execFile);
const PACKAGE = "univer-workspace-cli";
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

async function fixture(
  t,
  {
    packageName = PACKAGE,
    selectedVersion = version,
    latest = false,
    manifest = {},
    context = env,
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "promotion-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "source");
  await mkdir(join(source, "package"), { recursive: true });
  await writeFile(
    join(source, "package/package.json"),
    JSON.stringify({
      name: packageName,
      version: selectedVersion,
      publishConfig: { registry: INSIDER, tag: "latest" },
      scripts: { prepublishOnly: "exit 91", publish: "exit 92", postpublish: "exit 93" },
      ...manifest,
    }),
  );
  const tarball = join(directory, "source.tgz");
  await execute("tar", ["-czf", tarball, "-C", source, "package"]);
  const bytes = await readFile(tarball);
  const hash = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  const metadata = {
    name: packageName,
    version: selectedVersion,
    dist: { tarball: `${INSIDER}artifact.tgz`, integrity: hash },
  };
  const plan = {
    status: "completed",
    dryRun: true,
    publicRegistryWriteVerified: false,
    packageCount: 1,
    packages: [{ name: packageName, version: selectedVersion, publicVersion: "publish" }],
  };
  const state = {
    exists: true,
    packageExists: true,
    sourceLatest: selectedVersion,
    tags: { latest: "0.6.0" },
    writes: [],
  };
  const calls = [];
  const encoded = encodeURIComponent(packageName);
  const fetcher = async (url, options) => {
    const value = String(url);
    calls.push({ url: value, options });
    if (value === `${INSIDER}-/insider/v1/promotions?wait=true&dryRun=true`)
      return Response.json(plan);
    if (value === `${INSIDER}artifact.tgz`) return new Response(bytes);
    if (value === `${INSIDER}${encoded}`)
      return Response.json({ name: packageName, versions: { [selectedVersion]: metadata }, "dist-tags": { latest: state.sourceLatest } });
    if (value === `${PUBLIC}${encoded}/${selectedVersion}`)
      return state.exists ? Response.json(metadata) : new Response(null, { status: 404 });
    if (value === `${PUBLIC}${encoded}`)
      return state.packageExists
        ? Response.json({ name: packageName, "dist-tags": state.tags })
        : new Response(null, { status: 404 });
    assert.fail(`Unexpected URL ${value}`);
  };
  const publisher = async (path, ignoredEnv, tag) => {
    assert.deepEqual(await readFile(path), bytes);
    state.writes.push(`publish:${tag}`);
    state.exists = true;
    state.packageExists = true;
    state.tags[tag] = selectedVersion;
  };
  const tagger = async (name, exactVersion) => {
    assert.equal(name, packageName);
    assert.equal(exactVersion, selectedVersion);
    state.writes.push("latest");
    state.tags.latest = selectedVersion;
  };
  return {
    packageName,
    version: selectedVersion,
    latest,
    directory,
    env: context,
    fetcher,
    publisher,
    tagger,
    state,
    calls,
    metadata,
    plan,
    bytes,
    hash,
    tarball,
  };
}

async function prepared(t, options) {
  const f = await fixture(t, options);
  await preparePromotion(f);
  return f;
}

test("validates package names, exact SemVer, and matching default-branch workflow context", () => {
  for (const name of [PACKAGE, "@another-scope/tool", "another.tool"])
    assert.equal(validatePackageName(name), name);
  for (const name of [
    undefined,
    "",
    "../x",
    "@scope/../x",
    "pkg/path",
    "@scope/name/extra",
    "https://evil",
    "foo%2fbar",
    "a?x=1",
    "a#b",
    "A",
    "a\n",
    "--flag",
    "@scope/.hidden",
    "node_modules",
    "x".repeat(215),
  ]) {
    assert.throws(() => validatePackageName(name), /valid npm package/u);
  }
  for (const value of [version, "1.2.3-rc.1", "1.2.3+build.2"])
    assert.equal(validateVersion(value), value);
  for (const value of [
    undefined,
    "latest",
    "^0.7.0",
    "v0.7.0",
    "01.7.0",
    "1.2.3-01",
    "0.7.0\n",
    "1.2.3/../../x",
  ])
    assert.throws(() => validateVersion(value), /exact SemVer/u);
  assert.doesNotThrow(() => assertPublishContext(env));
  for (const change of [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_REF: "refs/tags/v0.7.0" },
    { GITHUB_REPOSITORY: "another/repo" },
    { GITHUB_REPOSITORY: "../repo" },
    {
      GITHUB_WORKFLOW_REF: "dream-num/univer-workspace/.github/workflows/other.yml@refs/heads/main",
    },
    { ACTIONS_ID_TOKEN_REQUEST_TOKEN: "" },
  ])
    assert.throws(() => assertPublishContext({ ...env, ...change }), /manual dispatch/u);
});

test("dry-run validates only one package and retains bytes without public registry writes", async (t) => {
  for (const latest of [true, false]) {
    const f = await fixture(t, { latest });
    const record = await preparePromotion(f);
    assert.equal(record.integrity, f.hash);
    assert.equal(record.tag, latest ? "latest" : "promoted");
    assert.deepEqual(await readFile(join(f.directory, record.tarball)), f.bytes);
    assert.deepEqual(f.state.writes, []);
    assert.equal(record.plan.publicRegistryWriteVerified, false);
    assert.ok(f.calls.every(({ url }) => url.startsWith(INSIDER)));
    const request = f.calls[0];
    assert.deepEqual(JSON.parse(request.options.body), { packages: [{ name: PACKAGE, version }] });
    assert.equal(request.options.headers.authorization, "Bearer synthetic-insider");
    assert.ok(!JSON.stringify(record).includes("synthetic-insider"));
    assert.equal(f.calls.at(-1).options.headers, undefined);
  }
});

test("copies to another repository and scoped package without code changes", async (t) => {
  const context = {
    ...env,
    GITHUB_REPOSITORY: "other-org/other-repo",
    BASE_BRANCH: "trunk",
    GITHUB_REF: "refs/heads/trunk",
    GITHUB_WORKFLOW_REF:
      "other-org/other-repo/.github/workflows/promote-cli-public.yml@refs/heads/trunk",
  };
  const f = await prepared(t, { packageName: "@other-scope/tool", context, latest: true });
  f.state.exists = false;
  const result = await publishPromotion(f);
  assert.equal(result.package, "@other-scope/tool");
  assert.equal(result.latestVerified, true);
  assert.deepEqual(f.state.writes, ["publish:latest"]);
  assert.ok(f.calls.some(({ url }) => url === `${PUBLIC}%40other-scope%2Ftool/${version}`));
  await assert.rejects(publishPromotion({ ...f, env }), /this workflow run/u);
});

test("rejects malicious input before any registry request and binds latest intent", async (t) => {
  const f = await prepared(t);
  for (const change of [{ packageName: "../../bad" }, { version: "../x" }, { latest: undefined }]) {
    await assert.rejects(
      preparePromotion({ ...f, ...change, fetcher: () => assert.fail("no request") }),
    );
  }
  await assert.rejects(publishPromotion({ ...f, latest: true }), /this workflow run/u);
});

test("latest requires a stable version matching insider latest; non-latest can use a policy-approved prerelease", async (t) => {
  const f = await fixture(t, { latest: true });
  f.state.sourceLatest = "0.8.0";
  await assert.rejects(preparePromotion(f), /current insider latest/u);
  assert.ok(f.calls.every(({ url }) => !url.endsWith(".tgz")));
  const prerelease = await fixture(t, { selectedVersion: "1.2.3-rc.1", latest: true });
  await assert.rejects(preparePromotion(prerelease), /stable X.Y.Z/u);
  await preparePromotion({ ...prerelease, latest: false });
});

test("policy, dependency and auth rejection stops immediately without retry and deletes stale record", async (t) => {
  for (const status of [401, 403, 409, 500]) {
    const f = await fixture(t);
    await writeFile(join(f.directory, "promotion.json"), "stale");
    let calls = 0;
    await assert.rejects(
      preparePromotion({
        ...f,
        fetcher: async () => {
          calls += 1;
          return Response.json(
            { error: "REJECTED", message: "policy or public dependency rejected" },
            { status },
          );
        },
      }),
      new RegExp(`Insider Promotion dry-run: HTTP ${status}`, "u"),
    );
    assert.equal(calls, 1);
    await assert.rejects(readFile(join(f.directory, "promotion.json")), /ENOENT/u);
  }
});

test("rejects missing credentials, expanded plans, corrupt bytes, and wrong source manifests", async (t) => {
  const f = await fixture(t);
  await assert.rejects(preparePromotion({ ...f, env: {} }), /INSIDER_TOKEN/u);
  for (const change of [
    { status: "running" },
    { dryRun: false },
    { publicRegistryWriteVerified: true },
    { packageCount: 2 },
    { packages: [{ name: "other", version, publicVersion: "publish" }] },
    { packages: [{ name: PACKAGE, version: "0.8.0", publicVersion: "publish" }] },
  ])
    await assert.rejects(
      preparePromotion({ ...f, fetcher: async () => Response.json({ ...f.plan, ...change }) }),
      /exact completed single-package plan/u,
    );
  f.metadata.dist.integrity = "sha512-wrong";
  await assert.rejects(preparePromotion(f), /integrity mismatch/u);
  f.metadata.dist.tarball = `${PUBLIC}original.tgz`;
  await assert.rejects(preparePromotion(f), /still be hosted/u);
  for (const manifest of [{ name: "other" }, { version: "0.9.0" }, { private: true }]) {
    await assert.rejects(preparePromotion(await fixture(t, { manifest })), /tarball manifest/u);
  }
});

test("new versions and first publication use an explicit tag and read back latest intent", async (t) => {
  for (const latest of [true, false])
    for (const newPackage of [true, false]) {
      const f = await prepared(t, { latest });
      f.state.exists = false;
      if (newPackage) {
        f.state.packageExists = false;
        f.state.tags = {};
      }
      const result = await publishPromotion(f);
      assert.equal(result.action, "published");
      assert.equal(result.latestVerified, latest);
      assert.equal(result.publicRegistryWriteVerified, true);
      assert.deepEqual(f.state.writes, [`publish:${latest ? "latest" : "promoted"}`]);
      assert.equal(f.state.tags.latest, latest ? version : newPackage ? undefined : "0.6.0");
    }
});

test("existing identical version updates latest only when requested and needed", async (t) => {
  for (const latest of [true, false])
    for (const alreadyLatest of [true, false]) {
      const f = await prepared(t, { latest });
      f.state.tags.latest = alreadyLatest ? version : "0.6.0";
      const result = await publishPromotion(f);
      const shouldWrite = latest && !alreadyLatest;
      assert.equal(result.action, "reused");
      assert.equal(result.tagUpdated, shouldWrite);
      assert.equal(result.publicRegistryWriteVerified, shouldWrite);
      assert.deepEqual(f.state.writes, shouldWrite ? ["latest"] : []);
      assert.equal(f.state.tags.latest, latest || alreadyLatest ? version : "0.6.0");
    }
});

test("rejects context/run/version/hash/public conflicts before any write", async (t) => {
  const f = await prepared(t);
  for (const change of [
    { GITHUB_RUN_ID: "13" },
    { GITHUB_RUN_ATTEMPT: "2" },
    { GITHUB_SHA: "b".repeat(40) },
  ]) {
    await assert.rejects(
      publishPromotion({ ...f, env: { ...env, ...change } }),
      /this workflow run/u,
    );
  }
  await assert.rejects(publishPromotion({ ...f, version: "0.8.0" }), /exact completed/u);
  f.metadata.dist.integrity = "sha512-conflict";
  await assert.rejects(publishPromotion(f), /readback does not match/u);
  await writeFile(join(f.directory, "original.tgz"), "tampered");
  await assert.rejects(publishPromotion(f), /integrity mismatch/u);
  assert.deepEqual(f.state.writes, []);
});

test("wrong version/tag readback and tag write failures cannot report success", async (t) => {
  const f = await prepared(t, { latest: true });
  await assert.rejects(publishPromotion({ ...f, tagger: async () => {} }), /latest readback/u);
  let writes = 0;
  await assert.rejects(
    publishPromotion({
      ...f,
      tagger: async () => {
        writes += 1;
        throw new Error("tag denied");
      },
    }),
    /tag denied/u,
  );
  assert.equal(writes, 1);
  const changedIntegrity = await prepared(t, { latest: true });
  await assert.rejects(
    publishPromotion({
      ...changedIntegrity,
      tagger: async (...args) => {
        await changedIntegrity.tagger(...args);
        changedIntegrity.metadata.dist.integrity = "sha512-wrong-after-tag-write";
      },
    }),
    /exact-version\/integrity readback/u,
  );
  f.state.exists = false;
  await assert.rejects(
    publishPromotion({ ...f, publisher: async () => {} }),
    /exact-version\/integrity readback/u,
  );
  const noLatest = await prepared(t);
  noLatest.state.exists = false;
  await assert.rejects(
    publishPromotion({
      ...noLatest,
      publisher: async () => {
        noLatest.state.exists = true;
      },
    }),
    /promoted tag readback/u,
  );
  const changedLatest = await prepared(t);
  changedLatest.state.exists = false;
  await assert.rejects(
    publishPromotion({
      ...changedLatest,
      publisher: async (...args) => {
        await changedLatest.publisher(...args);
        changedLatest.state.tags.latest = version;
      },
    }),
    /latest readback/u,
  );
});

test("public read failures and uncertain upload failures stop without retry", async (t) => {
  const f = await prepared(t);
  await assert.rejects(
    publishPromotion({ ...f, fetcher: async () => new Response(null, { status: 403 }) }),
    /readback failed \(403\)/u,
  );
  f.state.exists = false;
  let calls = 0;
  await assert.rejects(
    publishPromotion({
      ...f,
      publisher: async () => {
        calls += 1;
        throw new Error("uncertain upload");
      },
    }),
    /uncertain upload/u,
  );
  assert.equal(calls, 1);
});

test("public npm upload and dist-tag subprocesses keep OIDC without token/config credentials", async (t) => {
  const f = await fixture(t);
  const bin = join(f.directory, "bin");
  await mkdir(bin);
  await writeFile(
    join(bin, "npm"),
    `#!${process.execPath}\nconsole.log(JSON.stringify({env:process.env,args:process.argv.slice(2),cwd:process.cwd()}));\n`,
  );
  await chmod(join(bin, "npm"), 0o755);
  const context = {
    ...env,
    PATH: bin,
    NPM_TOKEN: "synthetic-secret",
    NODE_AUTH_TOKEN: "synthetic-secret",
    NPM_CONFIG_REGISTRY: INSIDER,
    NPM_CONFIG_USERCONFIG: "/private/npmrc",
  };
  for (const [result, args] of [
    [
      await publishTarball(f.tarball, context, "promoted"),
      npmPublishArguments(f.tarball, "promoted"),
    ],
    [await setLatest(PACKAGE, version, context), npmTagArguments(PACKAGE, version)],
  ]) {
    const observed = JSON.parse(result.stdout);
    for (const key of [
      "INSIDER_TOKEN",
      "NPM_TOKEN",
      "NODE_AUTH_TOKEN",
      "NPM_CONFIG_REGISTRY",
      "NPM_CONFIG_USERCONFIG",
    ])
      assert.equal(observed.env[key], undefined);
    assert.equal(observed.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
    assert.deepEqual(observed.args, args);
    assert.notEqual(observed.cwd, process.cwd());
  }
});

test("real npm uploads unchanged tarball to loopback, overriding insider registry and manifest latest tag", async (t) => {
  const f = await fixture(t, { packageName: "@loopback/tool" });
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
    if (request.method === "GET" && request.url.endsWith("/dist-tags")) {
      reply.end(JSON.stringify({ latest: "0.6.0" }));
    } else if (request.method === "PUT") reply.end(JSON.stringify({ ok: true }));
    else {
      reply.statusCode = 404;
      reply.end(JSON.stringify({ error: "not_found" }));
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  const port = server.address().port;
  const registry = `http://127.0.0.1:${port}/`;
  for (const tag of ["promoted", "latest"]) {
    await execute(
      "npm",
      [
        ...npmPublishArguments(f.tarball, tag, registry),
        `--//127.0.0.1:${port}/:_authToken=synthetic-loopback-only`,
      ],
      {
        cwd: f.directory,
        timeout: 60_000,
        env: {
          PATH: process.env.PATH,
          HOME: f.directory,
          NPM_CONFIG_CACHE: join(f.directory, "cache"),
          NPM_CONFIG_GLOBALCONFIG: join(f.directory, "empty-global.npmrc"),
        },
      },
    );
    const document = JSON.parse(requests.filter(({ method }) => method === "PUT").at(-1).body);
    assert.deepEqual(document["dist-tags"], { [tag]: version });
    assert.deepEqual(Buffer.from(Object.values(document._attachments)[0].data, "base64"), f.bytes);
    assert.equal(document.versions[version].dist.integrity, f.hash);
    assert.equal(document.versions[version].publishConfig.registry, INSIDER);
  }
  await execute(
    "npm",
    [
      ...npmTagArguments(f.packageName, version, registry),
      `--//127.0.0.1:${port}/:_authToken=synthetic-loopback-only`,
    ],
    {
      cwd: f.directory,
      timeout: 60_000,
      env: {
        PATH: process.env.PATH,
        HOME: f.directory,
        NPM_CONFIG_CACHE: join(f.directory, "cache"),
        NPM_CONFIG_GLOBALCONFIG: join(f.directory, "empty-global.npmrc"),
      },
    },
  );
  const tagWrite = requests.find(
    ({ method, url }) => method === "PUT" && url.endsWith("/dist-tags/latest"),
  );
  assert.equal(JSON.parse(tagWrite.body), version);
  assert.match(decodeURIComponent(tagWrite.url), /@loopback\/tool/u);
  assert.deepEqual(await readFile(f.tarball), f.bytes);
});

test("credentialed workflow stays manual/default-branch only with configurable package and pinned npm", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/promote-cli-public.yml", import.meta.url),
    "utf8",
  );
  const gate = workflow.split("  promote:\n")[1].split("    runs-on:")[0];
  assert.match(gate, /github.event_name == 'workflow_dispatch'/u);
  assert.match(
    gate,
    /github.ref == format\('refs\/heads\/\{0\}', github.event.repository.default_branch\)/u,
  );
  assert.doesNotMatch(gate, /github.repository ==|\|\|/u);
  assert.doesNotMatch(workflow, /pull_request:|  test:|needs: test|inputs.publish/u);
  assert.match(workflow, /package:[\s\S]*type: choice[\s\S]*options:/u);
  assert.match(workflow.split("      latest:\n")[1].split("      version:")[0], /default: true/u);
  assert.match(workflow, /dry_run:[\s\S]*default: true/u);
  assert.match(workflow, /if: \$\{\{ !inputs.dry_run \}\}/u);
  assert.match(workflow, /npm@11\.21\.0/u);
  const tests = await readFile(
    new URL("../../.github/workflows/test-cli-promotion.yml", import.meta.url),
    "utf8",
  );
  assert.match(tests, /npm@11\.21\.0/u);
  assert.doesNotMatch(tests, /secrets\.|id-token: write|--publish/u);
});

test("real insider protocol selects versions from one packument and follows trusted OSS without credentials", async (t) => {
  for (const packageName of [PACKAGE, "@scope/tool"]) {
    const f = await fixture(t, { packageName, latest: true });
    const oss = "https://insider-npm.oss-cn-shenzhen.aliyuncs.com/insider-npm-registry/v1/packages/example/versions/0.7.0/package.tgz";
    const calls = [];
    const record = await preparePromotion({ ...f, fetcher: async (url, options) => {
      calls.push({url:String(url), options});
      if (String(url) === f.metadata.dist.tarball) return new Response(null,{status:302,headers:{location:oss}});
      if (String(url) === oss) return new Response(f.bytes);
      return f.fetcher(url, options);
    }});
    assert.equal(record.integrity, f.hash);
    assert.equal(calls.filter(c=>c.url===`${INSIDER}${encodeURIComponent(packageName)}`).length,1);
    assert.ok(!calls.some(c=>c.url===`${INSIDER}${encodeURIComponent(packageName)}/${version}`));
    for (const call of calls.filter(c=>c.url===oss||c.url===f.metadata.dist.tarball)) {
      assert.equal(call.options.headers,undefined);
      assert.equal(call.options.method,"GET");
      assert.equal(call.options.redirect,"manual");
      assert.ok(!JSON.stringify(call).includes(env.INSIDER_TOKEN));
    }
  }
});

test("tarball rejects untrusted, downgrade, userinfo, query, wrong storage path and loop redirects before following", async () => {
  for (const target of ["https://evil.invalid/a", "http://insider-npm-registry.univer.work/a", "https://user:secret@insider-npm-registry.univer.work/a", `${INSIDER}a?token=secret`, "https://insider-npm.oss-cn-shenzhen.aliyuncs.com/other/key", `${INSIDER}artifact.tgz`]) {
    let calls=0;
    await assert.rejects(downloadInsiderTarball(`${INSIDER}artifact.tgz`,async()=>{calls++;return new Response(null,{status:302,headers:{location:target}})}),/untrusted|loop/u);
    assert.equal(calls,1);
  }
});

test("tarball redirect limit and missing location stop without credentialed retries", async () => {
  let calls=0;
  await assert.rejects(downloadInsiderTarball(`${INSIDER}artifact.tgz`,async()=>new Response(null,{status:302,headers:{location:`${INSIDER}next-${++calls}`}})),/redirect limit/u);
  assert.equal(calls,4);
  await assert.rejects(downloadInsiderTarball(`${INSIDER}artifact.tgz`,async()=>new Response(null,{status:302})),/missing location/u);
});

test("packument redirects, missing version, and corrupted redirected tarball cannot produce a plan", async(t)=>{
  const f=await fixture(t);const packument=`${INSIDER}${PACKAGE}`;
  await assert.rejects(preparePromotion({...f,fetcher:async(url,opts)=>String(url)===packument?new Response(null,{status:302,headers:{location:PUBLIC}}):f.fetcher(url,opts)}),/Insider packument: HTTP 302/u);
  await assert.rejects(preparePromotion({...f,fetcher:async(url,opts)=>String(url)===packument?Response.json({name:PACKAGE,versions:{}}):f.fetcher(url,opts)}),/metadata does not match/u);
  const oss="https://insider-npm.oss-cn-shenzhen.aliyuncs.com/insider-npm-registry/v1/packages/a";
  await assert.rejects(preparePromotion({...f,fetcher:async(url,opts)=>String(url)===f.metadata.dist.tarball?new Response(null,{status:302,headers:{location:oss}}):String(url)===oss?new Response("corrupt"):f.fetcher(url,opts)}),/integrity mismatch/u);
  await assert.rejects(readFile(join(f.directory,"promotion.json")),/ENOENT/u);
});

test("safe transport diagnostics identify stage and code without echoing tokens, URLs or bodies", async(t)=>{
  const f=await fixture(t);
  for (const [cause,pattern] of [[{message:"unexpected redirect"},/unexpected redirect/u],[{code:"ENOTFOUND",message:env.INSIDER_TOKEN},/ENOTFOUND/u],[{message:`secret ${env.INSIDER_TOKEN}`},/fetch failed/u]]) {
    await assert.rejects(preparePromotion({...f,fetcher:async()=>{throw new TypeError(`secret ${env.INSIDER_TOKEN}`,{cause})}}),e=>{assert.match(e.message,/Insider Promotion dry-run/u);assert.match(e.message,pattern);assert.ok(!e.message.includes(env.INSIDER_TOKEN));return true});
  }
  await assert.rejects(preparePromotion({...f,fetcher:async()=>new Response(env.INSIDER_TOKEN,{status:403})}),e=>!e.message.includes(env.INSIDER_TOKEN)&&e.message.includes("HTTP 403"));
});
