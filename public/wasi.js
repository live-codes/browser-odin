// A minimal WASI preview 1 host over an in-memory file system — enough to run
// the Odin compiler (odin.wasm) and the programs it produces, in a page.
//
// Only what Odin actually uses is implemented; everything else returns
// ENOSYS. There is no SharedArrayBuffer anywhere, so a page that embeds this
// needs no cross-origin isolation (no COOP/COEP).
//
// The file system is a flat map of absolute paths. The single preopened
// directory is the root ("/"), so the compiler sees "/odin/base/...",
// "/src/main.odin" and the program it compiles sees "/out/main.wasm".

const ESUCCESS = 0;
const EBADF = 8;
const EEXIST = 20;
const EINVAL = 28;
const EIO = 29;
const EISDIR = 31;
const ENOENT = 44;
const ENOTDIR = 54;
const ENOTEMPTY = 55;
const ENOSYS = 52;

const FILETYPE_UNKNOWN = 0;
const FILETYPE_CHARACTER_DEVICE = 2;
const FILETYPE_DIRECTORY = 3;
const FILETYPE_REGULAR_FILE = 4;

const OFLAGS_CREAT = 1;
const OFLAGS_DIRECTORY = 2;
const OFLAGS_EXCL = 4;
const OFLAGS_TRUNC = 8;

const FDFLAGS_APPEND = 1;

export class WasiExit extends Error {
  constructor(code) {
    super(`WASI process exited with code ${code}`);
    this.code = code;
  }
}

