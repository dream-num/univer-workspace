import { relative, resolve, sep } from "node:path";
import express, { type Router } from "express";

// Vite emits content-hashed filenames under assets/, so a URL there never
// changes content. Everything else, index.html first, must be revalidated so a
// deploy is picked up and references the new hashes.
const immutableCacheControl = "public, max-age=31536000, immutable";
const revalidateCacheControl = "no-cache";

export function createStaticSiteRouter(publicDirectory: string): Router {
  const assetsDirectory = resolve(publicDirectory, "assets");
  const indexFile = resolve(publicDirectory, "index.html");
  const router = express.Router();

  router.use(
    express.static(publicDirectory, {
      cacheControl: false,
      setHeaders: (response, filePath) => {
        response.setHeader(
          "Cache-Control",
          isWithin(assetsDirectory, filePath)
            ? immutableCacheControl
            : revalidateCacheControl
        );
      },
    })
  );
  router.get("/{*path}", (_request, response) => {
    response.sendFile(indexFile, {
      cacheControl: false,
      headers: { "Cache-Control": revalidateCacheControl },
    });
  });

  return router;
}

function isWithin(directory: string, filePath: string): boolean {
  const path = relative(directory, filePath);
  return path !== "" && !path.startsWith(`..${sep}`) && path !== "..";
}
