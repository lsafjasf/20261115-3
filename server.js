import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8"
};

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = normalize(join(root, pathname));

  if (!file.startsWith(root)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const body = await readFile(file);
    response.writeHead(200, {
      "Content-Type": types[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
}

function listen(candidate) {
  const server = createServer(handleRequest);
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && candidate < 4200) {
      const next = candidate + 1;
      console.warn(`Port ${candidate} busy, trying ${next}`);
      listen(next);
      return;
    }
    throw error;
  });
  server.listen(candidate, () => {
    console.log(`AISLE//ZERO running at http://localhost:${candidate}`);
  });
}

listen(port);