// Paths are normalised: no leading or trailing slash; the root is "".
export const normalizePath = (path) => {
  const out = [];
  for (const part of String(path).split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
};

const parentPath = (path) => {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** An in-memory, flat file system rooted at "/". */
export class WasiFileSystem {
  constructor() {
    this.files = new Map(); // path -> { data: Uint8Array, size: number }
    this.dirs = new Set(['']);
  }

  mkdirAll(path) {
    const parts = normalizePath(path) === '' ? [] : normalizePath(path).split('/');
    let cur = '';
    for (const part of parts) {
      cur = cur === '' ? part : `${cur}/${part}`;
      this.dirs.add(cur);
    }
  }

  writeFile(path, bytes) {
    const p = normalizePath(path);
    this.mkdirAll(parentPath(p));
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.files.set(p, { data, size: data.length });
  }

  readFile(path) {
    const f = this.files.get(normalizePath(path));
    return f ? f.data.subarray(0, f.size) : null;
  }

  exists(path) {
    const p = normalizePath(path);
    return this.files.has(p) || this.dirs.has(p);
  }

  /** Files and subdirectories directly under `path`, sorted by name. */
  listDir(path) {
    const p = normalizePath(path);
    const prefix = p === '' ? '' : `${p}/`;
    const entries = [];
    for (const d of this.dirs) {
      if (d !== '' && d.startsWith(prefix) && d.indexOf('/', prefix.length) < 0 && d !== p) {
        entries.push({ name: d.slice(prefix.length), isDir: true });
      }
    }
    for (const f of this.files.keys()) {
      if (f.startsWith(prefix) && f.indexOf('/', prefix.length) < 0) {
        entries.push({ name: f.slice(prefix.length), isDir: false });
      }
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return entries;
  }
}

const toUint8 = (data) => (data instanceof Uint8Array ? data : new Uint8Array(data));

/**
 * @param {WasiFileSystem} fs
 * @param {object} [options]
 * @param {string[]} [options.args]   argv (argv[0] is the program name)
 * @param {string[]} [options.env]    "KEY=VALUE" entries
 * @param {string} [options.stdin]    the finite standard input
 * @param {(text: string) => void} [options.stdout]
 * @param {(text: string) => void} [options.stderr]
 */
export const createWasi = (fs, options = {}) => {
  const args = options.args ?? [];
  const env = options.env ?? [];
  const stdout = options.stdout ?? (() => {});
  const stderr = options.stderr ?? (() => {});

  const stdin = toUint8(encoder.encode(options.stdin ?? ''));
  let stdinOffset = 0;

  const fds = new Map();
  let nextFd = 4;
  fds.set(0, { kind: 'stdin' });
  fds.set(1, { kind: 'stdout' });
  fds.set(2, { kind: 'stderr' });
  fds.set(3, { kind: 'dir', path: '' });

  // The compiler prints diagnostics in pieces; hold partial lines and emit
  // whole lines, flushing any remainder when the run ends.
  const lineBuffers = ['', '', ''];

  let memory = null;
  const bytes = () => new Uint8Array(memory.buffer);
  const view = () => new DataView(memory.buffer);
  const readString = (ptr, len) => decoder.decode(bytes().subarray(ptr, ptr + len));

  const writeStd = (fd, text) => {
    let buf = lineBuffers[fd] + text;
    const i = buf.lastIndexOf('\n');
    if (i >= 0) {
      (fd === 1 ? stdout : stderr)(buf.slice(0, i + 1));
      buf = buf.slice(i + 1);
    }
    lineBuffers[fd] = buf;
  };
  const flush = () => {
    for (const fd of [1, 2]) {
      if (lineBuffers[fd] !== '') {
        (fd === 1 ? stdout : stderr)(lineBuffers[fd]);
        lineBuffers[fd] = '';
      }
    }
  };

  const writeFilestat = (buf, filetype, size) => {
    const v = view();
    v.setBigUint64(buf + 0, 0n, true); // dev
    v.setBigUint64(buf + 8, 0n, true); // ino
    v.setUint8(buf + 16, filetype);
    v.setBigUint64(buf + 24, 1n, true); // nlink
    v.setBigUint64(buf + 32, BigInt(size), true);
    v.setBigUint64(buf + 40, 0n, true); // atim
    v.setBigUint64(buf + 48, 0n, true); // mtim
    v.setBigUint64(buf + 56, 0n, true); // ctim
  };

  const statPath = (path, buf) => {
    if (fs.dirs.has(path)) {
      writeFilestat(buf, FILETYPE_DIRECTORY, 0);
      return ESUCCESS;
    }
    const f = fs.files.get(path);
    if (f) {
      writeFilestat(buf, FILETYPE_REGULAR_FILE, f.size);
      return ESUCCESS;
    }
    return ENOENT;
  };

  const grow = (f, size) => {
    if (size <= f.data.length) return;
    let cap = Math.max(f.data.length * 2, 4096);
    while (cap < size) cap *= 2;
    const data = new Uint8Array(cap);
    data.set(f.data.subarray(0, f.size));
    f.data = data;
  };

  const readIovs = (f, iovs, iovsLen, offset) => {
    const v = view();
    const mem = bytes();
    let total = 0;
    for (let i = 0; i < iovsLen; i++) {
      const ptr = v.getUint32(iovs + i * 8, true);
      const len = v.getUint32(iovs + i * 8 + 4, true);
      const n = Math.max(0, Math.min(len, f.size - offset));
      mem.set(f.data.subarray(offset, offset + n), ptr);
      offset += n;
      total += n;
      if (n < len) break;
    }
    return total;
  };

  const writeIovs = (f, iovs, iovsLen, offset) => {
    const v = view();
    const mem = bytes();
    let total = 0;
    for (let i = 0; i < iovsLen; i++) {
      const ptr = v.getUint32(iovs + i * 8, true);
      const len = v.getUint32(iovs + i * 8 + 4, true);
      grow(f, offset + len);
      f.data.set(mem.subarray(ptr, ptr + len), offset);
      offset += len;
      f.size = Math.max(f.size, offset);
      total += len;
    }
    return total;
  };

  const writeStringList = (list, ptrs, buf) => {
    const v = view();
    const mem = bytes();
    let pos = buf;
    for (let i = 0; i < list.length; i++) {
      const b = encoder.encode(list[i]);
      v.setUint32(ptrs + i * 4, pos, true);
      mem.set(b, pos);
      mem[pos + b.length] = 0;
      pos += b.length + 1;
    }
    return ESUCCESS;
  };

  const resolvePath = (dirFd, ptr, len) => {
    const d = fds.get(dirFd);
    if (!d || d.kind !== 'dir') return null;
    const rel = readString(ptr, len);
    return normalizePath(rel.startsWith('/') ? rel : `${d.path}/${rel}`);
  };

  const imports = {
    args_sizes_get(argcPtr, bufSizePtr) {
      const v = view();
      v.setUint32(argcPtr, args.length, true);
      v.setUint32(bufSizePtr, args.reduce((n, a) => n + encoder.encode(a).length + 1, 0), true);
      return ESUCCESS;
    },
    args_get(argvPtr, argvBuf) {
      return writeStringList(args, argvPtr, argvBuf);
    },
    environ_sizes_get(countPtr, bufSizePtr) {
      const v = view();
      v.setUint32(countPtr, env.length, true);
      v.setUint32(bufSizePtr, env.reduce((n, e) => n + encoder.encode(e).length + 1, 0), true);
      return ESUCCESS;
    },
    environ_get(envPtr, envBuf) {
      return writeStringList(env, envPtr, envBuf);
    },
    clock_res_get(id, resPtr) {
      view().setBigUint64(resPtr, 1000n, true);
      return ESUCCESS;
    },
    clock_time_get(id, precision, timePtr) {
      // 0 = realtime (since the epoch), 1 = monotonic (process start)
      const ns = id === 0
        ? BigInt(Date.now()) * 1000000n
        : BigInt(Math.round((globalThis.performance?.now() ?? Date.now()) * 1000)) * 1000n;
      view().setBigUint64(timePtr, ns, true);
      return ESUCCESS;
    },
    fd_close(fd) {
      if (!fds.has(fd)) return EBADF;
      if (fd > 3) fds.delete(fd);
      return ESUCCESS;
    },
    fd_fdstat_get(fd, buf) {
      const d = fds.get(fd);
      if (!d) return EBADF;
      const v = view();
      const filetype = d.kind === 'dir'
        ? FILETYPE_DIRECTORY
        : d.kind === 'file' ? FILETYPE_REGULAR_FILE : FILETYPE_CHARACTER_DEVICE;
      v.setUint8(buf, filetype);
      v.setUint16(buf + 2, 0, true);
      v.setBigUint64(buf + 8, 0xffffffffffffffffn, true);
      v.setBigUint64(buf + 16, 0xffffffffffffffffn, true);
      return ESUCCESS;
    },
    fd_filestat_get(fd, buf) {
      const d = fds.get(fd);
      if (!d) return EBADF;
      if (d.kind === 'dir') writeFilestat(buf, FILETYPE_DIRECTORY, 0);
      else if (d.kind === 'file') writeFilestat(buf, FILETYPE_REGULAR_FILE, d.file.size);
      else writeFilestat(buf, FILETYPE_CHARACTER_DEVICE, 0);
      return ESUCCESS;
    },
    fd_filestat_set_size(fd, size) {
      const d = fds.get(fd);
      if (!d || d.kind !== 'file') return EBADF;
      const n = Number(size);
      grow(d.file, n);
      if (n > d.file.size) d.file.data.fill(0, d.file.size, n);
      d.file.size = n;
      return ESUCCESS;
    },
    fd_prestat_get(fd, buf) {
      if (fd !== 3) return EBADF;
      const v = view();
      v.setUint8(buf, 0); // preopentype: dir
      v.setUint32(buf + 4, 1, true); // name length ("/")
      return ESUCCESS;
    },
    fd_prestat_dir_name(fd, pathPtr, pathLen) {
      if (fd !== 3) return EBADF;
      if (pathLen >= 1) bytes()[pathPtr] = 0x2f; // "/"
      return ESUCCESS;
    },
    fd_read(fd, iovs, iovsLen, nreadPtr) {
      const d = fds.get(fd);
      if (!d) return EBADF;
      if (d.kind === 'stdin') {
        const n = readIovs({ data: stdin, size: stdin.length }, iovs, iovsLen, stdinOffset);
        stdinOffset += n;
        view().setUint32(nreadPtr, n, true);
        return ESUCCESS;
      }
      if (d.kind !== 'file') return EBADF;
      const n = readIovs(d.file, iovs, iovsLen, d.offset);
      d.offset += n;
      view().setUint32(nreadPtr, n, true);
      return ESUCCESS;
    },
    fd_pread(fd, iovs, iovsLen, offset, nreadPtr) {
      const d = fds.get(fd);
      if (!d || d.kind !== 'file') return EBADF;
      const n = readIovs(d.file, iovs, iovsLen, Number(offset));
      view().setUint32(nreadPtr, n, true);
      return ESUCCESS;
    },
    fd_write(fd, iovs, iovsLen, nwrittenPtr) {
      const d = fds.get(fd);
      if (!d) return EBADF;
      if (d.kind === 'stdout' || d.kind === 'stderr') {
        const v = view();
        let total = 0;
        for (let i = 0; i < iovsLen; i++) {
          const ptr = v.getUint32(iovs + i * 8, true);
          const len = v.getUint32(iovs + i * 8 + 4, true);
          writeStd(fd, readString(ptr, len));
          total += len;
        }
        v.setUint32(nwrittenPtr, total, true);
        return ESUCCESS;
      }
      if (d.kind !== 'file') return EBADF;
      const n = writeIovs(d.file, iovs, iovsLen, d.offset);
      d.offset += n;
      view().setUint32(nwrittenPtr, n, true);
      return ESUCCESS;
    },
    fd_pwrite(fd, iovs, iovsLen, offset, nwrittenPtr) {
      const d = fds.get(fd);
      if (!d || d.kind !== 'file') return EBADF;
      const n = writeIovs(d.file, iovs, iovsLen, Number(offset));
      view().setUint32(nwrittenPtr, n, true);
      return ESUCCESS;
    },
    fd_seek(fd, offset, whence, newOffsetPtr) {
      const d = fds.get(fd);
      if (!d || d.kind !== 'file') return EBADF;
      const off = Number(offset);
      let base = 0;
      if (whence === 1) base = d.offset;
      else if (whence === 2) base = d.file.size;
      else if (whence !== 0) return EINVAL;
      if (base + off < 0) return EINVAL;
      d.offset = base + off;
      view().setBigUint64(newOffsetPtr, BigInt(d.offset), true);
      return ESUCCESS;
    },
    fd_readdir(fd, buf, bufLen, cookie, bufUsedPtr) {
      const d = fds.get(fd);
      if (!d || d.kind !== 'dir') return EBADF;
      if (!d.entries) d.entries = fs.listDir(d.path);
      const v = view();
      const mem = bytes();
      let pos = 0;
      for (let i = Number(cookie); i < d.entries.length; i++) {
        const e = d.entries[i];
        const name = encoder.encode(e.name);
        const entry = new Uint8Array(24 + name.length);
        const ev = new DataView(entry.buffer);
        ev.setBigUint64(0, BigInt(i + 1), true); // d_next
        ev.setBigUint64(8, BigInt(i + 1), true); // d_ino
        ev.setUint32(16, name.length, true);
        ev.setUint8(20, e.isDir ? FILETYPE_DIRECTORY : FILETYPE_REGULAR_FILE);
        entry.set(name, 24);
        const n = Math.min(entry.length, bufLen - pos);
        mem.set(entry.subarray(0, n), buf + pos);
        pos += n;
        if (n < entry.length) break;
      }
      v.setUint32(bufUsedPtr, pos, true);
      return ESUCCESS;
    },
    path_create_directory(fd, pathPtr, pathLen) {
      const path = resolvePath(fd, pathPtr, pathLen);
      if (path === null) return EBADF;
      if (fs.exists(path)) return EEXIST;
      if (!fs.dirs.has(parentPath(path))) return ENOENT;
      fs.dirs.add(path);
      return ESUCCESS;
    },
    path_filestat_get(fd, flags, pathPtr, pathLen, buf) {
      const path = resolvePath(fd, pathPtr, pathLen);
      if (path === null) return EBADF;
      return statPath(path, buf);
    },
    path_open(dirFd, dirFlags, pathPtr, pathLen, oflags, rightsBase, rightsInheriting, fdFlags, fdPtr) {
      const path = resolvePath(dirFd, pathPtr, pathLen);
      if (path === null) return EBADF;
      const v = view();
      if (fs.dirs.has(path)) {
        if ((oflags & OFLAGS_EXCL) && (oflags & OFLAGS_CREAT)) return EEXIST;
        const fd = nextFd++;
        fds.set(fd, { kind: 'dir', path });
        v.setUint32(fdPtr, fd, true);
        return ESUCCESS;
      }
      if (oflags & OFLAGS_DIRECTORY) return fs.files.has(path) ? ENOTDIR : ENOENT;
      let file = fs.files.get(path);
      if (file) {
        if ((oflags & OFLAGS_EXCL) && (oflags & OFLAGS_CREAT)) return EEXIST;
        if (oflags & OFLAGS_TRUNC) {
          file.data = new Uint8Array(0);
          file.size = 0;
        }
      } else {
        if (!(oflags & OFLAGS_CREAT)) return ENOENT;
        if (!fs.dirs.has(parentPath(path))) return ENOENT;
        file = { data: new Uint8Array(0), size: 0 };
        fs.files.set(path, file);
      }
      const fd = nextFd++;
      fds.set(fd, { kind: 'file', path, file, offset: (fdFlags & FDFLAGS_APPEND) ? file.size : 0 });
      v.setUint32(fdPtr, fd, true);
      return ESUCCESS;
    },
    path_remove_directory(fd, pathPtr, pathLen) {
      const path = resolvePath(fd, pathPtr, pathLen);
      if (path === null) return EBADF;
      if (!fs.dirs.has(path)) return fs.files.has(path) ? ENOTDIR : ENOENT;
      if (fs.listDir(path).length > 0) return ENOTEMPTY;
      fs.dirs.delete(path);
      return ESUCCESS;
    },
    path_unlink_file(fd, pathPtr, pathLen) {
      const path = resolvePath(fd, pathPtr, pathLen);
      if (path === null) return EBADF;
      if (!fs.files.has(path)) return fs.dirs.has(path) ? EISDIR : ENOENT;
      fs.files.delete(path);
      return ESUCCESS;
    },
    // Nothing is durable here, so syncing is a no-op.
    fd_sync() {
      return ESUCCESS;
    },
    fd_datasync() {
      return ESUCCESS;
    },
    fd_advise() {
      return ESUCCESS;
    },
    fd_tell(fd, offsetPtr) {
      const d = fds.get(fd);
      if (!d) return EBADF;
      if (d.kind !== 'file') return EBADF;
      view().setBigUint64(offsetPtr, BigInt(d.offset), true);
      return ESUCCESS;
    },
    fd_renumber(from, to) {
      if (!fds.has(from) || !fds.has(to)) return EBADF;
      fds.set(to, fds.get(from));
      fds.delete(from);
      return ESUCCESS;
    },
    // Stubs: a program that reaches for these gets ENOSYS, not a link error.
    fd_allocate: () => ENOSYS,
    fd_fdstat_set_flags: () => ENOSYS,
    fd_fdstat_set_rights: () => ENOSYS,
    fd_filestat_set_times: () => ENOSYS,
    path_filestat_set_times: () => ENOSYS,
    path_link: () => ENOSYS,
    path_readlink: () => ENOSYS,
    path_rename: () => ENOSYS,
    path_symlink: () => ENOSYS,
    proc_raise: () => ENOSYS,
    sock_accept: () => ENOSYS,
    sock_recv: () => ENOSYS,
    sock_send: () => ENOSYS,
    sock_shutdown: () => ENOSYS,
    proc_exit(code) {
      throw new WasiExit(code);
    },
    random_get(ptr, len) {
      globalThis.crypto.getRandomValues(bytes().subarray(ptr, ptr + len));
      return ESUCCESS;
    },
    sched_yield() {
      return ESUCCESS;
    },
    poll_oneoff() {
      return ENOSYS;
    },
  };

  return {
    imports,
    setMemory(mem) {
      memory = mem;
    },
    flush,
  };
};

/**
 * Instantiate `module` with the WASI imports and run its `_start`.
 * @returns {number} the program's exit code
 */
export const runWasi = (module, wasi) => {
  const instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: wasi.imports });
  wasi.setMemory(instance.exports.memory);
  let code = 0;
  try {
    instance.exports._start();
  } catch (error) {
    if (error instanceof WasiExit) {
      code = error.code;
    } else {
      wasi.flush();
      throw error;
    }
  }
  wasi.flush();
  return code;
};
