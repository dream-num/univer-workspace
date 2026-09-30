const { mkdir, readFile, rename, writeFile } = require("node:fs/promises");
const { dirname } = require("node:path");

// The one persisted update preference. Everything else about update behavior
// is code; only this option is a user choice, so it lives in its own file and
// falls back to the default when missing or unreadable.
const DEFAULTS = { acceptPrerelease: true };

function sanitize(value) {
  if (typeof value !== "object" || value === null) return { ...DEFAULTS };
  return { acceptPrerelease: value.acceptPrerelease !== false };
}

function loadSettingsSync(file) {
  try {
    return sanitize(JSON.parse(require("node:fs").readFileSync(file, "utf8")));
  } catch {
    return { ...DEFAULTS };
  }
}

async function saveSettings(file, value) {
  const clean = sanitize(value);
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(clean, null, 2)}\n`, "utf8");
  await rename(temp, file);
  return clean;
}

module.exports = { DEFAULTS, sanitize, loadSettingsSync, saveSettings };
