import { resolve } from "node:path";
import express, { type Router } from "express";
import { notFoundHandler } from "./errors.js";

export function createStaticSiteRouter(publicDirectory: string): Router {
  const router = express.Router();

  // Vite emits content-hashed filenames under assets/, so a URL there never
  // changes content. A missing hash is a stale client asking for a previous
  // deploy's chunk; it gets a 404 instead of the SPA's index.html.
  router.use(
    "/assets",
    express.static(resolve(publicDirectory, "assets"), {
      maxAge: "1y",
      immutable: true,
    }),
    notFoundHandler,
  );
  router.use(
    express.static(publicDirectory, {
      setHeaders: (response, path) => {
        if (path.endsWith(".html")) response.setHeader("Cache-Control", "no-cache");
      },
    }),
  );
  router.get("/{*path}", (_request, response) => {
    response.setHeader("Cache-Control", "no-cache");
    response.sendFile(resolve(publicDirectory, "index.html"));
  });

  return router;
}
