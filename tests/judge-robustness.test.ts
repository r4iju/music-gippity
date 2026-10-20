import { expect, test } from "bun:test";
import {
	changedVerdicts,
	padDescription,
	paraphraseDescription,
	robustnessVariants,
	shuffleTracks,
} from "../evals/robustness";

const songs = ["a", "b", "c", "d", "e"].map((artist, index) => ({
	artist,
	title: `${artist}-song`,
	order: index + 1,
}));

test("a shuffle moves the tracks, keeps every one, and repeats for the same seed", () => {
	const once = shuffleTracks(songs, 7);
	expect(once.map((song) => song.artist)).not.toEqual([
		"a",
		"b",
		"c",
		"d",
		"e",
	]);
	expect(once.map((song) => song.artist).sort()).toEqual([
		"a",
		"b",
		"c",
		"d",
		"e",
	]);
	expect(shuffleTracks(songs, 7)).toEqual(once);
	expect(songs.map((song) => song.artist)).toEqual(["a", "b", "c", "d", "e"]);
});

test("two tracks always swap", () => {
	for (const seed of [1, 2, 3, 4])
		expect(
			shuffleTracks(songs.slice(0, 2), seed).map((song) => song.artist),
		).toEqual(["b", "a"]);
});

test("a paraphrase keeps every sentence of the description in another order", () => {
	expect(
		paraphraseDescription(
			"Dark EBM for the floor. Spanish acts lead. No ballads!",
		),
	).toBe("No ballads! Spanish acts lead. Dark EBM for the floor.");
});

test("a one-sentence description is paraphrased clause by clause", () => {
	expect(
		paraphraseDescription(
			"Bossa nova para un domingo lluvioso, suave y cálida",
		),
	).toBe("suave y cálida, Bossa nova para un domingo lluvioso");
});

test("a description with nothing to reorder has no paraphrase", () => {
	expect(paraphraseDescription("Nightcall.")).toBeNull();
	expect(paraphraseDescription("")).toBeNull();
});

test("padding keeps the description and adds text that promises nothing", () => {
	const description = "Dark EBM for the floor.";
	const padded = padDescription(description);
	expect(padded.startsWith(`${description} `)).toBe(true);
	const padding = padded.slice(description.length);
	expect(padding.length).toBeGreaterThan(2 * description.length);
	expect(padding).not.toMatch(
		/\b(ebm|vocals?|instrumental|bpm|spanish|80s|era|sequence)\b/i,
	);
});

test("each variant changes one thing about the saved run", () => {
	const run = { songs, description: "Loud. Fast.", brief: "Punk" };
	const variants = robustnessVariants(run, 3);
	expect(variants.map((variant) => variant.variant)).toEqual([
		"shuffled",
		"paraphrased",
		"padded",
	]);
	const [shuffled, paraphrased, padded] = variants.map(
		(variant) => variant.result,
	);
	expect(shuffled?.description).toBe("Loud. Fast.");
	expect(shuffled?.songs).not.toEqual(songs);
	expect(paraphrased).toEqual({ ...run, description: "Fast. Loud." });
	expect(padded?.songs).toBe(songs);
	expect(padded?.description).toStartWith("Loud. Fast. ");
});

test("a description with nothing to reorder skips the paraphrase", () => {
	const run = { songs, description: "Loud.", brief: "Punk" };
	expect(robustnessVariants(run, 3).map((variant) => variant.variant)).toEqual([
		"shuffled",
		"padded",
	]);
});

const fit = (reason = "ok") => ({ verdict: "fit" as const, reason });
const mismatch = { verdict: "mismatch" as const, reason: "too soft" };

test("verdicts are compared by recording and criterion, not by position", () => {
	const [a, b, c] = songs as [
		(typeof songs)[number],
		(typeof songs)[number],
		(typeof songs)[number],
	];
	const baseline = {
		songs: [a, b, c],
		assessment: {
			tracks: [
				{ position: 1, ...fit() },
				{ position: 2, ...fit() },
				{ position: 3, ...mismatch },
			],
			playlist: [
				{ criterionId: "scene", ...fit() },
				{ criterionId: "sequence", ...fit() },
			],
		},
	};
	// The same recordings shuffled to c, a, b; only b's verdict changes.
	const variant = {
		songs: [c, a, b],
		assessment: {
			tracks: [
				{ position: 1, ...mismatch },
				{ position: 2, ...fit("different words, same verdict") },
				{ position: 3, ...mismatch },
			],
			playlist: [
				{ criterionId: "sequence", ...mismatch },
				{ criterionId: "scene", ...fit() },
			],
		},
	};
	expect(changedVerdicts(baseline, variant)).toEqual([
		{
			kind: "track",
			subject: "b — b-song",
			before: "fit",
			after: "mismatch",
			reason: "too soft",
		},
		{
			kind: "criterion",
			subject: "sequence",
			before: "fit",
			after: "mismatch",
			reason: "too soft",
		},
	]);
	expect(changedVerdicts(baseline, baseline)).toEqual([]);
});
