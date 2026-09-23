import { expect, test } from "bun:test";
import {
	applyGenerationLine,
	emptyDraft,
	readGeneration,
	restoreDraft,
	startGeneration,
} from "~/lib/playlist-generation";

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
