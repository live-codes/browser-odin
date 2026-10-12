// A static file server for the POC. It compiles nothing: it only serves the
// page and the compiled assets (odin.wasm, the packed standard library) with
// the right content types. A static server is required because ES modules and
// Workers do not load over file://.
//
//   node serve.mjs            → http://localhost:8144/
//
// `application/wasm` matters: without it WebAssembly.compileStreaming refuses
// the response.

import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
// The page lives in public/; the built assets (odin.wasm, the packed standard
// library) live in assets/, served at /assets/.
const PUBLIC_DIR = join(ROOT, 'public');
const PORT = Number(process.env.PORT ?? 8144);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

// Resolve a request path to a file inside the served directories, or null if
// it escapes them. "/assets/…" is the built assets; everything else is public/.
// Paths are normalised with POSIX rules (URL separators), never path.normalize,
// which would rewrite them to the platform's separator.
const resolveFile = (urlPath) => {
  const path = decodeURIComponent(new URL(urlPath, 'http://localhost').pathname);
  const segments = path.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.includes('..')) return null;
  if (segments.length === 0) return join(PUBLIC_DIR, 'index.html');
  const base = segments[0] === 'assets' ? ROOT : PUBLIC_DIR;
  const file = join(base, ...segments);
  if (file !== base && !file.startsWith(base + sep)) return null;
  return file;
};

const serve = (req, res) => {
  let path = resolveFile(req.url ?? '/');
  if (path === null) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  let stats;
  try {
    stats = statSync(path);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }

  if (stats.isDirectory()) {
    path = join(path, 'index.html');
    try {
      stats = statSync(path);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
  }

  const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'content-length': stats.size,
    // The assets are large and stable during a session; the page itself is not.
    'cache-control': extname(path) === '.html' ? 'no-store' : 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(path).pipe(res);
};

createServer(serve).listen(PORT, () => {
  console.log(`browser-odin POC on http://localhost:${PORT}/`);
  console.log(`serving ${ROOT}`);
});
