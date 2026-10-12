// Where the assets come from, and how they are read.
//
// Two sources behind one shape, because everything downstream only needs "give
// me this asset, verified":
//
//   hosted   - a base URL. The page fetches from a server you control.
//   packaged - the files that ship inside this package, on disk. Only reachable
//              in Node, which is the only place there is a filesystem.
//
// Every asset is checked against a pinned SHA-256 receipt before it is used, so
// a truncated download or a host serving something else is an error here rather
// than a wasm instantiation failure a step later.

import { ASSET_RECEIPTS } from './asset-receipts.js';

/** The assets the package carries, in the order they are loaded. */
export const ASSET_NAMES = Object.freeze(Object.keys(ASSET_RECEIPTS));

const BASE_URL_REQUIRED =
  'baseUrl is required here. The assets that ship in this package can only be read where there is a ' +
  'filesystem, and a browser cannot reach a file inside an npm package — copy them somewhere your ' +
  'page can fetch with `npx --package @live-codes/odin-wasm odin-wasm-copy-assets <dir>` and pass ' +
  'that directory as baseUrl.';

/**
 * @param {object} options - the options `createCompiler` was given
 * @param {object|null} packaged - the packaged-asset reader, or null where there is no filesystem
 */
export function resolveAssetSource(options, packaged) {
  if (options.baseUrl != null && options.baseUrl !== '') return createHostedSource(options);
  if (!packaged) throw new Error(BASE_URL_REQUIRED);
  return createPackagedSource(packaged);
}

function createHostedSource(options) {
  const baseUrl = resolveBaseUrl(options.baseUrl);
  return {
    kind: 'hosted',
    key: `hosted\u0000${baseUrl}`,
    description: baseUrl,
    baseUrl,
    async readAsset(name, onProgress) {
      const url = new URL(name, baseUrl);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load the runtime asset ${url}: ${response.status}`);
      }
      return verifyReceipt(name, await readBody(response, onProgress));
    },
  };
}

function createPackagedSource(packaged) {
  return {
    kind: 'packaged',
    key: `packaged\u0000${packaged.root.href}`,
    description: `the assets packaged with this library (${packaged.root.href})`,
    async readAsset(name) {
      let bytes;
      try {
        bytes = await packaged.readFile(name);
      } catch (error) {
        throw new Error(
          `Failed to read the packaged asset ${name} from ${packaged.root.href}: ${error.message}`,
          { cause: error }
        );
      }
      return verifyReceipt(name, bytes);
    },
  };
}

// Absolute http(s); in a browser a relative URL resolves against the page.
function resolveBaseUrl(value) {
  let url;
  try {
    url = value instanceof URL ? value : new URL(value, globalThis.document?.baseURI);
  } catch (error) {
    throw new Error(
      `baseUrl must be an absolute http(s) URL, or relative to the page in a browser: ${error.message}`,
      { cause: error }
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `baseUrl must be an absolute http(s) URL, or relative to the page in a browser: got "${value}"`
    );
  }
  return url.href.endsWith('/') ? url.href : `${url.href}/`;
}

async function readBody(response, onProgress) {
  if (!onProgress || !response.body) {
    return new Uint8Array(await response.arrayBuffer());
  }
  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  onProgress(0, total);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function verifyReceipt(name, bytes) {
  const receipt = ASSET_RECEIPTS[name];
  if (!receipt) throw new Error(`No pinned receipt for the runtime asset ${name}`);
  if (bytes.byteLength !== receipt.bytes) {
    throw new Error(`The runtime asset ${name} is ${bytes.byteLength} bytes, expected ${receipt.bytes}`);
  }
  const digest = await sha256Hex(bytes);
  if (digest !== receipt.sha256) {
    throw new Error(
      `The runtime asset ${name} failed SHA-256 verification: expected ${receipt.sha256}, got ${digest}`
    );
  }
  return bytes;
}

export async function sha256Hex(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      'Verifying the runtime assets needs crypto.subtle: a secure context in the browser, or Node 20 and later.'
    );
  }
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function inflateGzip(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('Inflating the standard library pack needs DecompressionStream');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
