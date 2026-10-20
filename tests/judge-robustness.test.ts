import { expect, test } from "bun:test";
import {
	changedVerdicts,
	padDescription,
	paraphraseDescription,
	robustnessVariants,
	shuffleTracks,
} from "../evals/robustness";
import { geminiStream, installFakeFetch } from "./fake-providers";

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

/** The engine's paraphrase for one description, faked; restores fetch after. */
async function paraphrasedBy(
	reply: string,
	description: string,
	artists: string[] = [],
) {
	const original = globalThis.fetch;
	const fake = installFakeFetch({ gemini: () => geminiStream(reply) });
	try {
		const outcome = await paraphraseDescription(
			{
				description,
				songs: artists.map((artist) => ({ artist, title: `${artist} song` })),
			},
			"gemini",
		);
		return { outcome, fake };
	} finally {
		globalThis.fetch = original;
	}
}

test("a paraphrase is one temperature-0 request to the judge's engine and is kept when it loses nothing", async () => {
	const { outcome, fake } = await paraphrasedBy(
		'No ballads here: this EBM set is anchored by D.A.F., over 4.5 hours, opening with "Der Mussolini".',
		'D.A.F. anchors this EBM set for 4.5 hours, opening with "Der Mussolini". No ballads!',
		["D.A.F."],
	);
	expect(outcome).toEqual({
		status: "ok",
		text: 'No ballads here: this EBM set is anchored by D.A.F., over 4.5 hours, opening with "Der Mussolini".',
		missing: [],
	});
	expect(fake.requests).toHaveLength(1);
	expect(fake.requests[0]?.url).toContain("generativelanguage.googleapis.com");
	expect(fake.requests[0]?.body.generationConfig).toMatchObject({
		temperature: 0,
	});
});

test("a paraphrase that drops an artist name, a number or a quoted title is rejected with what it lost", async () => {
	for (const [description, reply, artists, missing] of [
		[
			"D.A.F. anchors this EBM set. No ballads!",
			"No ballads! F. anchors this EBM set.",
			["D.A.F."],
			["D.A.F."],
		],
		[
			"A 4.5-hour disco journey. No remixes.",
			"No remixes. 5-hour disco journey.",
			[],
			["4.5"],
		],
		[
			'Opens with "Blue Monday", then builds.',
			"It opens with a New Order classic, then builds.",
			[],
			["Blue Monday"],
		],
	] as const) {
		const { outcome } = await paraphrasedBy(reply, description, [...artists]);
		expect(outcome).toEqual({
			status: "rejected",
			text: reply,
			missing: [...missing],
		});
	}
});

test("a paraphrase the engine could not give is an error, and an empty description has none to ask for", async () => {
	const { outcome } = await paraphrasedBy("", "Dark EBM for the floor.");
	expect(outcome.status).toBe("error");
	const { outcome: empty, fake } = await paraphrasedBy("unused", "  ");
	expect(empty).toEqual({ status: "skipped" });
	expect(fake.requests).toHaveLength(0);
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
	const variants = robustnessVariants(run, 3, "Fast, and loud.");
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
	expect(paraphrased).toEqual({ ...run, description: "Fast, and loud." });
	expect(padded?.songs).toBe(songs);
	expect(padded?.description).toStartWith("Loud. Fast. ");
});

test("without an accepted paraphrase the paraphrased variant is skipped", () => {
	const run = { songs, description: "Loud.", brief: "Punk" };
	expect(
		robustnessVariants(run, 3, null).map((variant) => variant.variant),
	).toEqual(["shuffled", "padded"]);
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
