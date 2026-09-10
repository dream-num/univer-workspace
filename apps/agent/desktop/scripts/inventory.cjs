const { readdir, readFile, writeFile, realpath, readlink } = require("node:fs/promises");
const { join, relative, resolve, sep, isAbsolute } = require("node:path");
const { createHash } = require("node:crypto");
async function writeInventory(root) {
  const inventory = {};
  async function visit(path) {
    for (const item of await readdir(path, { withFileTypes: true })) {
      const child = join(path, item.name);
      if (child === join(root, "integrity.json")) continue;
      if (item.isDirectory()) await visit(child);
      else if (item.isFile())
        inventory[relative(root, child).split(sep).join("/")] = createHash("sha256")
          .update(await readFile(child))
          .digest("hex");
      else if (item.isSymbolicLink()) {
        if (
          isAbsolute(await readlink(child)) ||
          !(await realpath(child)).startsWith(resolve(root) + sep)
        )
          throw new Error(`Runtime symlink escapes bundle: ${relative(root, child)}`);
      } else throw new Error(`Unsupported runtime entry: ${relative(root, child)}`);
    }
  }
  await visit(root);
  await writeFile(join(root, "integrity.json"), JSON.stringify(inventory));
}
module.exports = { writeInventory };
