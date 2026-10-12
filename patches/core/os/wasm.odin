#+build js wasm32, js wasm64p32
package os

// Upstream's `core/os/wasm.odin` is one line — `#panic("core:os is unsupported
// on js/wasm")` — which makes importing `core:os` on the js target a compile
// error. This repository removes that guard so the js target can have a working
// `os.stdin` (see patches/core/os/file_js.odin) and back it with the page.
// Everything that is genuinely unsupported still returns `.Unsupported`.
