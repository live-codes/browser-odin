import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
// By name, so the tests exercise the real entry point - including the `node`
// condition that wires the packaged assets in.
import { createCompiler, TARGETS } from '@live-codes/odin-wasm';
import { ASSET_RECEIPTS } from '../src/asset-receipts.js';

const HELLO = `package main

import "core:fmt"

main :: proc() {
	fmt.println("Hellope!")
}
`;

const FROM_STDIN = `package main

import "core:bufio"
import "core:fmt"
import "core:os"
import "core:strconv"
import "core:strings"

main :: proc() {
	reader: bufio.Reader
	bufio.reader_init(&reader, os.to_reader(os.stdin))
	defer bufio.reader_destroy(&reader)

	total := 0
	count := 0
	for {
		line, err := bufio.reader_read_string(&reader, '\\n')
		if err != nil {
			break
		}
		if value, ok := strconv.parse_int(strings.trim_space(line)); ok {
			total += value
			count += 1
		}
	}
	fmt.printfln("%d numbers, sum %d", count, total)
}
`;

const TYPE_ERROR = `package main

main :: proc() {
	x: int = "nope"
}
`;

test('the targets are the two the package documents', () => {
	assert.deepEqual([...TARGETS], ['wasi_wasm32', 'js_wasm32']);
});

test('an unknown target is rejected with the list of valid ones', async () => {
	await assert.rejects(() => createCompiler({ target: 'native' }), /Unknown target "native"\. Expected one of wasi_wasm32, js_wasm32\./);
});

test('a baseUrl that is not http(s) is rejected', async () => {
	await assert.rejects(
		() => createCompiler({ baseUrl: 'ftp://example.com/odin/' }),
		/baseUrl must be an absolute http\(s\) URL/
	);
});

test('Node needs no baseUrl: the packaged assets are the default', async () => {
	const compiler = await createCompiler();
	const result = await compiler.run(HELLO);

	assert.deepEqual(Object.keys(result).sort(), [
		'compileMs',
		'errors',
		'exitCode',
		'output',
		'runMs',
		'stderr',
		'stdout'
	]);
	assert.equal(result.stdout, 'Hellope!\n');
	assert.equal(result.stderr, '');
	assert.equal(result.output, 'Hellope!\n');
	assert.deepEqual(result.errors, []);
	assert.equal(result.exitCode, 0);
	assert.ok(result.compileMs >= 0);
	assert.ok(result.runMs >= 0);
	compiler.dispose();
});

test('standard input reaches the program', async () => {
	const compiler = await createCompiler();
	const result = await compiler.run(FROM_STDIN, '1\n2\n3\n4\n');

	assert.deepEqual(result.errors, []);
	assert.equal(result.stdout, '4 numbers, sum 10\n');
	assert.equal(result.exitCode, 0);
	compiler.dispose();
});

test('the program exit code is reported, not thrown', async () => {
	const compiler = await createCompiler();
	const result = await compiler.run(`package main

import "core:os"

main :: proc() {
	os.exit(3)
}
`);

	assert.deepEqual(result.errors, []);
	assert.equal(result.exitCode, 3);
	compiler.dispose();
});

test('program args come from the compiler and can be overridden per run', async () => {
	const compiler = await createCompiler({ args: ['one'] });
	const program = `package main

import "core:fmt"
import "core:os"

main :: proc() {
	fmt.printfln("%d %s", len(os.args), os.args[1])
}
`;

	assert.equal((await compiler.run(program)).stdout, '2 one\n');
	assert.equal((await compiler.run(program, '', { args: ['two'] })).stdout, '2 two\n');
	compiler.dispose();
});

test('a compile failure returns diagnostics and does not run', async () => {
	const compiler = await createCompiler();
	const result = await compiler.run(TYPE_ERROR);

	assert.equal(result.exitCode, null);
	assert.equal(result.runMs, null);
	assert.equal(result.stdout, '');
	assert.ok(result.errors.length > 0, 'expected diagnostics');
	assert.ok(
		result.errors.some((line) => /Cannot convert/.test(line)),
		`expected the diagnostic to name the problem, got:\n${result.errors.join('\n')}`
	);
	compiler.dispose();
});

