import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadListener } from "../evals/listener";

const snapshotFile = async (contents: unknown) => {
	const file = path.join(
		await mkdtemp(path.join(tmpdir(), "listener-")),
		"listener.json",
	);
	await writeFile(file, JSON.stringify(contents));
	return file;
};

test("a missing snapshot names the command that takes one", async () => {
	await expect(loadListener("/nowhere/listener.json")).rejects.toThrow(
		"bun run eval:snapshot-listener",
	);
});

test("a snapshot of another shape is rejected", async () => {
	const file = await snapshotFile({ takenAt: "2026-09-19", savedTracks: "x" });
	await expect(loadListener(file)).rejects.toThrow();
});

test("a snapshot serves the account reads", async () => {
	const file = await snapshotFile({
		takenAt: "2026-09-19T00:00:00Z",
		savedTracks: [{ id: "id-1", isrc: null, artists: ["Kavinsky"] }],
		topTracks: [],
		recentTracks: [],
	});
	const listener = await loadListener(file);
	expect(await listener.savedTracks()).toHaveLength(1);
	expect(await listener.topTracks()).toEqual([]);
	expect(await listener.recentTracks()).toEqual([]);
});
