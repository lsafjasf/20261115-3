import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL("../", import.meta.url);
const port = Number(process.env.PORT || 4173);
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const relative = normalize(decodeURIComponent(pathname)).replace(/^\/+/, "");
    const target = new URL(relative || "index.html", root);
    const info = await stat(target);

    if (!info.isFile()) {
      throw new Error("Not a file");
    }

    response.writeHead(200, {
      "Content-Type": types[extname(target.pathname)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(await readFile(target));
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Orbital Array running at http://127.0.0.1:${port}`);
});
