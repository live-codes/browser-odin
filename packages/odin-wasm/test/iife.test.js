import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// The bundle is committed, so it is checked as it ships rather than rebuilt.
const source = readFileSync(new URL('../dist/odin-wasm.global.js', import.meta.url), 'utf8');

const loadBundle = () => {
  // The globals a classic worker would have, since the bundle is written for one.
  const context = {
    console,
    TextEncoder,
    TextDecoder,
    URL,
    Blob,
    Response,
    DecompressionStream,
    WebAssembly,
    performance,
    crypto: globalThis.crypto,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.odinWasm;
};

test('the IIFE bundle defines self.odinWasm with the same API', async () => {
  const api = loadBundle();
  assert.ok(api, 'expected the bundle to set self.odinWasm');
  assert.equal(typeof api.createCompiler, 'function');
  assert.deepEqual([...api.TARGETS], ['wasi_wasm32', 'js_wasm32']);
});

test('the bundle is the browser entry, so it demands a baseUrl', async () => {
  const api = loadBundle();
  await assert.rejects(() => api.createCompiler(), /baseUrl is required here[\s\S]*copy-assets/);
});
