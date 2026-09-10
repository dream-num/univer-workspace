import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import updates from "../src/updates.cjs";

function fixture({
  version = "0.1.0-alpha.1",
  next = "0.1.0-alpha.2",
  accept = true,
  enabled = true,
  failDownload = false,
  metadata = next,
} = {}) {
  const events = [];
  const updater = Object.assign(new EventEmitter(), {
    setFeedURL(feed) {
      events.push(["feed", feed]);
    },
    async checkForUpdates() {
      return { isUpdateAvailable: true, updateInfo: { version: metadata } };
    },
    async downloadUpdate() {
      events.push("download");
      if (failDownload) throw new Error("offline");
    },
    quitAndInstall(...args) {
      events.push(["install", args]);
    },
  });
  const check = updates.createUpdateChecker({
    app: { isPackaged: true, getVersion: () => version },
    autoUpdater: updater,
    window: {},
    updatesEnabled: enabled,
    net: {
      async fetch(url) {
        events.push(["fetch", url]);
        return {
          ok: true,
          json: async () => [
            { tag_name: "v99.0.0" },
            { tag_name: `agent-v${next}`, prerelease: next.includes("-") },
          ],
        };
      },
    },
    dialog: {
      async showMessageBox(_window, options) {
        events.push(["dialog", options]);
        return { response: accept ? 0 : 1 };
      },
    },
    async beforeInstall() {
      events.push("stop backend");
    },
  });
  return { check, events, updater };
}
test("alpha update uses alpha metadata and installs only after consent, download and shutdown", async () => {
  const { check, events, updater } = fixture();
  await check(false);
  assert.equal(events.find((e) => e[0] === "feed")[1].channel, "alpha");
  assert.deepEqual(events.slice(-3), ["download", "stop backend", ["install", [false, true]]]);
  assert.equal(updater.allowPrerelease, true);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.listenerCount("error"), 0);
});
test("alpha graduates using stable metadata; stable ignores alpha", async () => {
  const stable = fixture({ next: "0.1.0" });
  await stable.check(false);
  assert.equal(stable.events.find((e) => e[0] === "feed")[1].channel, "latest");
  const alpha = fixture({ version: "0.1.0", next: "0.2.0-alpha.1" });
  await alpha.check(false);
  assert.equal(
    alpha.events.some((e) => e[0] === "feed"),
    false,
  );
});
test("Later never downloads; build-only installers never query releases", async () => {
  const later = fixture({ accept: false });
  await later.check(false);
  assert.equal(later.events.includes("download"), false);
  const preview = fixture({ enabled: false });
  await preview.check(true);
  assert.equal(
    preview.events.some((e) => e[0] === "fetch"),
    false,
  );
});
test("accepted background download failures show an error and allow retry without shutdown", async () => {
  const { check, events } = fixture({ failDownload: true });
  await check(false);
  await check(false);
  assert.equal(events.filter((e) => e === "download").length, 2);
  assert.equal(events.includes("stop backend"), false);
  assert.equal(events.filter((e) => e[0] === "dialog" && e[1].type === "error").length, 2);
});
test("mismatched release metadata cannot be downloaded", async () => {
  const { check, events } = fixture({ metadata: "99.0.0" });
  await check(true);
  assert.equal(events.includes("download"), false);
  assert.equal(events.at(-1)[1].type, "error");
});

test("each promotion requests the destination metadata channel and completes installation", async () => {
  for (const [version, next, channel] of [
    ["0.1.0-alpha.1", "0.1.0-beta.1", "beta"],
    ["0.1.0-beta.1", "0.1.0-rc.1", "rc"],
    ["0.1.0-rc.1", "0.1.0", "latest"],
    ["0.1.0-beta.1", "0.1.0-beta.2", "beta"],
    ["0.1.0-rc.1", "0.1.0-rc.2", "rc"],
  ]) {
    const { check, events, updater } = fixture({ version, next });
    await check(false);
    assert.equal(events.find((e) => e[0] === "feed")[1].channel, channel);
    assert.equal(updater.allowPrerelease, true);
    assert.equal(events.at(-1)[0], "install");
  }
});
