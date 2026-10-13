// Refuses to pack a package that cannot work.
//
//   npm run check-package        (also the `prepack` hook, so `npm publish` runs it)
//
// The assets are committed, so they can go stale or be deleted without anything in the tests
// noticing — the tests read whatever is there. This checks that every asset the receipts name is
// present and hashes to its receipt, and that the built bundle exists, before anything is published.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { ASSET_RECEIPTS } from '../src/asset-receipts.js';

const ASSETS = new URL('../assets/', import.meta.url);
const BUNDLE = new URL('../dist/odin-wasm.global.js', import.meta.url);

const problems = [];

for (const [name, receipt] of Object.entries(ASSET_RECEIPTS)) {
	const url = new URL(name, ASSETS);
	if (!existsSync(url)) {
		problems.push(`missing asset: assets/${name}`);
		continue;
	}
	const bytes = await readFile(url);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	if (bytes.length !== receipt.bytes || sha256 !== receipt.sha256) {
		problems.push(`assets/${name} does not match its receipt (run \`npm run sync-assets\`)`);
	}
}

if (!existsSync(BUNDLE)) {
	problems.push('missing dist/odin-wasm.global.js (run `npm run build:iife`)');
}

if (problems.length > 0) {
	console.error('Refusing to pack:');
	for (const problem of problems) console.error(`  ${problem}`);
	process.exit(1);
}

console.log(
	`Ready to pack: ${Object.keys(ASSET_RECEIPTS).length} assets verified, the bundle is present.`
);
