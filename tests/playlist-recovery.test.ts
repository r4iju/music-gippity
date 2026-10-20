import { expect, test } from "bun:test";
import {
	applyGenerationLine,
	emptyDraft,
	readGeneration,
	restoreDraft,
	startGeneration,
} from "~/lib/playlist-generation";
import { PlaylistLineSchema } from "~/lib/playlist-stream";

const request = {
	prompt: "Pop for a heavy workout",
	trackCount: 2,
	engine: "chatgpt" as const,
};
const song = {
	kind: "song" as const,
	id: "a",
	order: 1,
	artist: "Artist",
	title: "Track",
	songId: "sp-a",
	source: "recall" as const,
};
const wire = (text: string) =>
	new Response(
		new ReadableStream({
			start(c) {
				for (const byte of new TextEncoder().encode(text))
					c.enqueue(new Uint8Array([byte]));
				c.close();
			},
		}),
	);

test("reload preserves partial tracks and request but never resurrects loading", () => {
	const draft = applyGenerationLine(
		startGeneration(emptyDraft(), request, "run"),
		"run",
		song,
	);
	const restored = restoreDraft(JSON.stringify(draft));
	expect(restored.generation.status).toBe("interrupted");
	expect(restored.songs).toHaveLength(1);
	expect(restored.request?.prompt).toBe(request.prompt);
	expect(
		restoreDraft(
			JSON.stringify({ ...draft, generation: undefined, isLoading: true }),
		).generation.status,
	).toBe("interrupted");
	expect(restoreDraft("{broken")).toEqual(emptyDraft());
});

test("a candidates line that widened the scene labels the draft's chip; one that did not leaves none", () => {
	const candidates = (widening?: Record<string, unknown>) =>
		PlaylistLineSchema.parse({
			kind: "candidates",
			engine: "chatgpt",
			model: "fake",
			status: "ok",
			systemPrompt: "",
			userPrompt: "",
			raw: "",
			totalMs: 0,
			musicbrainz: [],
			lastfm: [],
			excluded: 0,
			known: 0,
			pool: { tag: 1, label: 0, chart: 0 },
			artists: [],
			tracks: [],
			popularity: { budget: null, counted: 0, mainstream: 0 },
			...(widening ? { widening } : {}),
		});
	const widening = (label: string | null) => ({
		status: "ok",
		reason: "",
		userPrompt: "",
		raw: "",
		plan: { tags: ["electronic"], area: null, genres: [], era: null },
		musicbrainz: [],
		lastfm: [],
		pool: { tag: label ? 1 : 0, label: 0, chart: 0 },
		offered: label ? 1 : 0,
		label,
	});
	const draft = startGeneration(emptyDraft(), request, "run");
	const widened = applyGenerationLine(
		draft,
		"run",
		candidates(widening("Widened to electronic")),
	);
	expect(widened.widened).toBe("Widened to electronic");
	expect(restoreDraft(JSON.stringify(widened)).widened).toBe(
		"Widened to electronic",
	);
	for (const line of [candidates(), candidates(widening(null))])
		expect(applyGenerationLine(draft, "run", line).widened).toBeUndefined();
});

test("late events from replaced requests cannot corrupt the current draft", () => {
	const draft = startGeneration(emptyDraft(), request, "new");
	expect(applyGenerationLine(draft, "old", song)).toBe(draft);
});

test("stream handles fragmented Unicode and explicit completion, even without trailing newline", async () => {
	const lines: unknown[] = [];
	await readGeneration(
		wire(
			JSON.stringify({ ...song, title: "東京 🎵" }) +
				"\n" +
				JSON.stringify({ kind: "complete", id: "playlist", songIds: ["a"] }),
		),
		new AbortController().signal,
		(line) => lines.push(line),
	);
	expect(lines).toHaveLength(2);
	expect(lines[0]).toMatchObject({ title: "東京 🎵" });
});

test("EOF and malformed data retain delivered progress but cannot claim success", async () => {
	for (const tail of ["", '\n{"kind":']) {
		const lines: unknown[] = [];
		await expect(
			readGeneration(
				wire(`${JSON.stringify(song)}\n${tail}`),
				new AbortController().signal,
				(line) => lines.push(line),
			),
		).rejects.toThrow();
		expect(lines).toEqual([song]);
	}
});

test("abort unblocks a stalled reader", async () => {
	const controller = new AbortController();
	const response = new Response(new ReadableStream());
	const reading = readGeneration(response, controller.signal, () => {});
	controller.abort();
	await expect(reading).rejects.toThrow();
});

test("completion rejects an extra unresolved slot even when the requested count resolved", () => {
	let draft = startGeneration(emptyDraft(), request, "run");
	for (const line of [
		{ kind: "id" as const, id: "playlist" },
		song,
		{ ...song, id: "b", order: 2, songId: "sp-b" },
		{ ...song, id: "c", order: 3, songId: null },
		{ kind: "complete" as const, id: "playlist", songIds: ["a", "b", "c"] },
	])
		draft = applyGenerationLine(draft, "run", line);
	expect(draft.generation.status).toBe("interrupted");
});

test("corrupt storage reports recovery failure without throwing away valid runtime progress", () => {
	const warnings: string[] = [];
	expect(restoreDraft("{broken", (message) => warnings.push(message))).toEqual(
		emptyDraft(),
	);
	expect(warnings).toHaveLength(1);
});
