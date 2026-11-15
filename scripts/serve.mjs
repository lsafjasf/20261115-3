import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.cwd());
const port = Number(process.env.PORT ?? 4173);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const handler = async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
    const requested = pathname === "/" ? "/index.html" : pathname;
    const filepath = normalize(join(root, requested));
    if (!filepath.startsWith(`${root}/`) && filepath !== root) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    const info = await stat(filepath);
    if (!info.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Content-Type": mime[extname(filepath)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(filepath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
};

function start(candidate, attempts = 0) {
  const server = createServer(handler);
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && !process.env.PORT && attempts < 20) {
      start(candidate + 1, attempts + 1);
      return;
    }
    console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(candidate, "0.0.0.0", () => {
    console.log(`SIGNAL Poster Studio running at http://localhost:${candidate}`);
  });
}

start(port);
