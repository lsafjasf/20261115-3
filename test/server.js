import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = join(new URL('..', import.meta.url).pathname);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

export function startServer(port = 0) {
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = normalize(pathname === '/' ? 'index.html' : pathname.slice(1));
    if (relative.startsWith('..')) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    try {
      const data = await readFile(join(ROOT, relative));
      res.writeHead(200, { 'content-type': MIME[extname(relative)] ?? 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      server.addressPort = server.address().port;
      resolve(server);
    });
  });
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('server.js');
if (invokedDirectly) {
  const server = await startServer(Number(process.env.PORT) || 4173);
  console.log(`Editor running at http://127.0.0.1:${server.addressPort}/index.html`);
}
