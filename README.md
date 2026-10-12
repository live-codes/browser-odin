# browser-odin

Run **Odin in a browser tab with no server**. Edit Odin, press Run, and the compiler —
`odin.wasm`, an Odin compiler compiled to a WASI module — compiles your program *in the tab* and
runs the result. Nothing is uploaded, and no share of the work happens off the page.

```
your Odin source
  → odin.wasm   the Odin compiler (wodin's direct wasm backend), a WASI module   → a wasm module
  → run it      wasi_wasm32: under the page's WASI shim (public/wasi.js)
                js_wasm32:   under the Odin JS runtime (public/odin.js)         → output / canvas
```

This is a proof of concept for adding Odin to [LiveCodes](https://livecodes.io), in the shape of the
sibling repositories for [Crystal](https://github.com/live-codes/browser-crystal),
[Swift](https://github.com/live-codes/browser-swift) and
[Clang](https://github.com/live-codes/clang-wasm).

## No server, and no `SharedArrayBuffer`

Everything runs on one thread: the compiler is a synchronous WASI command module, so a page that
embeds it needs **no cross-origin isolation** — no `COOP`/`COEP` headers, no
`SharedArrayBuffer`. It drops into an ordinary embedded playground. (`serve.mjs` sends no such
headers, and the page runs with `crossOriginIsolated === false`.)

## Run it

```bash
npm run assets   # once — build odin.wasm and pack the standard library (Linux or WSL)
npm start        # → http://localhost:8144/
```

`npm run assets` needs [wodin](https://github.com/karl-zylinski/wodin) (the fork of Odin with a
direct wasm backend) and [wasi-sdk](https://github.com/WebAssembly/wasi-sdk); see
[Building the assets](#building-the-assets). Without them the page loads and reports what is
missing. Once the assets exist, any static file server works — nothing is compiled on the server,
and the page only fetches static files.

A static server *is* required (ES modules and Workers do not load over `file://`), and it must
serve `odin.wasm` as `application/wasm`, without which `WebAssembly.compileStreaming` refuses the
response. `serve.mjs` does both.

## The page

| file | what it is |
| --- | --- |
| `public/index.html` | the page: editor, target, Run, stdin, canvas, output and diagnostics |
| `public/app.js` | the page's logic; spawns the worker and runs the compiled module |
| `public/compile-worker.js` | the compile worker: drives `odin.wasm` and returns the module |
| `public/wasi.js` | a WASI preview 1 host over an in-memory file system (no SAB) |
| `public/odin.js` | Odin's own JS runtime — what a `js_wasm32` program runs on (defines `window.odin`) |
| `public/samples.js` | the sample programs, shared with the test |
| `patches/` | the standard-library files the pack replaces, so the js target has stdin |
| `assets/` | `odin.wasm` and `odin-src.pack.gz` — built and committed |

The page is a thin shell. The worker only *compiles*; running is the page's job, because a
`js_wasm32` program needs the DOM and the canvas, which live on the main thread. `public/wasi.js`
and `public/odin.js` are the two runtimes — the first with no browser API in it at all, the second
Odin's.

## Targets

The compiler emits for a target that the page then runs:

| target | runs on | what it reaches |
| --- | --- | --- |
| `wasi_wasm32` (default) | `public/wasi.js`, an in-memory file system | `core:fmt`, files, **stdin**; the output is captured |
| `js_wasm32` | `public/odin.js` | `core:fmt` to the output pane, **stdin**, the DOM, and a `<canvas>` |

So the js target has both standard input and the browser surface — the samples are not tied to one
target. Standard input is *not* part of upstream's js target: `core:os` is a compile-time
`#panic("core:os is unsupported on js/wasm")`. This repository therefore ships two small standard
library patches, applied when the pack is built (`patches/`): the guard is removed, and `os.stdin`
is wired to a host `odin_env.read` that the page fills from the stdin box. See
[FINDINGS.md](FINDINGS.md#standard-input-on-the-js-target).

A `js_wasm32` program that exports

```odin
@(export)
step :: proc(dt: f64, _: rawptr) -> bool { … }
```

is driven once per animation frame and the canvas is shown; anything else runs once at `_start`.
The **canvas animation** sample shows both: it draws on the canvas by calling the page's JavaScript
through `js.evaluate`, which is a direct Odin-to-JS call, and prints a line a second through `fmt`.

## What works

Verified in a real browser (`crossOriginIsolated === false`) and in Node (`npm test`):

- **Compiling and running what you type**, in the tab — `core:fmt`, loops, slices and `core:slice`,
  structs, procedures, and reading **standard input** (on either target).
- **JS interop and a canvas** — a `js_wasm32` program calls into the page's JavaScript
  (`js.evaluate`) and draws, animated by an exported `step`.
- **Diagnostics** with a file, line, column and a caret, instead of a bare exit code.
- Six samples plus a deliberate type error, all checked by `npm test`.

Measured on this machine (headless Chrome, Node 24): the first compile after the page loads is
~1.1 s; later compiles are 0.5–0.6 s, and a program runs in single-digit milliseconds. The compiler
module is 3.59 MB and the compressed standard library is 2.39 MB — about **6 MB on the wire**, once,
and cached after that.

## What does not work

| | why |
| --- | --- |
| **The `vendor` collection** (`vendor:raylib`, …) | not shipped: 91 MB, mostly DirectX/SDL and C libraries with prebuilt wasm objects. The collection resolves (empty), so simple programs work; a program that imports a `vendor:` package fails to find it |
| **`freestanding_wasm32`** | the compiler emits it, but the page only knows how to run `wasi_wasm32` and `js_wasm32` |
| **Files on `js_wasm32`** | only the three standard streams are implemented (see `patches/`); `os.open` and the rest still return `.Unsupported` |
| **Stopping a runaway program** | a program that loops forever blocks the tab — both runtimes run synchronously on the main thread |
| **Threads, files, sockets** in a compiled program | WASI preview 1 here is single-threaded, and a program is given an empty file system |
| **Pinning the standard library version** | the pack is built from a wodin checkout; a compiler rebuilt from a different commit wants a matching pack — `build-assets.sh` builds both from the same checkout |

## Building the assets

The two assets are **committed**, so the page can be served with no build step. To rebuild them, the
whole pipeline is in `scripts/build-assets.sh`, run on Linux or WSL:

```bash
WASI_SDK=/opt/wasi-sdk-33 sh scripts/build-assets.sh
```

1. **`odin.wasm`** — `wodin`'s `build_odin_wasi.sh` compiles the Odin compiler to
   `wasm32-wasip1` with wasi-sdk, `-DODIN_NO_LLVM`: the direct wasm backend emits wasm itself, so
   **no LLVM and no linker are involved**. That is what makes a ~3.8 MB compiler and a browser-sized
   build possible at all.
2. **`odin-src.pack.gz`** — `scripts/build-assets.mjs` packs `base/` and `core/` from the same
   checkout into one gzipped container (a small binary format, `ODINPOC1`), which the worker
   inflates with `DecompressionStream`. `core/rexcode` (the machine-code library, tens of MB of
   binaries) and other-target assembly are left out. Files under `patches/`, mirroring their path in
   the checkout, replace the checkout's copy as it packs — that is what gives the js target standard
   input.

Point `ODIN_SRC` at any wodin (or Odin) checkout to run the packer alone:
`ODIN_SRC=/path/to/wodin node scripts/build-assets.mjs`.

## Verifying

| what | command |
| --- | --- |
| compile → run every sample under Node, with stdin and a compile error | `npm test` |
| syntax-check the server, the page, the worker and the scripts | `npm run check` |
| rebuild the assets | `sh scripts/build-assets.sh` |

`npm test` is the one that matters: `public/wasi.js` has no browser-only API, so the whole chain runs
in Node against the same assets the page fetches. What the browser adds is asset loading and the
worker.

## Licensing and provenance

MIT for the code here. The compiler module is Odin's, and Odin is **zlib**-licensed
([odin-lang/Odin](https://github.com/odin-lang/Odin)); the fork it is built from,
[karl-zylinski/wodin](https://github.com/karl-zylinski/wodin), adds the wasm backend. wasi-sdk is
Apache-2.0 WITH LLVM-exception. The compiler module embeds Odin's runtime and standard library. See
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Status

A working proof of concept: the Odin compiler runs in the page and compiles what you type, and the
result runs — as a `wasi_wasm32` console program or a `js_wasm32` one that reaches the DOM and a
canvas — with no server and no `SharedArrayBuffer`. [FINDINGS.md](FINDINGS.md) is what was measured
and what surprised us; the natural next step is wiring it into LiveCodes as a `odin` language, and
widening the shipped standard library to the `vendor` packages a browser actually needs.
