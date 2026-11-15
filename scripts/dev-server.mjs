import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const server = http.createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const absolute = path.resolve(ROOT, relative);
    if (!absolute.startsWith(ROOT) || !fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES[path.extname(absolute)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(fs.readFileSync(absolute));
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(error.message);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`SAVE//VAULT running at http://127.0.0.1:${PORT}`);
});
