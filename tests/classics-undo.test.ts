import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import {
	PlaylistFormSchema,
	withClassicsOff,
} from "~/app/dashboard/create-playlist/playlist-form-schema";
import { popularityBudget } from "~/lib/popularity";
import { readRequestIntent } from "~/server/api/intent";
import { noveltyBudget } from "~/server/api/novelty";
import { GenerationModule } from "~/server/generation/module";
import * as schema from "~/server/schema";
import { geminiStream, installFakeFetch } from "./fake-providers";

test("undoing a classics request starts a new generation with the same settings and the classics reading off, keeping the original", async () => {
	const originalFetch = globalThis.fetch;
	installFakeFetch({
		intent: () =>
			geminiStream(
				JSON.stringify({
					genres: ["disco"],
					classics: { quote: "best 80s disco hits" },
				}),
			),
	});
	const client = createClient({ url: "file::memory:" });
	await client.executeMultiple(
		"CREATE TABLE user (id TEXT PRIMARY KEY); CREATE TABLE account (id INTEGER PRIMARY KEY); INSERT INTO user VALUES ('alice');",
	);
	for (const name of [
		"0003_durable_generations",
		"0004_checkpointed_playlists",
		"0005_generation_checkpoints",
	])
		await client.executeMultiple(
			await Bun.file(`migrations/${name}.sql`).text(),
		);
	const generation = new GenerationModule(
		drizzle(client, { schema }),
		async () => {},
	);
	try {
		const settings = {
			prompt: "The best 80s disco hits for a kitchen party",
			trackCount: 12,
			engine: "gemini",
			creativity: "adventurous",
			purpose: "discover",
		} as const;
		const original = await generation.create(
			"alice",
			crypto.randomUUID(),
			settings,
		);
		const request = original.playlist.request;
		if (!request) throw new Error("original request not stored");
		const undone = await generation.create(
			"alice",
			crypto.randomUUID(),
			withClassicsOff(request),
		);

		expect(undone.playlist.id).not.toBe(original.playlist.id);
		expect(undone.generation?.id).not.toBe(original.generation?.id);
		const stored = (await generation.observe("alice", undone.playlist.id))
			?.playlist.request;
		expect(stored).toEqual({
			...PlaylistFormSchema.parse(settings),
			classics: "off",
		});
		const kept = await generation.observe("alice", original.playlist.id);
		expect(kept?.playlist.request).toEqual(PlaylistFormSchema.parse(settings));
		expect(kept?.generation?.id).toBe(original.generation?.id);

		if (!stored) throw new Error("undone request not stored");
		const read = await readRequestIntent(request);
		expect(read?.classics).toEqual({ quote: "best 80s disco hits" });
		const intent = await readRequestIntent(stored);
		expect(intent).toMatchObject({ genres: ["disco"], classics: null });
		expect(noveltyBudget("discover", 12, intent)).toEqual({
			knownTracks: 2,
			knownArtists: 4,
		});
		expect(popularityBudget("adventurous", "discover", 12, intent)).toEqual({
			maxMainstream: 3,
			minMainstream: null,
		});
	} finally {
		globalThis.fetch = originalFetch;
		client.close();
	}
});
