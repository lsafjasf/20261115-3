'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const web = path.join(root, 'web');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wav': 'audio/wav',
  '.json': 'application/json',
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let file;
  if (urlPath.startsWith('/output/')) {
    file = path.join(root, urlPath.replace(/^\/+/, ''));
  } else {
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    file = path.join(web, rel);
  }
  if (!file.startsWith(web) && !file.startsWith(path.join(root, 'output'))) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(Number(process.env.PORT) || 8791, () => {
  console.log('align-audio UI: http://localhost:' + (process.env.PORT || 8791));
});
