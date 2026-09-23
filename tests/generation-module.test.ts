import { expect, setSystemTime, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { z } from "zod";
import { GenerationModule } from "~/server/generation/module";
import { RunRepository } from "~/server/generation/run-repository";
import { executeStage } from "~/server/generation/stage";
import * as schema from "~/server/schema";

test("create, observe and cancel retain one owner-scoped generation when dispatch fails", async () => {
	const client = createClient({ url: "file::memory:" });
	await client.executeMultiple(
		"CREATE TABLE user (id TEXT PRIMARY KEY); CREATE TABLE account (id INTEGER PRIMARY KEY); INSERT INTO user VALUES ('alice'), ('bob');",
	);
	await client.executeMultiple(
		await Bun.file("migrations/0003_durable_generations.sql").text(),
	);
	await client.executeMultiple(
		await Bun.file("migrations/0004_checkpointed_playlists.sql").text(),
	);
	const generation = new GenerationModule(
		drizzle(client, { schema }),
		async () => {
			throw new Error("queue unavailable");
		},
	);
	try {
		const id = crypto.randomUUID();
		const input = {
			prompt: "Workout pop",
			trackCount: 2,
			engine: "chatgpt" as const,
		};
		const first = await generation.create("alice", id, input);
		expect(first.generation?.id).toBeString();
		expect(first.generation?.id).not.toBe(first.playlist.id);
		const otherOwner = await generation.create("bob", id, input);
		expect(otherOwner.playlist.id).not.toBe(first.playlist.id);
		expect(await generation.create("alice", id, input)).toEqual(first);
		expect(await generation.observe("alice", first.playlist.id)).toEqual(first);
		expect(await generation.observe("bob", first.playlist.id)).toBeNull();
		expect(await generation.cancel("bob", first.playlist.id)).toBeNull();
		await generation.cancel("alice", first.playlist.id);
		expect(
			(await generation.observe("alice", first.playlist.id))?.generation?.state
				.status,
		).toBe("cancelled");
		await expect(
			generation.create("alice", id, { ...input, trackCount: 3 }),
		).rejects.toThrow();
	} finally {
		client.close();
	}
});

test("worker redelivery reuses confirmed research and uncertain paid work fails without replay", async () => {
	const client = createClient({ url: "file::memory:" });
	await client.executeMultiple(
		"CREATE TABLE user (id TEXT PRIMARY KEY); CREATE TABLE account (id INTEGER PRIMARY KEY); INSERT INTO user VALUES ('alice');",
	);
	for (const migration of [
		"0003_durable_generations",
		"0004_checkpointed_playlists",
		"0005_generation_checkpoints",
	])
		await client.executeMultiple(
			await Bun.file(`migrations/${migration}.sql`).text(),
		);
	const db = drizzle(client, { schema });
	const worker = new RunRepository(db);
	let runId = "";
	const generation = new GenerationModule(db, async (id) => {
		runId = id;
		await worker.claim(id, "qa-worker");
	});
	try {
		const playlist = await generation.create("alice", crypto.randomUUID(), {
			prompt: "Workout pop playlist",
			trackCount: 2,
			engine: "chatgpt",
		});
		let engineCalls = 0;
		const research = {
			phase: "intent" as const,
			paid: true,
			schema: z.object({ mood: z.string() }),
			operation: async () => {
				engineCalls++;
				return { mood: "energetic" };
			},
		};
		expect(await executeStage(worker, runId, "qa-worker", research)).toEqual({
			mood: "energetic",
		});
		expect(await executeStage(worker, runId, "qa-worker", research)).toEqual({
			mood: "energetic",
		});
		expect(engineCalls).toBe(1);
		const uncertain = {
			phase: "retrieval" as const,
			paid: true,
			schema: z.object({ mood: z.string() }),
			operation: async () => {
				engineCalls++;
				throw new Error("response lost after engine accepted request");
			},
		};
		await expect(
			executeStage(worker, runId, "qa-worker", uncertain),
		).rejects.toThrow();
		await expect(
			executeStage(worker, runId, "qa-worker", uncertain),
		).rejects.toThrow();
		expect(engineCalls).toBe(2);
		const saved = await generation.observe("alice", playlist.playlist.id);
		expect(saved?.generation?.state).toMatchObject({
			status: "failed",
			phase: "retrieval",
			failure: { code: "ambiguous" },
		});
	} finally {
		client.close();
	}
});

test("recovery reports a lost paid attempt as ambiguous without dispatching it again", async () => {
	const client = createClient({ url: "file::memory:" });
	await client.executeMultiple(
		"CREATE TABLE user (id TEXT PRIMARY KEY); CREATE TABLE account (id INTEGER PRIMARY KEY); INSERT INTO user VALUES ('alice');",
	);
	for (const migration of [
		"0003_durable_generations",
		"0004_checkpointed_playlists",
		"0005_generation_checkpoints",
	])
		await client.executeMultiple(
			await Bun.file(`migrations/${migration}.sql`).text(),
		);
	const db = drizzle(client, { schema });
	const worker = new RunRepository(db);
	let dispatches = 0;
	const generation = new GenerationModule(db, async (id) => {
		dispatches++;
		await worker.claim(id, "lost-worker");
		await worker.beginStage(id, "lost-worker", "retrieval", true);
		// Simulate process loss after dispatch, before any result can be persisted.
	});
	try {
		const created = await generation.create("alice", crypto.randomUUID(), {
			prompt: "Workout pop playlist",
			trackCount: 2,
			engine: "chatgpt",
		});
		setSystemTime(Date.now() + 11 * 60_000);
		await generation.recover();
		expect(
			(await generation.observe("alice", created.playlist.id))?.generation
				?.state,
		).toMatchObject({
			status: "failed",
			phase: "retrieval",
			failure: { code: "ambiguous" },
		});
		expect(dispatches).toBe(1);
	} finally {
		setSystemTime();
		client.close();
	}
});

test("a lost database commit acknowledgement still exposes confirmed research without another paid attempt", async () => {
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
	let loseAcknowledgement = false;
	const faultedClient = new Proxy(client, {
		get(target, key) {
			if (key === "transaction")
				return async (...args: Parameters<typeof client.transaction>) => {
					const transaction = await target.transaction(...args);
					return new Proxy(transaction, {
						get(tx, property) {
							if (property === "commit")
								return async () => {
									await tx.commit();
									if (loseAcknowledgement) {
										loseAcknowledgement = false;
										throw new Error("commit response lost");
									}
								};
							const value = Reflect.get(tx, property);
							return typeof value === "function" ? value.bind(tx) : value;
						},
					});
				};
			const value = Reflect.get(target, key);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	const db = drizzle(faultedClient, { schema });
	const worker = new RunRepository(db);
	let paidAttempts = 0;
	const generation = new GenerationModule(db, async (id) => {
		await worker.claim(id, "worker");
		await executeStage(worker, id, "worker", {
			phase: "intent",
			paid: true,
			schema: z.object({ name: z.string() }),
			progress: (output) => [{ kind: "name", name: output.name }],
			operation: async () => {
				paidAttempts++;
				loseAcknowledgement = true;
				return { name: "Confirmed research" };
			},
		});
	});
	try {
		const created = await generation.create("alice", crypto.randomUUID(), {
			prompt: "Workout pop playlist",
			trackCount: 2,
			engine: "chatgpt",
		});
		const saved = await generation.observe("alice", created.playlist.id);
		expect(saved?.generation?.state.status).toBe("running");
		expect(saved?.playlist.name).toBe("Confirmed research");
		expect(paidAttempts).toBe(1);
	} finally {
		client.close();
	}
});

test("credential preparation can retry and confirmed research does not need credentials again", async () => {
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
	const worker = new RunRepository(db);
	let credentialReads = 0;
	let paidAttempts = 0;
	const generation = new GenerationModule(db, async (id) => {
		await worker.claim(id, "worker");
		const stage = {
			phase: "retrieval" as const,
			paid: true,
			schema: z.object({ name: z.string() }),
			prepare: async () => {
				credentialReads++;
				if (credentialReads === 1)
					throw new Error("credential service unavailable");
			},
			operation: async () => {
				paidAttempts++;
				return { name: "Recovered research" };
			},
			progress: (output: { name: string }) => [
				{ kind: "name" as const, name: output.name },
			],
		};
		await expect(executeStage(worker, id, "worker", stage)).rejects.toThrow();
		await executeStage(worker, id, "worker", stage);
		await executeStage(worker, id, "worker", stage);
	});
	try {
		const created = await generation.create("alice", crypto.randomUUID(), {
			prompt: "Workout pop playlist",
			trackCount: 2,
			engine: "chatgpt",
		});
		expect(
			(await generation.observe("alice", created.playlist.id))?.playlist.name,
		).toBe("Recovered research");
		expect(credentialReads).toBe(2);
		expect(paidAttempts).toBe(1);
	} finally {
		client.close();
	}
});

test("late progress from an expired resolution attempt cannot overwrite its replacement", async () => {
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
	const worker = new RunRepository(db);
	let runId = "";
	let lateAttempt = "";
	const generation = new GenerationModule(db, async (id) => {
		runId = id;
		await worker.claim(id, "worker");
		const acquired = await worker.beginStage(id, "worker", "resolution", false);
		if (acquired.status === "acquired") lateAttempt = acquired.attempt;
	});
	try {
		const created = await generation.create("alice", crypto.randomUUID(), {
			prompt: "Workout pop playlist",
			trackCount: 2,
			engine: "chatgpt",
		});
		setSystemTime(Date.now() + 4 * 60_000);
		const replacement = await worker.beginStage(
			runId,
			"worker",
			"resolution",
			false,
		);
		if (replacement.status !== "acquired")
			throw new Error("Resolution was not reclaimed");
		await worker.append(
			runId,
			"worker",
			{ kind: "name", name: "New resolution" },
			{ phase: "resolution", attempt: replacement.attempt },
		);
		await expect(
			worker.append(
				runId,
				"worker",
				{ kind: "name", name: "Stale resolution" },
				{ phase: "resolution", attempt: lateAttempt },
			),
		).rejects.toThrow();
		expect(
			(await generation.observe("alice", created.playlist.id))?.playlist.name,
		).toBe("New resolution");
	} finally {
		setSystemTime();
		client.close();
	}
});

test("finalization commits once and cancellation cannot be changed into success", async () => {
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
	const worker = new RunRepository(db);
	const runs: string[] = [];
	const generation = new GenerationModule(db, async (id) => {
		runs.push(id);
		await worker.claim(id, "worker");
		for (const order of [1, 2])
			await worker.append(id, "worker", {
				kind: "song",
				id: `slot-${order}`,
				order,
				artist: `Artist ${order}`,
				title: `Track ${order}`,
				songId: `spotify-${order}`,
				source: "recall",
			});
	});
	try {
		const completed = await generation.create("alice", crypto.randomUUID(), {
			prompt: "Workout pop playlist",
			trackCount: 2,
			engine: "chatgpt",
		});
		const completedRun = runs[0];
		if (!completedRun) throw new Error("Missing completed run");
		await expect(worker.finalize(completedRun, "worker")).rejects.toThrow();
		for (const phase of [
			"intent",
			"retrieval",
			"curation",
			"resolution",
			"checking",
			"repair",
			"rerank",
		] as const)
			await executeStage(worker, completedRun, "worker", {
				phase,
				paid: false,
				schema: z.null(),
				operation: async () => null,
			});
		await worker.finalize(completedRun, "worker");
		const saved = await generation.observe("alice", completed.playlist.id);
		expect(saved?.generation?.state.status).toBe("completed");
		await worker.finalize(completedRun, "worker");
		expect(await generation.observe("alice", completed.playlist.id)).toEqual(
			saved,
		);
		const cancelled = await generation.create("alice", crypto.randomUUID(), {
			prompt: "Workout pop playlist",
			trackCount: 2,
			engine: "chatgpt",
		});
		await generation.cancel("alice", cancelled.playlist.id);
		const cancelledRun = runs[1];
		if (!cancelledRun) throw new Error("Missing cancelled run");
		await worker.finalize(cancelledRun, "worker");
		const retained = await generation.observe("alice", cancelled.playlist.id);
		expect(retained?.generation?.state.status).toBe("cancelled");
		expect(retained?.playlist.songs).toHaveLength(2);
	} finally {
		client.close();
	}
});
