// Builds the IIFE bundle: one classic script, for workers and pages that cannot
// use ES modules.
//
//   npm run build:iife
//
// The output is committed, because a classic worker can only `importScripts()`
// a URL and a consumer should not need a bundler to get one. It is built from
// the browser entry, so it never pulls in the Node-only packaged-assets code.
import { build } from 'esbuild';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BUNDLE = {
	entry: '../src/index.js',
	outfile: '../dist/odin-wasm.global.js',
	globalName: 'odinWasm',
	banner: `/*! @live-codes/odin-wasm - MIT. IIFE build, sets self.odinWasm.
 *  importScripts('odin-wasm.global.js') then self.odinWasm.createCompiler({ baseUrl }).
 *  The compiler assets it fetches are Odin's, under the zlib license. */`
};

const out = fileURLToPath(new URL(BUNDLE.outfile, import.meta.url));
await build({
	entryPoints: [fileURLToPath(new URL(BUNDLE.entry, import.meta.url))],
	outfile: out,
	bundle: true,
	format: 'iife',
	globalName: BUNDLE.globalName,
	minify: true,
	platform: 'browser',
	target: 'es2022'
});
console.log(`${BUNDLE.outfile.replace('../', '')}  ${(statSync(out).size / 1024).toFixed(1)} KB (minified)`);
