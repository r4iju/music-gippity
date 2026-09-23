import { describe, expect, test } from "bun:test";
import { Glob } from "bun";

// next.config.ts runs the React Compiler with compilationMode "all", which
// memoizes every top-level function in a file it compiles (any file with JSX
// or hooks) by giving it a cache hook. A plain helper there then calls a hook
// wherever it runs: at module load it throws (React #321), and called
// conditionally from a render it shifts the component's cache slots. Helpers
// live in ~/lib, which the compiler leaves alone; component files declare
// only components (PascalCase) and hooks (use*) at the top level.

const TOP_LEVEL_FUNCTION =
	/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/gm;

const isComponentOrHook = (name: string) =>
	/^[A-Z]/.test(name) || /^use[A-Z0-9]/.test(name);

const compiledFiles = async () => {
	const files: { path: string; source: string }[] = [];
	for await (const path of new Glob("src/**/*.{ts,tsx}").scan()) {
		const source = await Bun.file(path).text();
		if (path.endsWith(".tsx") || /^["']use client["']/m.test(source))
			files.push({ path, source });
	}
	return files;
};

describe("React Compiler scope", () => {
	test("component files declare only components and hooks at the top level", async () => {
		const offenders = (await compiledFiles()).flatMap(({ path, source }) =>
			[...source.matchAll(TOP_LEVEL_FUNCTION)]
				.map((match) => match[1] ?? match[2] ?? "")
				.filter((name) => !isComponentOrHook(name))
				.map((name) => `${path}: ${name}`),
		);
		expect(offenders).toEqual([]);
	});

	test("the check catches a plain helper", () => {
		const source = [
			"const labels = (on: boolean) => on;",
			"export function intentChips(intent: Intent): Chip[] {}",
			"const hint = labels(true);",
			"export function StepFive() {}",
			"export const usePlaylist = () => {};",
		].join("\n");
		const names = [...source.matchAll(TOP_LEVEL_FUNCTION)].map(
			(match) => match[1] ?? match[2],
		);
		expect(names).toEqual(["labels", "intentChips", "StepFive", "usePlaylist"]);
	});
});
