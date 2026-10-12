// The compile worker: runs the Odin compiler (odin.wasm, a WASI command
// module) off the main thread and hands back the module it emitted. Running
// that module is the page's job — a `js_wasm32` program needs the DOM and the
// canvas, which live on the main thread.
//
// Every compile is a fresh instance of the compiler with its own linear memory
// — a WASI command module runs once. The file system holding the Odin standard
// library (base/ and core/, under /odin) is built once and shared.
//
// Messages in:   { type: 'compile', files: [{ path, data }], dir?, target?, flags? }
// Messages out:  { type: 'ready' }
//                { type: 'output', stream: 'stdout'|'stderr', text }
//                { type: 'done', ok, compileMs, exitCode, wasm? }

import { WasiFileSystem, createWasi, runWasi } from './wasi.js';

// Where the compiler looks for base/, core/ and vendor/ (ODIN_ROOT).
const ODIN_ROOT = '/odin';
const PROGRAM = '/out/main.wasm';
const PACK_MAGIC = 'ODINPOC1';

let compilerModule = null;
let libraryEntries = null; // [path, Uint8Array] from the pack, shared and read-only

const post = (message) => self.postMessage(message);
const output = (stream, text) => post({ type: 'output', stream, text });
const ms = (start) => Math.round(globalThis.performance.now() - start);

/** Parse the packed standard library produced by scripts/build-assets.mjs. */
const unpack = (buffer) => {
  const bytes = new Uint8Array(buffer);
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== PACK_MAGIC) {
    throw new Error(`bad standard library pack (want ${PACK_MAGIC})`);
  }
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const count = view.getUint32(8, true);
  const entries = [];
  let pos = 12;
  for (let i = 0; i < count; i++) {
    const pathLen = view.getUint32(pos, true);
    pos += 4;
    const path = decoder.decode(bytes.subarray(pos, pos + pathLen));
    pos += pathLen;
    const dataLen = view.getUint32(pos, true);
    pos += 4;
    entries.push([path, bytes.subarray(pos, pos + dataLen)]);
    pos += dataLen;
  }
  return entries;
};

/** An in-memory "/" with the standard library under /odin. */
const libraryFs = () => {
  const fs = new WasiFileSystem();
  for (const [path, data] of libraryEntries) fs.writeFile(`${ODIN_ROOT}/${path}`, data);
  // The compiler registers its library collections (base, core, vendor) from
  // directories; vendor ships empty — its packages are not needed by the POC.
  fs.mkdirAll(`${ODIN_ROOT}/vendor`);
  return fs;
};

async function setup() {
  const [wasmResponse, packResponse] = await Promise.all([
    fetch('assets/odin.wasm'),
    fetch('assets/odin-src.pack.gz'),
  ]);
  const compiled = WebAssembly.compileStreaming(wasmResponse);
  if (!packResponse.ok) {
    throw new Error(`failed to fetch assets/odin-src.pack.gz: ${packResponse.status}`);
  }
  const inflated = await new Response(
    packResponse.body.pipeThrough(new DecompressionStream('gzip')),
  ).arrayBuffer();
  libraryEntries = unpack(inflated);
  compilerModule = await compiled;
  post({ type: 'ready', libraryFiles: libraryEntries.length });
}

async function compile(message) {
  const { files, dir = '/src', target = 'wasi_wasm32', flags = [] } = message;

  const fs = libraryFs();
  for (const file of files) {
    const data = typeof file.data === 'string'
      ? new TextEncoder().encode(file.data)
      : new Uint8Array(file.data);
    fs.writeFile(file.path, data);
  }
  fs.mkdirAll('/out');

  const args = ['odin', 'build', dir, `-out:${PROGRAM}`, '-backend:wasm', `-target:${target}`, ...flags];
  const started = globalThis.performance.now();

  let code = 1;
  try {
    code = runWasi(compilerModule, createWasi(fs, {
      args,
      env: [`ODIN_ROOT=${ODIN_ROOT}`],
      stdout: (text) => output('stdout', text),
      stderr: (text) => output('stderr', text),
    }));
  } catch (error) {
    output('stderr', `The compiler crashed: ${error?.message ?? error}\n`);
    post({ type: 'done', ok: false, compileMs: ms(started), exitCode: 1 });
    return;
  }

  const compileMs = ms(started);
  const artifact = code === 0 ? fs.readFile(PROGRAM) : null;
  if (artifact === null || artifact.length === 0) {
    post({ type: 'done', ok: false, compileMs, exitCode: code });
    return;
  }

  const bytes = artifact.slice().buffer;
  post({ type: 'done', ok: true, compileMs, exitCode: 0, wasm: bytes }, [bytes]);
}

self.onmessage = (event) => {
  const message = event.data ?? {};
  if (message.type === 'compile') {
    compile(message).catch((error) => {
      output('stderr', `Compile failed: ${error?.message ?? error}\n`);
      post({ type: 'done', ok: false, compileMs: 0, exitCode: 1 });
    });
  }
};

setup().catch((error) => {
  output('stderr', `Failed to load the compiler: ${error?.message ?? error}\n`);
});
