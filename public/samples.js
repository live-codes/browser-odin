// The sample programs, shared by the page (public/app.js) and the Node test
// (scripts/smoke.mjs) so a sample that would not compile is caught by
// `npm test`, not by a user.
//
// `SAMPLE_STDIN` pre-fills the stdin box; `SAMPLE_TARGET` switches the target
// when a sample only makes sense for one of them.

export const SAMPLES = {
  'hello': `package main

import "core:fmt"

main :: proc() {
	fmt.println("Hellope!")
}
`,
  'loops and formatting': `package main

import "core:fmt"

main :: proc() {
	total := 0
	for i in 1..=5 {
		total += i
		fmt.printfln("%d squared is %d", i, i*i)
	}
	fmt.printfln("sum = %d", total)
}
`,
  'collections': `package main

import "core:fmt"
import "core:slice"

main :: proc() {
	numbers := []int{5, 3, 8, 1, 9, 2}

	// The slice header is a copy, so sorting numbers in place would reorder
	// the caller's data; sorting a clone keeps that honest.
	sorted := slice.clone(numbers)
	slice.sort(sorted)
	fmt.printfln("sorted: %v", sorted)

	sum := 0
	for n in numbers {
		sum += n
	}
	fmt.printfln("sum = %d, max = %d", sum, slice.max(numbers))
}
`,
  'structs and procedures': `package main

import "core:fmt"

Vec2 :: struct {
	x, y: f64,
}

add :: proc(a, b: Vec2) -> Vec2 {
	return {a.x + b.x, a.y + b.y}
}

main :: proc() {
	a := Vec2{1, 2}
	b := Vec2{3, 4}
	c := add(a, b)
	fmt.printfln("%v + %v = %v", a, b, c)
	fmt.printfln("sum = %g", c.x + c.y)
}
`,
  'canvas animation': `package main

import "core:fmt"
import "core:sys/wasm/js"

// This runs on the js_wasm32 target. The page drives the exported step once
// per animation frame and shows the canvas; js.evaluate calls straight into
// the page's JavaScript to draw on it.

elapsed: f64
frames: int

main :: proc() {
	fmt.println("drawing on the canvas — press Run to restart")
}

@(export)
step :: proc(dt: f64, _: rawptr) -> bool {
	elapsed += dt
	frames += 1
	if frames % 60 == 0 {
		fmt.printfln("frame %d, %.1f s", frames, elapsed)
	}

	draw_on_canvas()
	return true
}

draw_on_canvas :: proc() {
	js.evaluate(DRAW)
}

DRAW :: \`(function () {
	const c = document.getElementById("canvas");
	const ctx = c.getContext("2d");
	const t = performance.now() / 1000;
	ctx.fillStyle = "#0f1116";
	ctx.fillRect(0, 0, c.width, c.height);
	ctx.fillStyle = "#3b82f6";
	ctx.beginPath();
	ctx.arc(c.width / 2 + Math.cos(t) * 90, c.height / 2 + Math.sin(t) * 55, 16, 0, Math.PI * 2);
	ctx.fill();
})();\`
`,
  'read from stdin': `package main

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
`,
  'compile error (shows diagnostics)': `package main

import "core:fmt"

main :: proc() {
	// x is declared int but given a string: a type error, reported with a
	// line and column instead of running.
	x: int = "nope"
	fmt.println(x)
}
`,
};

// Samples that expect something on standard input, pre-filled when selected.
export const SAMPLE_STDIN = {
  'read from stdin': '1\n2\n3\n4\n',
};

// Samples that only work on one target, applied when the sample is selected.
// (Standard input works on both: the js target reads it through odin_env.read,
// see patches/core/os/file_js.odin and public/app.js.)
export const SAMPLE_TARGET = {
  'canvas animation': 'js_wasm32',
};
