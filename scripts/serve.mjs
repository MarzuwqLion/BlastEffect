// Minimal static server for dist/ under the Pages base path.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg' };

export function serve(root, base = '/BlastEffect/', port = 4173) {
  const server = http.createServer((req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0]);
    if (!url.startsWith(base)) {
      res.writeHead(404);
      res.end();
      return;
    }
    let file = path.join(root, url.slice(base.length));
    if (file.endsWith('/') || !path.extname(file)) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
