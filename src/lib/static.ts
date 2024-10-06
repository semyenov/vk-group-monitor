import { defineEventHandler, serveStatic } from "h3";
import { readFile, stat } from "node:fs/promises";
import { join } from "pathe";

export const createServeStaticHandler = (publicDir: string) =>
  defineEventHandler(async (event) => {
    await serveStatic(event, {
      fallthrough: true,
      indexNames: ["index.html"],
      getContents: (id) => readFile(join(publicDir, id)),
      getMeta: async (id) => {
        const stats = await stat(join(publicDir, id));
        if (!stats || !stats.isFile()) {
          return;
        }
        return {
          size: stats.size,
          mtime: stats.mtimeMs,
        };
      },
    });
  });
