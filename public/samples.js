// The sample programs, shared by the page (public/app.js) and the Node test
// (scripts/smoke.mjs) so a sample that would not compile is caught by
// `npm test`, not by a user.

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
