// The host a `js_wasm32` program runs on, outside a page.
//
// A js_wasm32 module imports `odin_env` (the console, stdin, `evaluate`, the
// math intrinsics), `odin_dom` (elements and events), `webgl` and `webgl2`.
// Only `odin_env` can do anything without a DOM, so the other three are stubs
// that accept any call and return 0 — a program that reaches for the DOM runs
// and does nothing rather than failing to instantiate. A page that wants the
// DOM and the canvas supplies its own host; see the repository's page, which
// uses Odin's own `odin.js`.

/** Thrown by `trap`/`abort`, so an exit is not confused with a real crash. */
export class JsExit extends Error {
  constructor(code) {
    super(`The program exited (code ${code}).`);
    this.name = 'JsExit';
    this.code = code;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Any import the host does not define resolves to a no-op returning 0, so a
// module written against a different set of host functions still instantiates.
const withFallback = (target) =>
  new Proxy(target, {
    get: (object, property) =>
      typeof property === 'string' && !(property in object) ? () => 0 : object[property],
  });

/**
 * @param {object} options
 * @param {string|Uint8Array} [options.input] - the program's stdin, handed out once
 * @param {string[]} [options.args] - argv, including argv[0]
 * @param {(text: string) => void} [options.stdout]
 * @param {(text: string) => void} [options.stderr]
 */
export function createJsHost({ input = '', args = [], stdout = () => {}, stderr = () => {} } = {}) {
  const inputBytes = typeof input === 'string' ? encoder.encode(input) : new Uint8Array(input);
  let inputOffset = 0;

  let memory = null;
  const bytes = () => new Uint8Array(memory.buffer);
  const readString = (ptr, len) => decoder.decode(bytes().subarray(ptr, ptr + len));

  // Any call to a DOM or WebGL import is accepted and returns 0.
  const inertNamespace = new Proxy(
    {},
    { get: (_target, property) => (typeof property === 'string' ? () => 0 : undefined) }
  );

  const odin_env = {
    write(fd, ptr, len) {
      const text = readString(ptr, len);
      (fd === 2 ? stderr : stdout)(text);
    },
    // Standard input, for the standard library's js streams — see the
    // repository's patches/core/os/file_js.odin, which is in the shipped pack.
    read(fd, ptr, len) {
      if (fd !== 0) return 0;
      const count = Math.max(0, Math.min(len, inputBytes.length - inputOffset));
      if (count > 0) {
        bytes().set(inputBytes.subarray(inputOffset, inputOffset + count), ptr);
        inputOffset += count;
      }
      return count;
    },
    trap() {
      throw new JsExit(1);
    },
    abort() {
      throw new JsExit(1);
    },
    alert() {},
    // The one interop call that works without a DOM: it evaluates in the global
    // scope, so a page that embeds this can draw through it.
    evaluate(ptr, len) {
      const source = readString(ptr, len);
      (0, globalThis.eval)(source);
    },
    open() {},
    time_now: () => BigInt(Date.now()),
    tick_now: () => globalThis.performance?.now?.() ?? Date.now(),
    time_sleep() {},
    sqrt: Math.sqrt,
    sin: Math.sin,
    cos: Math.cos,
    pow: Math.pow,
    fmuladd: (x, y, z) => x * y + z,
    ln: Math.log,
    exp: Math.exp,
    ldexp: (x, exponent) => x * 2 ** exponent,
    rand_bytes(ptr, len) {
      bytes().set(globalThis.crypto.getRandomValues(new Uint8Array(len)), ptr);
    },
  };

  return {
    imports: {
      env: withFallback({}),
      odin_env: withFallback(odin_env),
      odin_dom: inertNamespace,
      webgl: inertNamespace,
      webgl2: inertNamespace,
    },
    /** The module exports its own memory, so it is set after instantiation. */
    setMemory(mem) {
      memory = mem;
    },
    args,
  };
}
