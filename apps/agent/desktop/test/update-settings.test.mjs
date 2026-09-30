import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import settings from "../src/update-settings.cjs";

test("missing or corrupt settings fall back to the default preference", async () => {
  const dir = await mkdtemp(join(tmpdir(), "uwa-update-settings-"));
  try {
    assert.deepEqual(settings.loadSettingsSync(join(dir, "absent.json")), { acceptPrerelease: true });
    const corrupt = join(dir, "corrupt.json");
    await writeFile(corrupt, "{ not json");
    assert.deepEqual(settings.loadSettingsSync(corrupt), { acceptPrerelease: true });
    await writeFile(corrupt, '"a string"');
    assert.deepEqual(settings.loadSettingsSync(corrupt), { acceptPrerelease: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("saving persists the preference and drops unknown keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "uwa-update-settings-"));
  try {
    const file = join(dir, "nested", "update-settings.json");
    await settings.saveSettings(file, { acceptPrerelease: false, extra: "dropped" });
    assert.deepEqual(settings.loadSettingsSync(file), { acceptPrerelease: false });
    await settings.saveSettings(file, { acceptPrerelease: "yes" });
    assert.deepEqual(settings.loadSettingsSync(file), { acceptPrerelease: true });
    assert.deepEqual(settings.sanitize(null), { acceptPrerelease: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
