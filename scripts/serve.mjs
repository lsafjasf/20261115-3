import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function handler(req, res) {
  const requestPath = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
  const file = normalize(join(root, requestPath));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  try {
    const data = readFileSync(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'text/plain; charset=utf-8' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}

const port = Number(process.env.PORT) || 8080;
createServer(handler).listen(port, () => {
  console.log(`救援调度游戏已启动: http://localhost:${port}`);
});
