// Zero-dependency static file server for local use:
//   node server.js  ->  http://localhost:8080
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const requestedPort = Number(process.env.PORT) || 8080;
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wav": "audio/wav",
  ".svg": "image/svg+xml",
};

const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, `http://localhost`).pathname);
  const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const file = join(root, safePath === "/" ? "index.html" : safePath);
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 Not Found");
  }
});

function listen(port) {
  server.once("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.log(`端口 ${port} 被占用，改用 ${port + 1}`);
      listen(port + 1);
    } else throw err;
  });
  server.listen(port, () => {
    console.log(`空间音频编辑器运行于 http://localhost:${server.address().port}`);
  });
}

listen(requestedPort);
