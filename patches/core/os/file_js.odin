#+build js wasm32, js wasm64p32
#+private
package os

// Upstream's `core:os` is deliberately inert on js/wasm ("None of this does
// anything on js/wasm"): `os.stdin` stays nil and no stream reads anything, so a
// browser program cannot read its standard input. Everything here is upstream's
// stub except the three standard streams, which are given a real implementation
// backed by the host's `odin_env.read`/`odin_env.write` (public/odin.js).
//
// The point is that one target then has both standard input and the DOM/canvas:
// `os.stdin` and `core:bufio` read the page's stdin, while `core:sys/wasm/js`
// (which is js-only) drives the page. This repository applies this file when it
// packs the standard library; see scripts/build-assets.mjs and FINDINGS.md.

import "base:runtime"
import "core:io"
import "core:time"

foreign import odin_env "odin_env"

@(default_calling_convention="contextless")
foreign odin_env {
	// Fills `p` with stdin bytes; returns how many, 0 at end of input.
	// (Named `_env_*` so they do not clash with `core:os`'s own `read`/`write`;
	// the link names are what the host sees.)
	@(link_name="read")
	_env_read  :: proc(fd: u32, p: []byte) -> int ---
	@(link_name="write")
	_env_write :: proc(fd: u32, p: []byte) ---
}

File_Impl :: struct {
	file: File,
	fd:   u32,
	name: string,
}

@(init)
init_std_files :: proc "contextless" () {
	new_std :: proc "contextless" (impl: ^File_Impl, fd: u32, name: string) -> ^File {
		impl.file.impl = impl
		impl.fd = fd
		impl.name = name
		impl.file.stream = {
			data      = impl,
			procedure = _file_stream_proc,
		}
		return &impl.file
	}

	@(static) files: [3]File_Impl
	stdin  = new_std(&files[0], 0, "/dev/stdin")
	stdout = new_std(&files[1], 1, "/dev/stdout")
	stderr = new_std(&files[2], 2, "/dev/stderr")
}

_open :: proc(name: string, flags: File_Flags, perm: Permissions) -> (f: ^File, err: Error) {
	return nil, .Unsupported
}

_new_file :: proc(handle: uintptr, name: string, allocator: runtime.Allocator) -> (f: ^File, err: Error) {
	return nil, .Unsupported
}

_clone :: proc(f: ^File) -> (clone: ^File, err: Error) {
	return nil, .Unsupported
}

_close :: proc(f: ^File_Impl) -> (err: Error) {
	return .Unsupported
}

_fd :: proc(f: ^File) -> uintptr {
	return 0
}

_is_tty :: proc "contextless" (f: ^File) -> bool {
	return true
}

_name :: proc(f: ^File) -> string {
	return ""
}

_sync :: proc(f: ^File) -> Error {
	return .Unsupported
}

_truncate :: proc(f: ^File, size: i64) -> Error {
	return .Unsupported
}

_remove :: proc(name: string) -> Error {
	return .Unsupported
}

_rename :: proc(old_path, new_path: string) -> Error {
	return .Unsupported
}

_link :: proc(old_name, new_name: string) -> Error {
	return .Unsupported
}

_symlink :: proc(old_name, new_name: string) -> Error {
	return .Unsupported
}

_read_link :: proc(name: string, allocator: runtime.Allocator) -> (s: string, err: Error) {
	return "", .Unsupported
}

_chdir :: proc(name: string) -> Error {
	return .Unsupported
}

_fchdir :: proc(f: ^File) -> Error {
	return .Unsupported
}

_fchmod :: proc(f: ^File, mode: Permissions) -> Error {
	return .Unsupported
}

_chmod :: proc(name: string, mode: Permissions) -> Error {
	return .Unsupported
}

_fchown :: proc(f: ^File, uid, gid: int) -> Error {
	return .Unsupported
}

_chown :: proc(name: string, uid, gid: int) -> Error {
	return .Unsupported
}

_lchown :: proc(name: string, uid, gid: int) -> Error {
	return .Unsupported
}

_chtimes :: proc(name: string, atime, mtime: time.Time) -> Error {
	return .Unsupported
}

_fchtimes :: proc(f: ^File, atime, mtime: time.Time) -> Error {
	return .Unsupported
}

_exists :: proc(path: string) -> bool {
	return false
}

_file_stream_proc :: proc(stream_data: rawptr, mode: File_Stream_Mode, p: []byte, offset: i64, whence: io.Seek_From, allocator: runtime.Allocator) -> (n: i64, err: Error) {
	f := (^File_Impl)(stream_data)

	switch mode {
	case .Read:
		if len(p) <= 0 {
			return
		}
		n = i64(_env_read(f.fd, p))
		if n == 0 {
			err = .EOF
		}
		return

	case .Write:
		if len(p) > 0 {
			_env_write(f.fd, p)
		}
		return i64(len(p)), nil

	case .Flush, .Close, .Destroy:
		return

	case .Query:
		return io.query_utility({.Read, .Write, .Flush, .Close, .Destroy, .Query})

	case .Read_At, .Write_At, .Seek, .Size, .Fstat:
		return 0, .Unsupported

	case:
		return 0, .Unsupported
	}
}
