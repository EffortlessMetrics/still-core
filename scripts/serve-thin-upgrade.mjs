// Local test server: preserves emitted bytes and exposes network freshness in a header.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.json': 'application/json', '.txt': 'text/plain' };

export function createThinUpgradeServer(directory) {
  const dist = path.resolve(directory);
  let requests = 0;
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1:4390');
      const pathname = decodeURIComponent(url.pathname);
      // A decoded separator must also be visible to browser URL resolution.
      // Preserve all other escapes and never turn a redirect into a host URL.
      assert(!pathname.includes('\\'));
      let canonical = url.pathname.replace(/%2f/gi, '/');
      assert(!canonical.startsWith('//'));
      let file = path.resolve(dist, '.' + pathname);
      assert(file.startsWith(dist + path.sep) || file === dist);
      if ((await stat(file)).isDirectory()) {
        if (!canonical.endsWith('/')) canonical += '/';
        file = path.join(file, 'index.html');
      }
      if (canonical !== url.pathname) {
        const location = new URL(url);
        location.pathname = canonical;
        assert(!location.pathname.startsWith('//'));
        response.writeHead(301, { Location: location.href.slice(location.origin.length), 'Cache-Control': 'no-store, no-transform' });
        response.end();
        return;
      }
      const body = await readFile(file);
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store, no-transform', 'X-Still-Network-Request': String(++requests) });
      response.end(body);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('Not found');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  createThinUpgradeServer(path.resolve(process.env.STILL_PACKED_CONSUMER, 'dist')).listen(4390, '127.0.0.1');
}
