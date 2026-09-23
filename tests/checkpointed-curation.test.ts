import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { CuratedSchema, curatePicks } from "~/server/generation/curation";
import { GenerationModule } from "~/server/generation/module";
import { retrieveCandidates } from "~/server/generation/research";
import { RunRepository } from "~/server/generation/run-repository";
import { executeStage } from "~/server/generation/stage";
import * as schema from "~/server/schema";
import { installFakeFetch, openaiStream } from "./fake-providers";

test.each(["confirmed", "missing-terminal", "partial-json"] as const)(
	"curation %s never repeats an uncertain paid request",
	async (outcome) => {
		const originalFetch = globalThis.fetch;
		const fake = installFakeFetch({
			openai: () => {
				const content =
					'{"kind":"name","name":"Workout pop"}\n{"kind":"song","order":1,"artist":"Artist A","title":"Track A"}\n{"kind":"song","order":2,"artist":"Artist B","title":"Track B"}';
				if (outcome === "missing-terminal")
					return new Response(
						`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
					);
				return openaiStream(
					content +
						(outcome === "partial-json" ? '\n{"kind":"song","artist":' : ""),
				);
			},
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
		const db = drizzle(client, { schema });
		const repository = new RunRepository(db);
		let redeliver: () => Promise<unknown> = async () => {};
		const generation = new GenerationModule(db, async (id) => {
			const row = await repository.claim(id, "worker");
			if (!row?.playlist.contents.request) throw new Error("Missing request");
			const settings = row.playlist.contents.request;
			const research = await retrieveCandidates(
				settings,
				null,
				"alice",
				"fixture-token",
				new AbortController().signal,
			);
			redeliver = () =>
				executeStage(repository, id, "worker", {
					phase: "curation",
					paid: true,
					schema: CuratedSchema,
					operation: (signal) =>
						curatePicks(settings, research, "alice", signal),
					progress: (output) => [
						{ kind: "name", name: output.name },
						...output.picks.slice(0, settings.trackCount).map((song) => ({
							...song,
							kind: "song" as const,
							origin: "pick" as const,
						})),
					],
				});
			await redeliver();
		});
		try {
			const created = await generation.create("alice", crypto.randomUUID(), {
				prompt: "Workout pop playlist",
				trackCount: 2,
				engine: "chatgpt",
			});
			const saved = await generation.observe("alice", created.playlist.id);
			if (outcome !== "confirmed") {
				expect(saved?.generation?.state).toMatchObject({
					status: "failed",
					phase: "curation",
					failure: { code: "ambiguous" },
				});
				await expect(redeliver()).rejects.toThrow();
			} else {
				expect(saved?.playlist.songs.map((song) => song.title)).toEqual([
					"Track A",
					"Track B",
				]);
				await redeliver();
				expect(
					(await generation.observe("alice", created.playlist.id))?.playlist
						.songs,
				).toEqual(saved?.playlist.songs);
			}
			expect(
				fake.requests.filter(
					(request) => new URL(request.url).hostname === "api.openai.com",
				),
			).toHaveLength(1);
		} finally {
			globalThis.fetch = originalFetch;
			client.close();
		}
	},
);
