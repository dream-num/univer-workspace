const { signAsync } = require("@electron/osx-sign");
const { join } = require("node:path");
const { writeInventory } = require("./inventory.cjs");

// Code signing changes Mach-O bytes, including the bundled Node and native
// modules. Inventory the signed resources, then seal only the outer app again
// so the inventory belongs to its signature without re-signing runtime files.
exports.sign = async function sign(options) {
  if (
    process.env.AGENT_DESKTOP_OFFICIAL === "true" &&
    (!options.identity || options.identity === "-")
  )
    throw new Error("Official macOS builds require a signing identity");
  options = { ...options, identity: options.identity || "-" };
  await signAsync(options);
  await writeInventory(join(options.app, "Contents", "Resources", "runtime"));
  await signAsync({
    ...options,
    binaries: [],
    preAutoEntitlements: false,
    ignore: (path) => path !== options.app,
  });
};
