// The POC page: sends the editor contents to the compile worker, then runs the
// module it emitted. Nothing is sent anywhere; the whole pipeline runs here.
//
// Two targets are offered, and they run differently:
//   - wasi_wasm32  a WASI command module, run under public/wasi.js with the
//                  page's stdin and its stdout captured
//   - js_wasm32    a browser module, run with the Odin JS runtime (public/odin.js)
//                  so it can reach the DOM and a canvas; a program that exports
//                  `step` is driven once per animation frame

import { WasiFileSystem, createWasi, runWasi } from './wasi.js';
import { SAMPLES, SAMPLE_STDIN, SAMPLE_TARGET } from './samples.js';

const sourceEl = document.getElementById('source');
const stdinEl = document.getElementById('stdin');
const samplesEl = document.getElementById('samples');
const targetEl = document.getElementById('target');
const runEl = document.getElementById('run');
const statusEl = document.getElementById('status');
const stdoutEl = document.getElementById('stdout');
const stderrEl = document.getElementById('stderr');
const diagnosticsEl = document.getElementById('diagnostics');
const canvasEl = document.getElementById('canvas');

for (const name of Object.keys(SAMPLES)) samplesEl.add(new Option(name, name));
samplesEl.value = 'hello';
sourceEl.value = SAMPLES.hello;

let worker = null;
let ready = false;
let compiling = false;
let runGeneration = 0; // bumped per run, so a stale animation loop stops

const setStatus = (text, state = 'loading') => {
  statusEl.textContent = text;
  statusEl.dataset.state = state;
  document.documentElement.dataset.status = state;
};

const setRunning = (running) => {
  compiling = running;
  runEl.disabled = running || !ready;
  document.documentElement.dataset.busy = running ? 'true' : 'false';
};

const selectSample = (name) => {
  samplesEl.value = name;
  sourceEl.value = SAMPLES[name];
  stdinEl.value = SAMPLE_STDIN[name] ?? '';
  // A sample that only works on one target switches to it.
  const target = SAMPLE_TARGET[name];
  if (target) targetEl.value = target;
};

// --- running the compiled module -------------------------------------------

const runWasiProgram = (bytes) => {
  canvasEl.hidden = true;
  const fs = new WasiFileSystem();
  const wasi = createWasi(fs, {
    args: ['main.wasm'],
    stdin: stdinEl.value,
    stdout: (text) => { stdoutEl.textContent += text; },
    stderr: (text) => { stderrEl.textContent += text; },
  });
  try {
    return runWasi(new WebAssembly.Module(bytes), wasi);
  } catch (error) {
    stderrEl.textContent += `trapped: ${error?.message ?? error}\n`;
    return 1;
  }
};

