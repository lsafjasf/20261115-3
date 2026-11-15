/* Tiny zero-dependency static server for local browser testing. */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('node:url');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

http
  .createServer((request, response) => {
    const pathname = parse(request.url).pathname;
    const file = path.join(
      process.cwd(),
      pathname === '/' ? 'index.html' : pathname
    );
    if (!file.startsWith(process.cwd() + path.sep)) {
      response.writeHead(403);
      response.end('forbidden');
      return;
    }
    fs.readFile(file, (error, data) => {
      if (error) {
        response.writeHead(404);
        response.end('not found');
        return;
      }
      response.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      });
      response.end(data);
    });
  })
  .listen(8080, () => console.log('serving http://localhost:8080'));
