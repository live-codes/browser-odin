#!/usr/bin/env sh
# Builds everything the POC serves into assets/:
#
#   1. odin.wasm            the Odin compiler, built as a WASI module by wodin's
#                           build_odin_wasi.sh with wasi-sdk (~3.8 MB)
#   2. odin-src.pack.gz     the standard library (base/ and core/), packed for
#                           the compiler's in-memory filesystem (~2.4 MB)
#
# Run on Linux or WSL, not Windows: it needs wasi-sdk and a POSIX shell.
#
#   WASI_SDK=/opt/wasi-sdk-33 sh scripts/build-assets.sh
#
# Variables:
#   WODIN      a checkout of https://github.com/karl-zylinski/wodin, the fork of
#              Odin with the direct wasm backend. Cloned to $HOME/wodin if absent.
#   WASI_SDK   the wasi-sdk to build with (default $HOME/wasi-sdk). Any recent
#              one does; this was built with wasi-sdk 33 (clang 22).
set -eu

REPO=$(cd "$(dirname "$0")/.." && pwd)
WODIN=${WODIN:-$HOME/wodin}
WASI_SDK=${WASI_SDK:-$HOME/wasi-sdk}

if [ ! -x "$WASI_SDK/bin/clang++" ]; then
	echo "ERROR: no wasi-sdk at $WASI_SDK (set WASI_SDK)" >&2
	exit 1
fi

if [ ! -d "$WODIN/src" ]; then
	echo "cloning wodin into $WODIN"
	git clone --depth 1 https://github.com/karl-zylinski/wodin.git "$WODIN"
fi

echo "building the compiler (odin.wasm)…"
mkdir -p "$REPO/assets"
(cd "$WODIN" && WASI_SDK="$WASI_SDK" OUT="$REPO/assets/odin.wasm" ./build_odin_wasi.sh release)

echo "packing the standard library…"
# ODIN_SRC points the packer at the same checkout the compiler came from, so the
# two always match.
ODIN_SRC="$WODIN" node "$REPO/scripts/build-assets.mjs"

echo "done:"
ls -l "$REPO/assets"
