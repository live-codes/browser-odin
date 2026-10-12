// The compile → run engine. It has no opinion about where the compiler module
// and the standard library came from; `assets.js` reads them, this runs them.
//
// The compiler is a WASI command module, so every compile is a fresh instance
// over a fresh in-memory file system: the standard library, the user's file,
// and an `out/` to write into. The module it emits then runs on one of two
// hosts, depending on the target it was built for.

import { WasiFileSystem, WasiExit, createWasi, runWasi } from './wasi-host.js';
import { createJsHost, JsExit } from './host-js.js';

// Where the compiler looks for base/, core/ and vendor/.
const ODIN_ROOT = '/odin';
const PROGRAM = '/out/main.wasm';

/** The targets the compiler can emit, and the page can run. */
export const TARGETS = ['wasi_wasm32', 'js_wasm32'];

const encoder = new TextEncoder();

const capture = () => {
  const stdoutParts = [];
  const stderrParts = [];
  const order = [];
  return {
    stdout: (text) => {
      stdoutParts.push(text);
      order.push(text);
    },
    stderr: (text) => {
      stderrParts.push(text);
      order.push(text);
    },
    stdoutText: () => stdoutParts.join(''),
    stderrText: () => stderrParts.join(''),
    outputText: () => order.join(''),
  };
};

/** The lines a caller reads as diagnostics, with the empty ones dropped. */
const diagnosticLines = (text) =>
  text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '');

/**
 * @param {object} assets
 * @param {WebAssembly.Module} assets.compilerModule - the Odin compiler
 * @param {[string, Uint8Array][]} assets.libraryEntries - the packed standard library
 */
export function createEngine({ compilerModule, libraryEntries }) {
  /** A fresh file system with the standard library under /odin. */
  const libraryFs = () => {
    const fs = new WasiFileSystem();
    for (const [path, data] of libraryEntries) fs.writeFile(`${ODIN_ROOT}/${path}`, data);
    // The compiler registers its collections (base, core, vendor) from
    // directories and requires all three to exist; the pack ships no vendor
    // packages, so the directory is empty.
    fs.mkdirAll(`${ODIN_ROOT}/vendor`);
    return fs;
  };

  const compile = ({ code, target, compileArgs, fileName }) => {
    const fs = libraryFs();
    fs.writeFile(`/src/${fileName}`, encoder.encode(code));
    fs.mkdirAll('/out');

    const compilerOut = [];
    const compilerErr = [];
    const args = [
      'odin',
      'build',
      '/src',
      `-out:${PROGRAM}`,
      '-backend:wasm',
      `-target:${target}`,
      ...compileArgs,
    ];

    let exitCode = 1;
    let crash = '';
    try {
      exitCode = runWasi(compilerModule, createWasi(fs, {
        args,
        env: [`ODIN_ROOT=${ODIN_ROOT}`],
        stdout: (text) => compilerOut.push(text),
        stderr: (text) => compilerErr.push(text),
      }));
    } catch (error) {
      crash = error?.message ?? String(error);
    }

    return {
      exitCode,
      artifact: exitCode === 0 ? fs.readFile(PROGRAM) : null,
      diagnostics: diagnosticLines(compilerOut.join('') + compilerErr.join('')),
      crash,
    };
  };

  const runWasiTarget = (artifact, { input, args }) => {
    const captured = capture();
    let exitCode = 0;
    try {
      exitCode = runWasi(new WebAssembly.Module(artifact.slice()), createWasi(new WasiFileSystem(), {
        args: ['main.wasm', ...args],
        stdin: input,
        stdout: captured.stdout,
        stderr: captured.stderr,
      }));
    } catch (error) {
      if (error instanceof WasiExit) exitCode = error.code;
      else {
        captured.stderr(`The program trapped: ${error?.message ?? error}\n`);
        exitCode = 1;
      }
    }
    return { exitCode, ...capturedText(captured) };
  };

  const runJsTarget = async (artifact, { input, args }) => {
    const captured = capture();
    const host = createJsHost({ input, args: ['main.wasm', ...args], stdout: captured.stdout, stderr: captured.stderr });
    let exitCode = 0;
    try {
      const { instance } = await WebAssembly.instantiate(artifact.slice(), host.imports);
      host.setMemory(instance.exports.memory);
      if (instance.exports._start) instance.exports._start();
      if (instance.exports._end) instance.exports._end();
    } catch (error) {
      if (error instanceof JsExit) exitCode = error.code;
      else {
        captured.stderr(`The program trapped: ${error?.message ?? error}\n`);
        exitCode = 1;
      }
    }
    return { exitCode, ...capturedText(captured) };
  };

  /**
   * Compile and run one program.
   *
   * @param {object} params
   * @param {string} params.code
   * @param {string|Uint8Array} params.input
   * @param {string} params.target
   * @param {string[]} params.args
   * @param {string[]} params.compileArgs
   * @param {string} params.fileName
   */
  const compileAndRun = async ({ code, input = '', target, args = [], compileArgs = [], fileName = 'main.odin' }) => {
    const compileStarted = now();
    const compiled = compile({ code, target, compileArgs: [...compileArgs], fileName });
    const compileMs = Math.round(now() - compileStarted);

    if (compiled.artifact === null || compiled.artifact.length === 0) {
      const errors = compiled.crash
        ? [compiled.crash]
        : compiled.diagnostics.length > 0
          ? compiled.diagnostics
          : [`The compiler produced no module (exit code ${compiled.exitCode}).`];
      return { stdout: '', stderr: '', output: '', errors, exitCode: null, compileMs, runMs: null };
    }

    const runStarted = now();
    let ran;
    try {
      ran = target === 'js_wasm32'
        ? await runJsTarget(compiled.artifact, { input, args })
        : runWasiTarget(compiled.artifact, { input, args });
    } catch (error) {
      ran = { exitCode: 1, stdout: '', stderr: `The program could not run: ${error?.message ?? error}\n`, output: '', };
      ran.output = ran.stderr;
    }
    const runMs = Math.round(now() - runStarted);

    return {
      stdout: ran.stdout,
      stderr: ran.stderr,
      output: ran.output,
      errors: [],
      exitCode: ran.exitCode,
      compileMs,
      runMs,
    };
  };

  return { compileAndRun };
}

const capturedText = (captured) => ({
  stdout: captured.stdoutText(),
  stderr: captured.stderrText(),
  output: captured.outputText(),
});

const now = () => (globalThis.performance?.now?.() ?? Date.now());
