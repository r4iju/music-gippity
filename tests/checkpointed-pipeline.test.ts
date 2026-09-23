import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import {
	CheckedSchema,
	checkEvidence,
	repairChecked,
	rerankChecked,
} from "~/server/generation/checking";
import { CuratedSchema, curatePicks } from "~/server/generation/curation";
import { GenerationModule } from "~/server/generation/module";
import { retrieveCandidates } from "~/server/generation/research";
import {
	ResolvedSchema,
	resolveRecordings,
} from "~/server/generation/resolution";
import { RunRepository } from "~/server/generation/run-repository";
import { executeStage } from "~/server/generation/stage";
import * as schema from "~/server/schema";
import { installFakeFetch, openaiStream } from "./fake-providers";

test("a lost paid rerank retains checked recordings instead of silently reporting success", async () => {
	const originalFetch = globalThis.fetch;
	const fake = installFakeFetch({
		openai: () =>
			openaiStream(
				'{"kind":"name","name":"Workout"}\n{"kind":"song","order":1,"artist":"Artist A","title":"TrackA"}\n{"kind":"song","order":2,"artist":"Artist B","title":"TrackB"}',
			),
		gemini: () => {
			throw new Error("provider connection lost");
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
		const curated = await executeStage(repository, id, "worker", {
			phase: "curation",
			paid: true,
			schema: CuratedSchema,
			operation: (signal) => curatePicks(settings, research, "alice", signal),
		});
		const resolved = await executeStage(repository, id, "worker", {
			phase: "resolution",
			paid: false,
			schema: ResolvedSchema,
			operation: (signal, attempt) =>
				resolveRecordings(
					curated,
					null,
					settings.trackCount,
					"fixture-token",
					signal,
					(line) =>
						repository.append(id, "worker", line, {
							phase: "resolution",
							attempt,
						}),
				),
		});
		const checked = await executeStage(repository, id, "worker", {
			phase: "checking",
			paid: false,
			schema: CheckedSchema,
			operation: (signal, attempt) =>
				checkEvidence(resolved, research, settings, "alice", signal, (line) =>
					repository.append(id, "worker", line, { phase: "checking", attempt }),
				),
		});
		const repaired = await executeStage(repository, id, "worker", {
			phase: "repair",
			paid: true,
			schema: CheckedSchema,
			operation: (signal, attempt) =>
				repairChecked(
					checked,
					research,
					settings,
					"alice",
					"fixture-token",
					signal,
					(line) =>
						repository.append(id, "worker", line, { phase: "repair", attempt }),
				),
		});
		await executeStage(repository, id, "worker", {
			phase: "rerank",
			paid: true,
			schema: CheckedSchema,
			operation: (signal, attempt) =>
				rerankChecked(repaired, research, settings, "alice", signal, (line) =>
					repository.append(id, "worker", line, { phase: "rerank", attempt }),
				),
		});
		await repository.finalize(id, "worker");
	});
	try {
		const created = await generation.create("alice", crypto.randomUUID(), {
			prompt: "Workout pop playlist",
			trackCount: 2,
			engine: "chatgpt",
			purpose: "comfort",
		});
		const saved = await generation.observe("alice", created.playlist.id);
		expect(saved?.generation?.state).toMatchObject({
			status: "failed",
			phase: "rerank",
			failure: { code: "ambiguous" },
		});
		expect(saved?.playlist.songs.filter((song) => song.songId)).toHaveLength(2);
		expect(saved?.playlist.songs.every((song) => song.evidence)).toBe(true);
		expect(
			fake.requests.filter(
				(request) =>
					new URL(request.url).hostname === "generativelanguage.googleapis.com",
			),
		).toHaveLength(1);
	} finally {
		globalThis.fetch = originalFetch;
		client.close();
	}
});
