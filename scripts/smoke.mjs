// End-to-end smoke test in Node: load the compiler (odin.wasm) and the packed
// standard library, compile a program with the same WASI shim and the same
// argument vector the browser worker uses, then run the result — all without
// a browser. It is the same code path public/wasi.js serves in the page.
//
//   npm test

import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WasiFileSystem, createWasi, runWasi } from '../public/wasi.js';
import { SAMPLES, SAMPLE_STDIN } from '../public/samples.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ODIN_ROOT = '/odin';

const unpack = (buffer) => {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== 'ODINPOC1') throw new Error('bad pack');
  const count = view.getUint32(8, true);
  const decoder = new TextDecoder();
  const entries = [];
  let pos = 12;
  for (let i = 0; i < count; i++) {
    const pathLen = view.getUint32(pos, true); pos += 4;
    const path = decoder.decode(bytes.subarray(pos, pos + pathLen)); pos += pathLen;
    const dataLen = view.getUint32(pos, true); pos += 4;
    entries.push([path, bytes.subarray(pos, pos + dataLen)]); pos += dataLen;
  }
  return entries;
};

const loadAssets = () => {
  const wasmPath = join(ROOT, 'assets/odin.wasm');
  const packPath = join(ROOT, 'assets/odin-src.pack.gz');
  if (!existsSync(wasmPath) || !existsSync(packPath)) {
    console.error('assets missing — run `npm run assets` (and build odin.wasm; see README)');
    process.exit(1);
  }
  return {
    module: new WebAssembly.Module(readFileSync(wasmPath)),
    library: unpack(gunzipSync(readFileSync(packPath))),
  };
};

const buildLibraryFs = (entries) => {
  const fs = new WasiFileSystem();
  for (const [path, data] of entries) fs.writeFile(`${ODIN_ROOT}/${path}`, data);
  fs.mkdirAll(`${ODIN_ROOT}/vendor`);
  return fs;
};

const compileAndRun = (module, library, source, { dir = '/src', flags = [], stdin = '' } = {}) => {
  const fs = buildLibraryFs(library);
  fs.writeFile(`${dir}/main.odin`, new TextEncoder().encode(source));
  fs.mkdirAll('/out');

  const compileOut = [];
  const compileErr = [];
  const args = ['odin', 'build', dir, '-out:/out/main.wasm', '-backend:wasm', '-target:wasi_wasm32', ...flags];
  let code;
  try {
    code = runWasi(module, createWasi(fs, {
      args,
      env: [`ODIN_ROOT=${ODIN_ROOT}`],
      stdout: (t) => compileOut.push(t),
      stderr: (t) => compileErr.push(t),
    }));
  } catch (error) {
    return {
      ok: false,
      compareCode: 1,
      compileLog: compileOut.join('') + compileErr.join(''),
      output: '',
      crash: error?.message ?? String(error),
    };
  }

  if (code !== 0) {
    return { ok: false, compileCode: code, compileLog: compileOut.join('') + compileErr.join(''), output: '' };
  }

  const artifact = fs.readFile('/out/main.wasm');
  const programFs = new WasiFileSystem();
  const out = [];
  const err = [];
  const program = new WebAssembly.Module(artifact.slice());
  const exitCode = runWasi(program, createWasi(programFs, {
    args: ['main.wasm'],
    stdin,
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
  }));

  return { ok: true, exitCode, output: out.join(''), stderr: err.join(''), compileLog: compileOut.join('') + compileErr.join('') };
};

const main = async () => {
  const { module, library } = loadAssets();
  console.log(`compiler: ${module ? 'loaded' : 'missing'}, library files: ${library.length}`);

  // The samples the page ships, so a sample that cannot compile is caught
  // here rather than by a user. Anything without an expected output is taken
  // to be a deliberate failure (a diagnostic the page displays).
  const EXPECT = {
    'hello': 'Hellope!\n',
    'loops and formatting': '1 squared is 1\n2 squared is 4\n3 squared is 9\n4 squared is 16\n5 squared is 25\nsum = 15\n',
    'collections': 'sorted: [1, 2, 3, 5, 8, 9]\nsum = 28, max = 9\n',
    'structs and procedures': 'Vec2{x = 1, y = 2} + Vec2{x = 3, y = 4} = Vec2{x = 4, y = 6}\nsum = 10\n',
    'read from stdin': '4 numbers, sum 10\n',
  };
  const cases = Object.keys(SAMPLES).map((name) => ({
    name,
    source: SAMPLES[name],
    stdin: SAMPLE_STDIN[name] ?? '',
    expect: EXPECT[name],
    expectError: !(name in EXPECT),
  }));

  let failures = 0;
  for (const test of cases) {
    const started = Date.now();
    const result = compileAndRun(module, library, test.source, { stdin: test.stdin });
    const ms = Date.now() - started;
    if (test.expectError) {
      const ok = !result.ok;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${test.name} (${ms} ms)` +
        (ok ? '' : ` — expected a compile error, got output ${JSON.stringify(result.output)}`));
      if (!ok) failures++;
      continue;
    }
    const ok = result.ok && result.output === test.expect;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${test.name} (${ms} ms)`);
    if (!ok) {
      failures++;
      console.log(`     expected: ${JSON.stringify(test.expect)}`);
      console.log(`     output:   ${JSON.stringify(result.output)}`);
      if (result.crash) console.log(`     crash:    ${result.crash}`);
      if (result.compileLog.trim()) console.log(`     compiler: ${result.compileLog.trim().split('\n').slice(-8).join('\n               ')}`);
    }
  }

  console.log(failures === 0 ? 'all passed' : `${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
};

main();
