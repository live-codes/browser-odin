# Findings

What was measured while building the POC, and what surprised us. Everything here was run, not
inferred.

## The question, and why the answer is not the Crystal one

"Run Odin in the browser with no server" needs the Odin compiler to run client-side. Odin's compiler
is a C++ program that links LLVM, so the obvious shape is the one
[browser-crystal](https://github.com/live-codes/browser-crystal) had to take: build a
libLLVM-for-wasm, then port the compiler onto it. That work is large, and it is not needed here.

**[wodin](https://github.com/karl-zylinski/wodin) is a fork of Odin with a second code generator** —
`-backend:wasm` *emits a WebAssembly module directly, with no LLVM and no linker*. With LLVM out of
the picture the compiler builds for `wasm32-wasip1` with nothing but **wasi-sdk**:

```sh
# wodin/build_odin_wasi.sh, in short:
clang++ --target=wasm32-wasip1 -std=c++14 -fno-exceptions -DODIN_NO_LLVM \
        -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_GETPID \
        src/main.cpp src/libtommath.cpp \
        -Wl,-z,stack-size=8388608 -Wl,--initial-memory=67108864 -Wl,--max-memory=4294967296 \
        -o odin.wasm
```

The result is a 3.59 MB WASI command module. **This is the finding the whole POC rests on**: Odin
already has a client-side-capable compiler, so no toolchain has to be ported. (The Karl2D playground
runs the same module, which is how the approach was found.)

## The compiler is a plain WASI module, and a small host runs it

`odin.wasm` exports `memory` and `_start` and imports exactly **24 functions**, all
`wasi_snapshot_preview1`:

```
args_get  args_sizes_get  environ_get  environ_sizes_get
clock_res_get  clock_time_get
fd_close  fd_fdstat_get  fd_filestat_get  fd_filestat_set_size
fd_pread  fd_prestat_get  fd_prestat_dir_name  fd_pwrite  fd_read  fd_readdir  fd_seek  fd_write
path_create_directory  path_filestat_get  path_open  path_remove_directory  path_unlink_file
proc_exit
```

No filesystem syscalls beyond create/open/read/write/readdir; no sockets, no clocks beyond the two,
no threads. `public/wasi.js` implements these over an in-memory file system in about 400 lines, and
runs it with `new WebAssembly.Instance` + `_start()`. **No `SharedArrayBuffer` is involved** — the
module is single-threaded and synchronous, so a page embedding it needs no cross-origin isolation.

## The compiler needs three collections, not two

The first run failed with:

```
Internal Compiler Error: Cannot find the library collection 'vendor'. Is the ODIN_ROOT set up correctly?
```

Odin registers the `base`, `core` **and `vendor`** collections from directories under `ODIN_ROOT`,
and it insists all three exist before it will compile anything. `vendor/` is 91 MB (DirectX, SDL,
GLFW, box2d, …) and none of it is needed for a text program, so the POC ships it **empty**: the
collection resolves, and a program that does not import a `vendor:` package is unaffected.

## The compiled program imports more than the compiler does

The compiler's 24 imports are not the program's. The first program run failed to instantiate:

```
LinkError: Import #7 "wasi_snapshot_preview1" "fd_sync": function import requires a callable
```

A `wasi_wasm32` program imports 14 functions — the compiler's set plus `random_get`, `fd_sync`,
`fd_pread`/`fd_pwrite` (this first turned up while the compiler was running, which is why they were
implemented before the program ran at all). The shim now implements the whole WASI preview 1 surface,
with the parts nothing here uses returning `ENOSYS`, so a slightly different program cannot turn a
missing import into an opaque link error.

## Two things about Odin's standard library, learned from the samples

- **`bufio.reader_read_string` returns `(string, io.Error)` and keeps the delimiter.** `io.Error` is
  an enum (`None`, `EOF`, …) compared with `nil`, not a `bool` — the sample that assumed a
  `(string, bool)` did not compile. And because the delimiter is included, trimming must remove
  `\n`; `strings.trim_space` does, a hand-rolled space/`\t`/`\r` trim does not (the symptom was
  "0 numbers, sum 0" with no error at all).
- **`os.stdin` works on `wasi_wasm32`** — `core/os/file_wasi.odin` maps fds 0/1/2 through the same
  `fd_read`/`fd_write` the shim provides, so a program reads the page's stdin box with no extra host
  support.

## The JS target, and calling into the page

`js_wasm32` is a different *runtime*, not a different front end: the same compiler module with a
different `-target`. The program then runs on **Odin's own JS runtime** —
`core/sys/wasm/js/odin.js`, vendored as `public/odin.js`. That runtime supplies the imports a
`js_wasm32` module asks for (`env`, `odin_env`, `odin_dom`, `webgl`, `webgl2`) and gives the Odin
program three things worth naming:

- **`odin_env.write`** carries `fmt` output, so `fmt.println` lands in the page's output pane.
- **`odin_env.evaluate`** is exposed to Odin as `js.evaluate` — a direct call from Odin into the
  page's JavaScript, which is what the canvas sample draws through.
- **An exported `step(dt, ctx) -> bool`** is driven once per `requestAnimationFrame`, with the canvas
  shown; the page keeps a generation counter so a new Run stops the previous loop.

One thing easy to miss: **a `js_wasm32` program needs an entry point even if it only exports
`step`.** Compiling the step-only version failed with

```
/src/main.odin(1:1) Error: Undefined entry point procedure 'main'
```

so the sample carries a `main` (run through `_start` before the loop begins). `-no-entry-point` is
the other way out, but then `_start` does not exist and the runtime's boot step is skipped.

The canvas sample is the interop proof: `main` prints once, `step` runs every frame, and each frame
calls `js.evaluate` with a small script that reads `performance.now()` and draws — verified in
headless Chrome (`docs/poc-js.png`), where the frames print once a second and the canvas shows the
drawn mark.

## Sizes and timings

| | |
| --- | --- |
| `odin.wasm` | 3.59 MB (3,763,439 bytes), built `--release` |
| `odin-src.pack.gz` | 2.39 MB gzipped, from 10.57 MiB raw — 1071 files of `base/` + `core/` |
| payload, on the wire | ~6 MB, once, then cached |
| first compile after load | ~1.1 s (headless Chrome) |
| warm compile | 0.5–0.6 s |
| run | 2–7 ms |

Every compile is a fresh instance of the compiler module (a WASI command module has one life), on a
file system holding the shared standard library; the produced module then runs on a fresh, empty one.
The compiler instance costs about half a second; the module keeps its compiled JIT across runs.

## What the browser adds over Node

`npm test` compiles and runs every runnable sample in Node using the same `public/wasi.js` the page
uses, so the compile/run path was never validated only in a browser. The browser-specific parts are
the module Worker, `WebAssembly.compileStreaming` (needs `application/wasm`), and
`DecompressionStream` for the pack — all standard, and all exercised by the headless runs that
produced `docs/poc.png` and `docs/poc-js.png`.

A `js_wasm32` program cannot be run under Node: its runtime wants a DOM. `npm test` therefore only
checks that such a sample *compiles*, and the browser run is the proof that it runs.
