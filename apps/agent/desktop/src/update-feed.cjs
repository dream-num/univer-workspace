const { createServer } = require("node:http");
const { createReadStream } = require("node:fs");
const { randomBytes } = require("node:crypto");

// Public generic-provider handoff: the verified download is served only on
// loopback with an unguessable path. electron-updater still owns checksum,
// platform signature validation, staging and installation. JSON is valid YAML.
// electron-updater 6.8.9 discards incomplete downloads and has no public API to
// adopt a file. Remove this handoff when its public API supports persistent
// resume or verified local-file staging on all three desktop platforms.
async function serveUpdate({ path, file, version, channel, platform = process.platform }) {
  const token = randomBytes(32).toString("hex");
  const suffix = platform === "darwin" ? "-mac" : platform === "linux" ? "-linux" : "";
  const metadataPath = `/${token}/${channel}${suffix}.yml`;
  const filename = new URL(file.url).pathname.split("/").at(-1);
  const assetPath = `/${token}/${filename}`;
  const metadata = JSON.stringify({ version, files: [{ url: filename, sha512: file.sha512, size: file.size }],
    path: filename, sha512: file.sha512 });
  const server = createServer((request, response) => {
    let pathname;
    try { pathname = new URL(request.url, "http://127.0.0.1").pathname; }
    catch { response.writeHead(400).end(); return; }
    if (request.headers.host !== `127.0.0.1:${server.address()?.port}` ||
        !["GET", "HEAD"].includes(request.method) ||
        (pathname !== metadataPath && pathname !== assetPath)) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("Cache-Control", "no-store");
    if (pathname === metadataPath) {
      response.setHeader("Content-Type", "application/yaml");
      response.end(request.method === "HEAD" ? undefined : metadata);
      return;
    }
    response.setHeader("Content-Length", file.size);
    response.setHeader("Content-Type", "application/octet-stream");
    if (request.method === "HEAD") { response.end(); return; }
    const stream = createReadStream(path);
    stream.on("error", () => response.destroy());
    response.on("close", () => stream.destroy());
    stream.pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return { url: `http://127.0.0.1:${server.address().port}/${token}/`,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}

module.exports = { serveUpdate };
