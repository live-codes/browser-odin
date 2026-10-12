# Third-party notices

This repository's own code is MIT (see [LICENSE](LICENSE)). What it *builds* and *runs* is other
people's, and this file records it.

## The compiler module (`assets/odin.wasm`) and the packed sources (`assets/odin-src.pack.gz`)

Built, not committed; both come from a checkout of
[**wodin**](https://github.com/karl-zylinski/wodin), the fork of
[**Odin**](https://github.com/odin-lang/Odin) that adds a direct WebAssembly backend.

- **Odin** — the compiler and the standard library (`base/`, `core/`). Licensed under the **zlib**
  license.
- **wodin** — the fork (the wasm backend and the WASI build script). Same repository, same license.
- Bundled inside the compiler's own sources and therefore inside `odin.wasm`:
  - **libtommath** — public domain.
  - **utf8proc** — MIT.
  - **ucg** — MIT.

The compiler module embeds Odin's runtime and the standard library; the packed `odin-src.pack.gz`
*is* the standard library (Odin's `base/` and `core/`), so a program compiled in the page is compiled
against Odin's own sources, under the same zlib license.

## Vendored runtime code

- **`public/odin.js`** — Odin's own JS runtime, copied from
  `core/sys/wasm/js/odin.js` of the same wodin checkout. It is what a `js_wasm32` program runs on
  (it defines `window.odin` and the default imports). Part of Odin, under the zlib license.

## Toolchain used to build it

- **wasi-sdk** (clang/lld and the WASI sysroot, including wasi-libc) — Apache-2.0 WITH
  LLVM-exception; wasi-libc is separately MIT and Apache-2.0 WITH LLVM-exception.

Nothing else is bundled. There are no runtime dependencies: the page, the worker and the WASI shim
are plain browser APIs (`WebAssembly`, `DecompressionStream`, `fetch`, `Worker`), and the Node
scripts use only Node built-ins.
