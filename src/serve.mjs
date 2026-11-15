// 极简静态服务器：为浏览器工作台提供正确的 ES module MIME。
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT) || 5173;
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/") path = "/web/index.html";
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    return res.end("forbidden");
  }
  try {
    let target = file;
    if ((await stat(target)).isDirectory()) target = join(target, "index.html");
    const body = await readFile(target);
    res.writeHead(200, { "content-type": mime[extname(target)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`端口 ${port} 被占用，请用 PORT=xxxx npm run serve 指定其他端口。`);
    process.exit(1);
  }
  throw err;
});
server.listen(port, () => {
  console.log(`工作台运行于 http://localhost:${port}/web/`);
});
