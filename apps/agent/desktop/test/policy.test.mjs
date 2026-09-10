import assert from "node:assert/strict";
import test from "node:test";
import policy from "../src/policy.cjs";
const origin = policy.localOrigin();
test("only accepts readiness from the owned loopback origin", () => {
  for (const url of [
    "https://example.com/?token=x",
    "http://127.0.0.1:3102/?token=x",
    "http://user@127.0.0.1:3101/?token=x",
    `${origin}/`,
    `${origin}/?token=`,
    `${origin}/other?token=x`,
  ]) {
    assert.equal(policy.readyUrl({ type: "uwh-desktop-ready", url }, origin), null);
  }
  assert.equal(policy.readyUrl({ type: "other", url: `${origin}/?token=x` }, origin), null);
  assert.equal(
    policy.readyUrl({ type: "uwh-desktop-ready", url: `${origin}/?token=x` }, origin),
    `${origin}/?token=x`,
  );
});
test("selects stable Agent releases independently of CLI versions and API order", () => {
  const releases = [
    { tag_name: "v99.0.0" },
    { tag_name: "agent-v1.2.0" },
    { tag_name: "agent-v2.0.0", draft: true },
    { tag_name: "agent-v9.0.0-rc.1" },
    { tag_name: "agent-v1.1.0" },
  ];
  const selected = policy.selectRelease(releases, "1.0.0");
  assert.equal(selected.tag_name, "agent-v1.2.0");
  assert.equal(policy.selectRelease(releases, "1.2.0"), undefined);
  assert.equal(
    policy.releaseFeed(selected),
    "https://github.com/dream-num/univer-workspace/releases/download/agent-v1.2.0/",
  );
  assert.throws(() => policy.releaseFeed({ tag_name: "v1.2.0" }));
  assert.throws(() => policy.releaseFeed({ tag_name: "agent-v1.2.0/../../latest" }));
});

test("alpha updates stay ordered and graduate to stable without enrolling stable users", () => {
  const releases = [
    { tag_name: "agent-v0.1.0-alpha.2", prerelease: true },
    { tag_name: "agent-v0.1.0-alpha.10", prerelease: true },
    { tag_name: "agent-v0.2.0-alpha.1", prerelease: false },
    { tag_name: "agent-v0.2.0", prerelease: true },
    { tag_name: "agent-v0.3.0-alpha.1", prerelease: true, draft: true },
  ];
  assert.equal(policy.selectRelease(releases, "0.1.0-alpha.1").tag_name, "agent-v0.1.0-alpha.10");
  assert.equal(policy.selectRelease(releases, "0.1.0"), undefined);
  releases.push({ tag_name: "agent-v0.1.0" });
  assert.equal(policy.selectRelease(releases, "0.1.0-alpha.10").tag_name, "agent-v0.1.0");
  assert.equal(policy.releaseChannel("0.1.0-alpha.1"), "alpha");
  assert.equal(policy.releaseChannel("0.1.0"), "latest");
  assert.equal(
    policy.releaseFeed(releases[0]),
    "https://github.com/dream-num/univer-workspace/releases/download/agent-v0.1.0-alpha.2/",
  );
  for (const version of [
    "v1.0.0",
    "1.0.0-alpha.01",
    "1.0.0-preview.1",
    "1.0.0+build",
    "1.0.0/evil",
  ]) {
    assert.equal(policy.validVersion(version), false);
  }
});

test("all release stages accept only forward versions and same-or-later stages", () => {
  const stages = ["alpha", "beta", "rc", "latest"];
  const version = (base, stage) => base + (stage === "latest" ? "" : "-" + stage + ".1");
  for (const [fromIndex, from] of stages.entries()) {
    for (const [toIndex, to] of stages.entries()) {
      const current = version("1.0.0", from);
      const next = version("2.0.0", to);
      const release = { tag_name: "agent-v" + next, prerelease: to !== "latest" };
      assert.equal(policy.releaseChannel(next), to);
      assert.equal(
        Boolean(policy.selectRelease([release], current)),
        toIndex >= fromIndex,
        from + " -> " + to,
      );
      assert.equal(
        policy.selectRelease([{ ...release, tag_name: "agent-v" + version("0.9.0", to) }], current),
        undefined,
      );
    }
  }
  const chain = stages.map((stage) => ({
    tag_name: "agent-v" + version("1.0.0", stage),
    prerelease: stage !== "latest",
  }));
  for (let i = 0; i < chain.length - 1; i++) {
    assert.equal(policy.selectRelease([chain[i + 1]], version("1.0.0", stages[i])), chain[i + 1]);
  }
});
