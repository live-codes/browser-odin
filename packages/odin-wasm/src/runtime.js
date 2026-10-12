// The engines, one per asset source.
//
// A source is keyed by where its bytes came from, so creating two compilers
// against the same `baseUrl` — or the same package — compiles the compiler
// module and unpacks the standard library once. Every compiler holds a
// reference; the entry is dropped when the last one is disposed.

import { inflateGzip } from './assets.js';
import { createEngine } from './engine.js';
import { unpackLibrary } from './pack.js';

const engines = new Map();

async function loadEngine(source, onProgress) {
  const report = (name) => (loaded, total) => onProgress?.({ name, loaded, total });
  const wasmBytes = await source.readAsset('odin.wasm', report('odin.wasm'));
  const packBytes = await source.readAsset('odin-src.pack.gz', report('odin-src.pack.gz'));
  const compilerModule = await WebAssembly.compile(wasmBytes);
  const libraryEntries = unpackLibrary(await inflateGzip(packBytes));
  return createEngine({ compilerModule, libraryEntries });
}

/** @returns {{ promise: Promise<object>, refs: number, key: string }} */
export function acquireEngine(source, onProgress) {
  let entry = engines.get(source.key);
  if (entry === undefined) {
    entry = { key: source.key, refs: 0, promise: loadEngine(source, onProgress) };
    engines.set(source.key, entry);
    // A failed load must not be cached, or every later attempt reports the same
    // stale failure.
    entry.promise.catch(() => engines.delete(source.key));
  }
  entry.refs += 1;
  return entry;
}

export function releaseEngine(entry) {
  entry.refs -= 1;
  if (entry.refs <= 0) engines.delete(entry.key);
}
