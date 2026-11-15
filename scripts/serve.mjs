import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const port = Number(process.env.PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = normalize(join(root, relative));
    if (!file.startsWith(root)) throw new Error("Invalid path");
    const info = await stat(file);
    if (!info.isFile()) throw new Error("Not a file");
    res.writeHead(200, {
      "Content-Type": types[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

let candidate = port;
let attempts = 0;

function listen() {
  const cleanup = () => {
    server.off("error", onError);
    server.off("listening", onListening);
  };
  const onError = (error) => {
    cleanup();
    if (error.code === "EADDRINUSE" && attempts < 20) {
      attempts += 1;
      candidate += 1;
      listen();
      return;
    }
    throw error;
  };
  const onListening = () => {
    cleanup();
    console.log(`Corridor Four running at http://localhost:${candidate}`);
  };
  server.once("error", onError);
  server.once("listening", onListening);
  server.listen(candidate);
}

listen();