const runJsProgram = async (bytes, generation) => {
  canvasEl.hidden = true;
  const memory = new odin.WasmMemoryInterface();
  memory.setIntSize(4);

  const imports = odin.setupDefaultImports(memory, null, memory.memory);
  imports.odin_env.write = (fd, ptr, len) => {
    const text = memory.loadString(ptr, len);
    if (fd === 1) stdoutEl.textContent += text;
    else stderrEl.textContent += text;
  };

  // Standard input, for the patched core:os (patches/core/os/file_js.odin).
  // `read` fills the module's memory and returns the byte count, 0 at end.
  const input = new TextEncoder().encode(stdinEl.value);
  let inputOffset = 0;
  imports.odin_env.read = (fd, ptr, len) => {
    if (fd !== 0) return 0;
    const count = Math.max(0, Math.min(len, input.length - inputOffset));
    if (count > 0) {
      new Uint8Array(memory.memory.buffer, ptr, count).set(input.subarray(inputOffset, inputOffset + count));
      inputOffset += count;
    }
    return count;
  };

  let exports;
  try {
    ({ instance: { exports } } = await WebAssembly.instantiate(bytes, imports));
  } catch (error) {
    stderrEl.textContent += `failed to instantiate: ${error?.message ?? error}\n`;
    return 1;
  }
  memory.setExports(exports);
  if (exports.memory) memory.setMemory(exports.memory);

  try {
    if (exports._start) exports._start();
  } catch (error) {
    stderrEl.textContent += `crashed: ${error?.message ?? error}\n`;
    return 1;
  }

  if (!exports.step) {
    if (exports._end) exports._end();
    return 0;
  }

  // An interactive program: drive it once per animation frame.
  canvasEl.hidden = false;
  const context = exports.default_context_ptr ? exports.default_context_ptr() : 0;
  setStatus('running — press Run to restart', 'ready');
  let previous;
  const frame = (timestamp) => {
    if (generation !== runGeneration) return;
    if (previous === undefined) previous = timestamp;
    const dt = (timestamp - previous) * 0.001;
    previous = timestamp;
    let keepGoing = false;
    try {
      keepGoing = exports.step(dt, context);
    } catch (error) {
      stderrEl.textContent += `crashed: ${error?.message ?? error}\n`;
      return;
    }
    if (!keepGoing) {
      if (exports._end) exports._end();
      setStatus('the program stopped', 'ready');
      return;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return null; // still running; the loop reports its own end
};

const runProgram = async (bytes, target) => {
  const generation = ++runGeneration;
  const code = target === 'js_wasm32'
    ? await runJsProgram(bytes, generation)
    : runWasiProgram(bytes);
  return code;
};

// --- the worker -------------------------------------------------------------

const startWorker = () => {
  worker = new Worker('compile-worker.js', { type: 'module' });

  worker.onmessage = async (event) => {
    const message = event.data ?? {};
    switch (message.type) {
      case 'ready':
        ready = true;
        setRunning(false);
        runEl.textContent = 'Run ▸';
        setStatus(`ready — ${message.libraryFiles} standard library files`, 'ready');
        break;
      case 'output':
        diagnosticsEl.textContent += message.text;
        break;
      case 'done': {
        setRunning(false);
        document.documentElement.dataset.runs = String(Number(document.documentElement.dataset.runs ?? 0) + 1);
        if (!message.ok) {
          document.documentElement.dataset.exitCode = String(message.exitCode ?? 1);
          setStatus(`compilation failed — exit code ${message.exitCode}`, 'error');
          break;
        }
        const code = await runProgram(new Uint8Array(message.wasm), targetEl.value);
        if (code === null) break; // an animation loop is running
        document.documentElement.dataset.exitCode = String(code);
        setStatus(
          code === 0 ? `ok — compiled in ${message.compileMs} ms` : `failed — exit code ${code}`,
          code === 0 ? 'ready' : 'error',
        );
        break;
      }
      default:
        break;
    }
  };

  worker.onerror = (event) => {
    setStatus(`worker failed: ${event.message}`, 'error');
  };

  setStatus('loading the compiler (odin.wasm, ~3.8 MB)…');
};

const run = () => {
  if (!worker || !ready || compiling) return;
  runGeneration++;
  setRunning(true);
  stdoutEl.textContent = '';
  stderrEl.textContent = '';
  diagnosticsEl.textContent = '';
  canvasEl.hidden = true;
  setStatus('compiling…');
  worker.postMessage({
    type: 'compile',
    files: [{ path: 'src/main.odin', data: sourceEl.value }],
    dir: '/src',
    target: targetEl.value,
    stdin: stdinEl.value,
  });
};

samplesEl.addEventListener('change', () => selectSample(samplesEl.value));
runEl.addEventListener('click', run);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    run();
  }
});
sourceEl.addEventListener('keydown', (event) => {
  if (event.key === 'Tab') {
    event.preventDefault();
    sourceEl.setRangeText('\t', sourceEl.selectionStart, sourceEl.selectionEnd, 'end');
  }
});

window.odinPoc = {
  get worker() { return worker; },
  get ready() { return ready; },
  run,
  samples: SAMPLES,
  selectSample,
};

startWorker();
