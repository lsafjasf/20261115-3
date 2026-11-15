import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = normalize(join(import.meta.dirname, ".."));
const port = Number(process.env.PORT) || 8080;

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = createServer(async (request, response) => {
  const pathname = request.url === "/" ? "/public/index.html" : request.url;
  const filePath = normalize(join(root, pathname));
  if (!filePath.startsWith(root)) {
    response.writeHead(403).end("forbidden");
    return;
  }
  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mime[extname(filePath)] ?? "application/octet-stream",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`port ${port} is in use, retry with PORT=<free-port>`);
    process.exit(1);
  }
  throw error;
});

server.listen(port, "127.0.0.1", () => {
  console.log(`node editor served at http://127.0.0.1:${port}`);
});
