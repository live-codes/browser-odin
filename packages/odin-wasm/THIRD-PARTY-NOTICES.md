# Third-party notices

This package's own code is MIT (see [LICENSE](LICENSE)). What it ships and runs is other people's, and
this file records it.

## The assets in `assets/`

Built, not written here; both come from a checkout of
[**wodin**](https://github.com/karl-zylinski/wodin), the fork of
[**Odin**](https://github.com/odin-lang/Odin) that adds a direct WebAssembly backend.

- **`assets/odin.wasm`** — the Odin compiler, compiled to `wasm32-wasip1`. Odin is under the **zlib**
  license, and the module bundles what Odin's own sources do:
  - **libtommath** — public domain.
  - **utf8proc** — MIT.
  - **ucg** — MIT.
- **`assets/odin-src.pack.gz`** — Odin's standard library (`base/` and `core/`), packed. Same
  repository, same zlib license.

### Modified standard-library sources

The pack is **not** a pristine copy of Odin's standard library. Two files replace the checkout's
copies so the `js_wasm32` target can have standard input; the modified versions are reproduced in the
repository this package is developed in, under `patches/`:

- `core/os/wasm.odin` — upstream's compile-time `#panic("core:os is unsupported on js/wasm")` is removed.
- `core/os/file_js.odin` — upstream's inert stubs are kept, but `os.stdin`, `os.stdout` and
  `os.stderr` are given a real implementation over a host `odin_env.read` / `odin_env.write`.

Both are Odin source, under Odin's zlib license; the modifications are the package author's.

## Toolchain used to build the compiler

- **wasi-sdk** (clang/lld and the WASI sysroot, including wasi-libc) — Apache-2.0 WITH
  LLVM-exception; wasi-libc is separately MIT and Apache-2.0 WITH LLVM-exception.

## Runtime

Nothing else is bundled. The WASI host, the js-target host, the pack reader and the IIFE bundle are
this package's own code, and the API uses only standard globals (`WebAssembly`, `fetch`,
`DecompressionStream`, `crypto.subtle`, `TextDecoder`) — there are no runtime dependencies.
