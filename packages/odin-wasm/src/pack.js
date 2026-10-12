// The packed standard library: Odin's `base/` and `core/`, in the container the
// repository's packer writes.
//
// The compiler reads its standard library from files, so a page must give it
// one. A flat, self-describing container is smaller than a tar (no per-entry
// headers) and inflates with the one decompressor a browser and Node both have.
//
// Format (before gzip):
//   "ODINPOC1"          8 bytes
//   count               u32 little-endian
//   count × { pathLen:u32, path:utf8, dataLen:u32, data:bytes }

export const PACK_MAGIC = 'ODINPOC1';

/**
 * @param {ArrayBuffer|Uint8Array} buffer - the inflated container
 * @returns {[string, Uint8Array][]} `base/…`, `core/…` and their bytes
 */
export function unpackLibrary(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== PACK_MAGIC) {
    throw new Error(`The standard library pack is not a ${PACK_MAGIC} container.`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const count = view.getUint32(8, true);
  const entries = [];
  let pos = 12;
  for (let i = 0; i < count; i++) {
    const pathLen = view.getUint32(pos, true);
    pos += 4;
    const path = decoder.decode(bytes.subarray(pos, pos + pathLen));
    pos += pathLen;
    const dataLen = view.getUint32(pos, true);
    pos += 4;
    entries.push([path, bytes.subarray(pos, pos + dataLen)]);
    pos += dataLen;
  }
  return entries;
}
