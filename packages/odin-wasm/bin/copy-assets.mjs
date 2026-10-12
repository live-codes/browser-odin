#!/usr/bin/env node
// Copies the assets that ship inside this package into a directory you serve.
//
// This is the browser story: a page cannot read a file inside node_modules, so
// the assets have to be published by whatever serves the page. One command drops
// a complete, self-describing copy into your public directory; point `baseUrl`
// at it and nothing else has to be hosted.
import { cp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSET_RECEIPTS } from '../src/asset-receipts.js';

const ASSETS = fileURLToPath(new URL('../assets/', import.meta.url));

const USAGE = `Copy the assets that ship with this package into a directory you serve.

  odin-wasm-copy-assets [directory]

  directory   where to write them (default: ./odin)

  --print-path   print the packaged assets directory and exit
  --help         print this
`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}
if (args.includes('--print-path')) {
  console.log(ASSETS);
  process.exit(0);
}

const target = resolve(args.find((arg) => !arg.startsWith('-')) ?? 'odin');

await mkdir(target, { recursive: true });
for (const entry of await readdir(ASSETS, { withFileTypes: true })) {
  await cp(resolve(ASSETS, entry.name), resolve(target, entry.name), { recursive: true, force: true });
}

// The copy carries the receipts for its own bytes, so whoever serves it can check it.
await writeFile(resolve(target, 'asset-receipts.json'), `${JSON.stringify(ASSET_RECEIPTS, null, 2)}\n`);

console.log(`Assets copied to ${target}`);
console.log('Serve that directory and pass its URL as baseUrl, for example:');
console.log("  await createCompiler({ baseUrl: new URL('/odin/', location.href) });");
