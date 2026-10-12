// Packs the Odin standard library (base/ and core/) into a single gzipped
// archive that the compile worker loads into its in-memory file system.
//
// The compiler reads its standard library from files, so a browser must give
// it one: a flat, self-describing container is smaller and simpler than a tar
// (no per-entry headers) and inflates with the one decompressor a browser has
// (DecompressionStream("gzip")).
//
// Format (before gzip):
//   "ODINPOC1"          8 bytes
//   count               u32 little-endian
//   count × { pathLen:u32, path:utf8, dataLen:u32, data:bytes }
//
// Usage:
//   ODIN_SRC=/path/to/wodin node scripts/build-assets.mjs
// ODIN_SRC is a checkout of wodin (or Odin); base/ and core/ are read from it.
// Defaults to .tools/odin-src.
//
// core/rexcode is left out: it is the machine-code library, tens of MB of
// tables and binaries that cannot run in a browser and that no browser
// program can import. Assembly sources for other targets go too.

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC = resolve(process.env.ODIN_SRC ?? join(ROOT, '.tools/odin-src'));
const OUT = join(ROOT, 'assets/odin-src.pack.gz');

const MAGIC = Buffer.from('ODINPOC1', 'latin1');

// Paths (relative to SRC, POSIX separators) that are not worth shipping.
const EXCLUDED = [
  /^core\/rexcode(\/|$)/, // machine-code library: unusable in a browser
  /\.asm$/, // assembly for targets other than wasm
];

const isExcluded = (path) => EXCLUDED.some((re) => re.test(path));

const walk = (dir, out) => {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const rel = relative(SRC, full).split(sep).join('/');
    if (isExcluded(rel)) continue;
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, out);
    else if (stats.isFile()) out.push([rel, readFileSync(full)]);
  }
  return out;
};

if (!existsSync(join(SRC, 'base')) || !existsSync(join(SRC, 'core'))) {
  console.error(`build-assets: no base/ and core/ in ${SRC}`);
  console.error('set ODIN_SRC to a wodin or Odin checkout (see README)');
  process.exit(1);
}

const entries = walk(SRC, []);
entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

let total = 12;
for (const [path, data] of entries) total += 8 + Buffer.byteLength(path) + data.length;

const pack = Buffer.allocUnsafe(total);
MAGIC.copy(pack, 0);
pack.writeUInt32LE(entries.length, 8);
let pos = 12;
for (const [path, data] of entries) {
  const pathBytes = Buffer.from(path, 'utf8');
  pack.writeUInt32LE(pathBytes.length, pos);
  pos += 4;
  pathBytes.copy(pack, pos);
  pos += pathBytes.length;
  pack.writeUInt32LE(data.length, pos);
  pos += 4;
  data.copy(pack, pos);
  pos += data.length;
}

mkdirSync(join(ROOT, 'assets'), { recursive: true });
const gzipped = gzipSync(pack, { level: 9 });
writeFileSync(OUT, gzipped);

const mib = (n) => (n / 1024 / 1024).toFixed(2);
console.log(`source:   ${SRC}`);
console.log(`files:    ${entries.length}`);
console.log(`packed:   ${mib(pack.length)} MiB → ${mib(gzipped.length)} MiB gzipped`);
console.log(`wrote:    ${OUT}`);