test('one compiler keeps working across runs with different sources', async () => {
	const compiler = await createCompiler();
	const exit = (code) => `package main\n\nimport "core:os"\n\nmain :: proc() {\n\tos.exit(${code})\n}\n`;

	assert.equal((await compiler.run(exit(0))).exitCode, 0);
	assert.equal((await compiler.run(exit(1))).exitCode, 1);
	assert.equal((await compiler.run(exit(2))).exitCode, 2);
	compiler.dispose();
});

test('the js target runs a console program', async () => {
	const compiler = await createCompiler({ target: 'js_wasm32' });
	const result = await compiler.run(HELLO);

	assert.deepEqual(result.errors, []);
	assert.equal(result.stdout, 'Hellope!\n');
	assert.equal(result.exitCode, 0);
	compiler.dispose();
});

test('the target can be overridden for a single run', async () => {
	const compiler = await createCompiler();
	assert.equal((await compiler.run(HELLO, '', { target: 'js_wasm32' })).stdout, 'Hellope!\n');
	assert.equal((await compiler.run(HELLO)).stdout, 'Hellope!\n');
	compiler.dispose();
});

test('two compilers against the same source are independent', async () => {
	const first = await createCompiler();
	const second = await createCompiler();
	assert.equal((await first.run(HELLO)).stdout, 'Hellope!\n');
	assert.equal((await second.run(HELLO)).stdout, 'Hellope!\n');
	first.dispose();
	// Disposing one does not disturb the other.
	assert.equal((await second.run(HELLO)).stdout, 'Hellope!\n');
	second.dispose();
});

test('compile() hands back the module without running it', async () => {
  const compiler = await createCompiler();
  const result = await compiler.compile(HELLO);

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.ok(result.wasm instanceof Uint8Array && result.wasm.length > 0);
  // It is a real, instantiable module — the caller runs it.
  assert.doesNotThrow(() => new WebAssembly.Module(result.wasm.slice()));
  compiler.dispose();
});

test('compile() reports diagnostics and gives no module', async () => {
  const compiler = await createCompiler();
  const result = await compiler.compile(TYPE_ERROR);

  assert.equal(result.ok, false);
  assert.equal(result.wasm, null);
  assert.ok(result.errors.some((line) => /Cannot convert/.test(line)));
  compiler.dispose();
});

test('compile() builds for the js target when asked', async () => {
  const compiler = await createCompiler({ target: 'js_wasm32' });
  const result = await compiler.compile(HELLO);

  assert.equal(result.ok, true);
  const module = new WebAssembly.Module(result.wasm.slice());
  const modules = WebAssembly.Module.imports(module).map((entry) => entry.module);
  assert.ok(
    modules.includes('odin_env'),
    `expected the js target's odin_env import, got: ${modules.join(', ')}`,
  );
  compiler.dispose();
});

test('a disposed compiler refuses compile() and run()', async () => {
  const compiler = await createCompiler();
  compiler.dispose();
  await assert.rejects(() => compiler.run(HELLO), /disposed/);
  await assert.rejects(() => compiler.compile(HELLO), /disposed/);
});

test('every asset shipped in the package matches its pinned receipt', async () => {
	for (const [name, receipt] of Object.entries(ASSET_RECEIPTS)) {
		const bytes = await readFile(new URL(`../assets/${name}`, import.meta.url));
		assert.equal(bytes.length, receipt.bytes, `${name} is the wrong size`);
		assert.equal(
			createHash('sha256').update(bytes).digest('hex'),
			receipt.sha256,
			`${name} does not hash to its receipt`
		);
	}
});

test('without a filesystem baseUrl is required, and the error says what to do', async () => {
	const browserEntry = await import('../src/index.js');
	await assert.rejects(
		() => browserEntry.createCompiler(),
		/baseUrl is required here[\s\S]*copy-assets/
	);
});
