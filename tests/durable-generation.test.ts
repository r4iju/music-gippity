import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { recoverGenerations } from "~/server/generation/recovery";
import { GenerationRepository } from "~/server/generation/repository";
import * as schema from "~/server/schema";

const input = {
	prompt: "Pop for a heavy workout",
	trackCount: 2,
	engine: "chatgpt" as const,
	purpose: "room" as const,
};
async function setup() {
	const client = createClient({ url: "file::memory:" });
	await client.execute("CREATE TABLE user (id TEXT PRIMARY KEY)");
	await client.execute("CREATE TABLE account (id INTEGER PRIMARY KEY)");
	await client.execute("INSERT INTO user (id) VALUES ('alice'), ('bob')");
	await client.executeMultiple(
		await Bun.file("migrations/0003_durable_generations.sql").text(),
	);
	return {
		client,
		repo: new GenerationRepository(drizzle(client, { schema })),
	};
}

test("server recovery retries lost dispatches without a viewer and fences stale workers", async () => {
	const { repo, client } = await setup();
	try {
		const queued = crypto.randomUUID();
		const stale = crypto.randomUUID();
		await repo.create("alice", queued, input);
		await repo.create("alice", stale, input);
		await repo.claim(stale, "lost-worker");
		await client.execute({
			sql: "UPDATE playlist_generation SET started_at = ? WHERE id = ?",
			args: [Date.now() - 11 * 60_000, stale],
		});
		const dispatch = async (userId: string, id: string) => {
			if (await repo.reserveDispatch(userId, id))
				throw new Error("queue unavailable");
		};
		expect(await recoverGenerations(repo, dispatch)).toEqual({
			dispatched: 0,
			interrupted: 1,
			failed: 1,
		});
		expect((await repo.read("alice", stale))?.playlist.generation.status).toBe(
			"interrupted",
		);
		await expect(
			repo.append(stale, "lost-worker", { kind: "name", name: "late" }),
		).rejects.toThrow();
		await client.execute({
			sql: "UPDATE playlist_generation SET dispatch_until = 0 WHERE id = ?",
			args: [queued],
		});
		const recovered = await recoverGenerations(repo, async (userId, id) => {
			if (await repo.reserveDispatch(userId, id))
				await repo.claim(id, "recovered-worker");
		});
		expect(recovered).toEqual({ dispatched: 1, interrupted: 0, failed: 0 });
		expect((await repo.read("alice", queued))?.playlist.generation.status).toBe(
			"running",
		);
		expect(await repo.recoveryCandidates()).toHaveLength(0);
	} finally {
		client.close();
	}
});

test("creation is idempotent, ownership-scoped and rejects changed inputs", async () => {
	const { repo, client } = await setup();
	try {
		const id = crypto.randomUUID();
		const first = await repo.create("alice", id, input);
		const second = await repo.create("alice", id, input);
		expect(second).toEqual(first);
		expect(await repo.read("bob", id)).toBeNull();
		await expect(
			repo.create("alice", id, { ...input, trackCount: 3 }),
		).rejects.toThrow();
		expect(await repo.list("alice")).toHaveLength(1);
	} finally {
		client.close();
	}
});

test("duplicate workers cannot generate twice; committed progress survives reconnect and cancel fences late writes", async () => {
	const { repo, client } = await setup();
	try {
		const id = crypto.randomUUID();
		await repo.create("alice", id, input);
		expect(await repo.claim(id, "worker-a")).not.toBeNull();
		expect(await repo.claim(id, "worker-b")).toBeNull();
		await repo.append(id, "worker-a", {
			kind: "song",
			id: "slot",
			order: 1,
			title: "Track",
			artist: "Artist",
			source: "recall",
			songId: "spotify-1",
		});
		const snapshot = await repo.read("alice", id);
		expect(snapshot?.playlist.songs).toHaveLength(1);
		expect(snapshot?.revision).toBe(2);
		await repo.cancel("alice", id);
		await expect(
			repo.append(id, "worker-a", { kind: "name", name: "late write" }),
		).rejects.toThrow();
		const cancelled = await repo.read("alice", id);
		expect(cancelled?.playlist.generation.status).toBe("interrupted");
		expect(cancelled?.playlist.songs).toHaveLength(1);
		expect(await repo.claim(id, "worker-c")).toBeNull();
	} finally {
		client.close();
	}
});
