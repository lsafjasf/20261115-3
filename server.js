import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const handler = async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const pathname = decodeURIComponent(url.pathname);
    const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const safePath = normalize(requested).replace(/^(\.\.)([/\\])+/, "");
    const absolute = resolve(join(root, safePath));
    if (!absolute.startsWith(resolve(root))) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    const info = await stat(absolute);
    if (!info.isFile()) throw new Error("Not a file");
    const body = await readFile(absolute);
    response.writeHead(200, {
      "Content-Type": mime[extname(absolute)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
};

const server = createServer(handler);
let activePort = port;
let retries = 0;

server.on("listening", () => {
  console.log(`Hump yard ready at http://127.0.0.1:${activePort}`);
});
server.on("error", (error) => {
  if (error.code === "EADDRINUSE" && retries < 20) {
    retries += 1;
    activePort += 1;
    server.listen(activePort, "127.0.0.1");
    return;
  }
  throw error;
});

server.listen(activePort, "127.0.0.1");
