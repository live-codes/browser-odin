// The POC page: sends the editor contents to the compile worker, which
// compiles it with the wasm-hosted Odin compiler and runs the result. Nothing
// is sent anywhere; the whole pipeline runs in this tab.

import { SAMPLES, SAMPLE_STDIN } from './samples.js';

const sourceEl = document.getElementById('source');
const stdinEl = document.getElementById('stdin');
const samplesEl = document.getElementById('samples');
const runEl = document.getElementById('run');
const statusEl = document.getElementById('status');
const stdoutEl = document.getElementById('stdout');
const stderrEl = document.getElementById('stderr');
const diagnosticsEl = document.getElementById('diagnostics');

for (const name of Object.keys(SAMPLES)) samplesEl.add(new Option(name, name));
samplesEl.value = 'hello';
sourceEl.value = SAMPLES.hello;

let worker = null;
let ready = false;
let compiling = false;

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
  sourceEl.value = SAMPLES[name];
  stdinEl.value = SAMPLE_STDIN[name] ?? '';
};

const startWorker = () => {
  worker = new Worker('compile-worker.js', { type: 'module' });

  worker.onmessage = (event) => {
    const message = event.data ?? {};
    switch (message.type) {
      case 'ready':
        ready = true;
        setRunning(false);
        runEl.textContent = 'Run ▸';
        setStatus(`ready — ${message.libraryFiles} standard library files`, 'ready');
        break;
      case 'output':
        if (message.phase === 'compile') {
          diagnosticsEl.textContent += message.text;
        } else if (message.stream === 'stdout') {
          stdoutEl.textContent += message.text;
        } else {
          stderrEl.textContent += message.text;
        }
        break;
      case 'done':
        setRunning(false);
        document.documentElement.dataset.runs = String(Number(document.documentElement.dataset.runs ?? 0) + 1);
        document.documentElement.dataset.exitCode = String(message.exitCode);
        if (message.ok) {
          setStatus(`ok — compiled in ${message.compileMs} ms, ran in ${message.totalMs - message.compileMs} ms`, 'ready');
        } else {
          setStatus(`failed — exit code ${message.exitCode}`, 'error');
        }
        break;
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
  setRunning(true);
  stdoutEl.textContent = '';
  stderrEl.textContent = '';
  diagnosticsEl.textContent = '';
  setStatus('compiling…');
  worker.postMessage({
    type: 'compile',
    files: [{ path: 'src/main.odin', data: sourceEl.value }],
    dir: '/src',
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
