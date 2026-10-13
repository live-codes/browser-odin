# @live-codes/odin-wasm

Run **Odin** in a browser with no server, through one API — on the Odin compiler compiled to
WebAssembly. The assets ship inside the package, so there is no toolchain to install.

```js
import { createCompiler } from '@live-codes/odin-wasm';

const compiler = await createCompiler();

const { stdout, stderr, output, errors, exitCode } = await compiler.run(`
    package main

    import "core:fmt"

    main :: proc() {
        fmt.println("Hellope!")
    }
`);

console.log(output);   // "Hellope!\n" - stdout and stderr in the order the program wrote them
console.log(exitCode); // 0
```

That is Node, where the packaged assets can be read off disk. **In a browser there is no filesystem**,
so a page has to be given a URL — copy the assets into whatever serves your page and pass it:

```bash
npx --package @live-codes/odin-wasm odin-wasm-copy-assets public/odin
```

```js
const compiler = await createCompiler({ baseUrl: new URL('/odin/', location.href) });
```

## How it works

The compiler is a WASI command module, built by
[wodin](https://github.com/karl-zylinski/wodin) — the fork of Odin with a **direct WebAssembly
backend**, which emits wasm with no LLVM and no linker, and is what makes a browser-sized compiler
possible. The standard library is a single gzipped container the package reads into an in-memory file
system; the compiler never touches disk.

```
your Odin source
  → odin.wasm   the compiler (a WASI module)                         → a wasm module
  → run it      wasi_wasm32: a WASI host, in this package
                js_wasm32:   the browser's DOM/canvas, through Odin's JS runtime   → stdout / page
```

## API

### `createCompiler(options)`

Returns a promise for a compiler. The heavy part — the compiler module and the packed standard
library, about 6 MB — is fetched here, so a bad `baseUrl` fails at this point rather than at the first
`run`. Compilers created against the same assets share one engine.

| Option | Meaning |
| --- | --- |
| `baseUrl` | Where the assets are served from. **Optional in Node**, where omitting it uses the files the package ships; required anywhere else, and absolute http(s) except in a browser, where it may be relative to the page. |
| `target` | `wasi_wasm32` (default) or `js_wasm32`. See [Targets](#targets). |
| `args` | Default program argv. |
| `compileArgs` | Extra compiler flags. |
| `fileName` | The name the source is compiled under. |
| `onProgress` | `({ name, loaded, total }) => {}` while the assets download. |

### `compiler.run(code, input, runOptions?)`

Compiles and runs. `input` is stdin as a string or `Uint8Array`, handed to the program once.
`runOptions` may override `target`, `args`, `compileArgs` and `fileName` for that run.

| Field | Meaning |
| --- | --- |
| `stdout` | Everything the program wrote to fd 1. |
| `stderr` | Everything it wrote to fd 2. |
| `output` | Both, in the order the program wrote them. |
| `errors` | The compiler's diagnostics, one string per line. **Empty when the program compiled.** |
| `exitCode` | The program's exit status, or `null` if it never ran because it did not compile. |
| `compileMs` | Wall clock for the compile. |
| `runMs` | Wall clock for the run, or `null` if it did not run. |

`errors` is empty on success so that `errors.length` is a reliable failure test. On failure it holds
what the compiler said, and if the compiler said nothing it holds the underlying error's message, so a
failure is never silent.

### `compiler.compile(code, options?)`

Compiles without running, for a host that runs the module itself. A page that needs the DOM cannot use
`run`: a worker has no `document`, and Odin's JS runtime is written for the page, so the module has to
be instantiated on the main thread. This hands it over.

| Field | Meaning |
| --- | --- |
| `ok` | Whether the program compiled. |
| `wasm` | The module (a `Uint8Array`), or `null` if it did not compile. |
| `errors` | The compiler's diagnostics, one string per line. |
| `compileMs` | Wall clock for the compile. |

```js
const { ok, wasm, errors } = await compiler.compile(source, { target: 'js_wasm32' });
```

`assets/odin.js` is Odin's own JS runtime — what such a module runs on. `importScripts` it, then
instantiate with `odin.setupDefaultImports(...)`, as the [demo page](https://github.com/live-codes/browser-odin)
does; the program then reaches the DOM and a canvas.

### `compiler.dispose()`

Drops this compiler's hold on the shared engine. Further runs throw.

### `TARGETS`

The two targets, for building a picker: `['wasi_wasm32', 'js_wasm32']`.

## Targets

| target | runs on | what it reaches |
| --- | --- | --- |
| `wasi_wasm32` (default) | a WASI host in this package | `core:fmt`, **stdin**, `os.args`, exit codes — and it works in Node |
| `js_wasm32` | the Odin JS runtime, which a page provides | `core:fmt`, **stdin**, the DOM and a `<canvas>` |

`js_wasm32` is the browser target: a page runs it with Odin's own `odin.js` so the program can reach
the DOM and a canvas. Outside a page there is no DOM, so this package gives it a host that supports
the console, stdin and `js.evaluate` and stubs the rest — enough to run and test a console program,
and to draw through `js.evaluate` when a page embeds it.

Standard input works on **both**, which is not a given: upstream's `core:os` is deliberately inert on
the js target (a compile-time `#panic("core:os is unsupported on js/wasm")`), so the standard library
that ships here carries two small patches that give it a real `os.stdin` over the host's
`odin_env.read`. See the repository's `FINDINGS.md`.

## Loading it without a bundler

`dist/odin-wasm.global.js` is a **minified IIFE bundle** — one classic script, 16.5 KB — for anywhere
an ES module cannot go: a classic (non-module) worker, a plain `<script>`, a CDN URL handed to
`importScripts()`. It sets `self.odinWasm` to the same two exports (`createCompiler`, `TARGETS`).

```js
// worker.js - a classic worker: no { type: 'module' }, no imports
importScripts('odin-wasm.global.js');

const compiler = await self.odinWasm.createCompiler({ baseUrl: '/odin/' });
const { stdout, exitCode } = await compiler.run('package main\n\nimport "core:fmt"\n\nmain :: proc() { fmt.println("hi") }\n');
```

It is reachable as `@live-codes/odin-wasm/iife`, and it is committed rather than built on install, so
a consumer never needs esbuild. Rebuild it with `npm run build:iife`.

## Where the assets come from

```
assets/odin.wasm          3.6 MB   the compiler (a WASI module, built with wasi-sdk)
assets/odin-src.pack.gz   2.4 MB   Odin's base/ and core/, gzipped
assets/odin.js             72 KB   Odin's own JS runtime, for running a js_wasm32 module on a page
```

Three ways to reach them:

- **In Node, nothing.** Omit `baseUrl` and the package reads those files directly.
- **In a browser, one command.** `odin-wasm-copy-assets <dir>` writes them into a directory you
  already serve, plus an `asset-receipts.json` describing its own bytes.
- **Or point `baseUrl` at a host you already have** — a CDN, an S3 bucket — serving those two paths.

Every asset is checked against a pinned SHA-256 receipt (`src/asset-receipts.js`) before it is used,
so a truncated download or a host serving something else is an error rather than a wasm
instantiation failure a step later.

The pack is Odin's standard library with `core/rexcode` (the machine-code library, tens of MB of
binaries) and other-target assembly left out. The `vendor` collection is **not** shipped: the compiler
requires the directory to exist, so it is present and empty, but a program that imports a `vendor:`
package will not find it.

## What does not work

| | why |
| --- | --- |
| **`vendor:` packages** (`vendor:raylib`, …) | not shipped: 91 MB, mostly DirectX/SDL and C libraries with prebuilt wasm objects |
| **the DOM through `run()`** | a worker — and Node — have no `document`. Use `compile()` and instantiate on a page with `assets/odin.js`; that is what the LiveCodes result page does |
| **`js_wasm32` exit codes** | Odin's js runtime exits by trapping, so a program's status is reported as 1 rather than the number it passed |
| **threads, files, sockets** | WASI preview 1 here is single-threaded, and a program is given an empty filesystem |
| **a runaway program** | the compiler and the program both run synchronously; there is no cancellation |

## Development

```bash
npm test          # 17 checks: both targets, stdin, args, exit codes, diagnostics, the bundle, the receipts
npm run check-package # what `prepack` runs: every asset hashes to its receipt and the bundle is present
npm run sync-assets   # copy ../../assets into this package and re-pin the receipts
npm run build:iife    # rebuild dist/ (needs esbuild; `npm install --include=dev`)
```

`src/wasi-host.js` is the same WASI host as the demo repository's `public/wasi.js`, carried here so
the package stands alone; the two are kept in step by hand.

The tests run against the packaged assets with no server. `test/iife.test.js` loads the committed
bundle in a `vm` context and checks its shape, so the shipped file cannot rot unnoticed.

## License

**MIT.** The compiler module and the packed standard library are Odin's, under its **zlib** license —
see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), which also records the two standard-library
files this package ships modified.
