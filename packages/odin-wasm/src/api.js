import { resolveAssetSource } from './assets.js';
import { TARGETS } from './engine.js';
import { acquireEngine, releaseEngine } from './runtime.js';

// One implementation, two entry points: `index.js` for anything without a
// filesystem, and `index.node.js` for Node, which can also read the assets that
// ship in this package.

const TARGET_ALIASES = {
  wasi: 'wasi_wasm32',
  'wasi-wasm32': 'wasi_wasm32',
  js: 'js_wasm32',
  'js-wasm32': 'js_wasm32',
};

function resolveTarget(value, fallback) {
  const target = value ?? fallback;
  if (target == null) return 'wasi_wasm32';
  const resolved = TARGET_ALIASES[target] ?? target;
  if (!TARGETS.includes(resolved)) {
    throw new Error(`Unknown target "${target}". Expected one of ${TARGETS.join(', ')}.`);
  }
  return resolved;
}

export function createApi({ packaged }) {
  /**
   * Create an Odin compiler.
   *
   * The heavy part — the compiler module and the packed standard library — is
   * fetched here, so a bad `baseUrl` fails at this point rather than at the
   * first run. Sources that resolve to the same assets share one engine, so two
   * compilers against the same `baseUrl` load the bytes once.
   *
   * @param {object} [options]
   * @param {string} [options.baseUrl] - where the assets are served from. In
   *   Node this may be omitted to use the files that ship in this package;
   *   anywhere else it is required.
   * @param {'wasi_wasm32'|'js_wasm32'} [options.target] - what the program is
   *   compiled for. `wasi_wasm32` (the default) runs anywhere; `js_wasm32` is
   *   the browser target, and outside a page only its console output works.
   * @param {string[]} [options.args] - default program argv.
   * @param {string[]} [options.compileArgs] - extra compiler flags.
   * @param {string} [options.fileName] - the name the source is compiled under.
   * @param {(progress: {name: string, loaded: number, total: number}) => void} [options.onProgress]
   */
  async function createCompiler(options = {}) {
    const target = resolveTarget(options.target);
    const source = resolveAssetSource(options, packaged);
    const entry = acquireEngine(source, options.onProgress);

    let engine;
    try {
      engine = await entry.promise;
    } catch (error) {
      releaseEngine(entry);
      throw error;
    }

    const defaults = {
      target,
      args: options.args ?? [],
      compileArgs: options.compileArgs ?? [],
      fileName: options.fileName ?? 'main.odin',
    };
    let disposed = false;

    return {
      /** The target this compiler builds for, by default. */
      get target() {
        return defaults.target;
      },

      /** Every target the package can run, for building a picker. */
      get targets() {
        return [...TARGETS];
      },

      /**
       * Compile and run a program.
       *
       * @param {string} code - the Odin source.
       * @param {string|Uint8Array} [input] - stdin, handed to the program once.
       * @param {object} [runOptions] - per-run `target`, `args`, `compileArgs`,
       *   `fileName`.
       * @returns {Promise<{stdout: string, stderr: string, output: string,
       *   errors: string[], exitCode: number|null, compileMs: number,
       *   runMs: number|null}>} `output` is stdout and stderr in the order the
       *   program wrote them; `errors` holds the compiler's diagnostics and is
       *   empty when it compiled; `exitCode` is null when the program never ran.
       */
      async run(code, input, runOptions = {}) {
        if (disposed) throw new Error('This compiler has been disposed.');
        if (typeof code !== 'string') {
          throw new Error('run() needs the program source as its first argument.');
        }
        return engine.compileAndRun({
          code,
          input: input ?? '',
          target: resolveTarget(runOptions.target, defaults.target),
          args: runOptions.args ?? defaults.args,
          compileArgs: [...defaults.compileArgs, ...(runOptions.compileArgs ?? [])],
          fileName: runOptions.fileName ?? defaults.fileName,
        });
      },

      /**
       * Compile without running, for a host that runs the module itself.
       *
       * A page that needs the DOM cannot use `run`: a worker has no `document`, so the module has to
       * be instantiated on the page with Odin's own JS runtime. This hands back the module for that.
       *
       * @param {string} code - the Odin source.
       * @param {object} [options] - per-call `target`, `compileArgs`, `fileName`.
       * @returns {Promise<{ok: boolean, wasm: Uint8Array|null, errors: string[], compileMs: number}>}
       */
      async compile(code, options = {}) {
        if (disposed) throw new Error('This compiler has been disposed.');
        if (typeof code !== 'string') {
          throw new Error('compile() needs the program source as its first argument.');
        }
        return engine.compileOnly({
          code,
          target: resolveTarget(options.target, defaults.target),
          compileArgs: [...defaults.compileArgs, ...(options.compileArgs ?? [])],
          fileName: options.fileName ?? defaults.fileName,
        });
      },

      /** Drop this compiler's hold on the shared engine. Further runs throw. */
      dispose() {
        if (disposed) return;
        disposed = true;
        releaseEngine(entry);
      },
    };
  }

  return { createCompiler, TARGETS };
}
