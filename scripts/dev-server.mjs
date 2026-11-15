import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(scriptDirectory, "..");
const port = Number.parseInt(process.env.PORT ?? "4173", 10);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
};

function resolveRequestPath(requestUrl) {
  const parsedUrl = new URL(requestUrl, "http://localhost");
  const pathname =
    parsedUrl.pathname === "/"
      ? "/index.html"
      : decodeURIComponent(parsedUrl.pathname);
  const absolutePath = resolve(rootDirectory, `.${pathname}`);
  if (
    absolutePath !== rootDirectory &&
    !absolutePath.startsWith(`${rootDirectory}${sep}`)
  ) {
    return null;
  }
  return absolutePath;
}

const server = createServer(async (request, response) => {
  const absolutePath = resolveRequestPath(request.url ?? "/");
  if (absolutePath === null) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      throw new Error("Not a file");
    }
    const body = await readFile(absolutePath);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type":
        contentTypes[extname(absolutePath)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`SafeBoard importer running at http://127.0.0.1:${port}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${port} is already in use. Try: PORT=4180 npm start`
    );
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
});
