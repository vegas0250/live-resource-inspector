import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const port = 4173;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.mpd': 'application/dash+xml',
  '.pls': 'audio/x-scpls',
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const requested = decodeURIComponent(url.pathname);
    let filePath = path.normalize(path.join(root, requested));
    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end('forbidden');
      return;
    }
    if (requested.endsWith('/')) filePath = path.join(filePath, 'index.html');
    const data = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': types[path.extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end('not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`fixtures http://127.0.0.1:${port}`);
});
