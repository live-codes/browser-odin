// The compile worker: runs the Odin compiler (odin.wasm, a WASI command
// module) off the main thread, then runs the module it produced.
//
// Every compile is a fresh instance of the compiler with its own linear
// memory — a WASI command module runs once. The file system holding the Odin
// standard library (base/ and core/, under /odin) is built once and shared;
// each compile gets its own copy so nothing a previous one wrote can leak in.
//
// Messages in:   { type: 'compile', files: [{ path, data }], dir?, flags?, stdin? }
// Messages out:  { type: 'ready' }
//                { type: 'output', phase: 'compile'|'program', stream, text }
//                { type: 'done', ok, compileMs, totalMs, exitCode, output }

import { WasiFileSystem, createWasi, runWasi } from './wasi.js';

// Where the compiler looks for base/, core/ and vendor/ (ODIN_ROOT).
const ODIN_ROOT = '/odin';
const PROGRAM = '/out/main.wasm';
const PACK_MAGIC = 'ODINPOC1';

let compilerModule = null;
let libraryEntries = null; // [path, Uint8Array] from the pack, shared and read-only

const post = (message) => self.postMessage(message);
const output = (phase, stream, text) => post({ type: 'output', phase, stream, text });
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
  const { files, dir = '/src', flags = [], stdin = '' } = message;

  const fs = libraryFs();
  for (const file of files) {
    const data = typeof file.data === 'string'
      ? new TextEncoder().encode(file.data)
      : new Uint8Array(file.data);
    fs.writeFile(file.path, data);
  }
  fs.mkdirAll('/out');

  const args = ['odin', 'build', dir, `-out:${PROGRAM}`, '-backend:wasm', '-target:wasi_wasm32', ...flags];
  const started = globalThis.performance.now();

  let code = 1;
  try {
    code = runWasi(compilerModule, createWasi(fs, {
      args,
      env: [`ODIN_ROOT=${ODIN_ROOT}`],
      stdout: (text) => output('compile', 'stdout', text),
      stderr: (text) => output('compile', 'stderr', text),
    }));
  } catch (error) {
    output('compile', 'stderr', `The compiler crashed: ${error?.message ?? error}\n`);
    post({ type: 'done', ok: false, compileMs: ms(started), totalMs: ms(started), exitCode: 1, output: '' });
    return;
  }

  const compileMs = ms(started);
  const artifact = code === 0 ? fs.readFile(PROGRAM) : null;
  if (artifact === null || artifact.length === 0) {
    post({ type: 'done', ok: false, compileMs, totalMs: ms(started), exitCode: code, output: '' });
    return;
  }

  // Run the produced program on a fresh, empty file system so it cannot see
  // the compiler's sources; capture its output the same way.
  const captured = [];
  let exitCode = 0;
  try {
    const program = await WebAssembly.compile(artifact.slice());
    exitCode = runWasi(program, createWasi(new WasiFileSystem(), {
      args: ['main.wasm'],
      stdin,
      stdout: (text) => {
        captured.push(text);
        output('program', 'stdout', text);
      },
      stderr: (text) => output('program', 'stderr', text),
    }));
  } catch (error) {
    output('program', 'stderr', `The program trapped: ${error?.message ?? error}\n`);
    exitCode = 1;
  }

  post({
    type: 'done',
    ok: code === 0 && exitCode === 0,
    compileMs,
    totalMs: ms(started),
    exitCode,
    output: captured.join(''),
  });
}

self.onmessage = (event) => {
  const message = event.data ?? {};
  if (message.type === 'compile') {
    compile(message).catch((error) => {
      output('compile', 'stderr', `Compile failed: ${error?.message ?? error}\n`);
      post({ type: 'done', ok: false, compileMs: 0, totalMs: 0, exitCode: 1, output: '' });
    });
  }
};

setup().catch((error) => {
  output('compile', 'stderr', `Failed to load the compiler: ${error?.message ?? error}\n`);
});
