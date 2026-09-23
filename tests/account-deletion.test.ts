import { expect, test } from "bun:test";
import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { emptyDraft } from "~/lib/playlist-generation";
import { accountRouter } from "~/server/api/routers/account";
import { createCallerFactory } from "~/server/api/trpc";
import * as schema from "~/server/schema";

const MIGRATIONS = [
	"0000_clean_ink",
	"0001_even_mandarin",
	"0002_charming_master_mold",
	"0003_durable_generations",
	"0004_checkpointed_playlists",
	"0005_generation_checkpoints",
	"0006_wise_blazing_skull",
];

const USER_TABLES = [
	["user", "id"],
	["account", "userId"],
	["session", "userId"],
	["llm_token_usage", "user_id"],
	["playlist", "user_id"],
	["playlist_generation", "user_id"],
	["playlist_draft", "user_id"],
	["generation_run", "user_id"],
] as const;

async function setup() {
	const client = createClient({ url: "file::memory:" });
	// The procedure must order deletes itself; enforcing foreign keys makes a
	// parent-first delete fail loudly instead of leaving orphans.
	await client.execute("PRAGMA foreign_keys = ON");
	for (const name of MIGRATIONS)
		await client.executeMultiple(
			await Bun.file(`migrations/${name}.sql`).text(),
		);
	const db = drizzle(client, { schema });
	for (const user of ["alice", "bob"]) await seedUser(db, user);
	return { client, db };
}

async function seedUser(db: ReturnType<typeof drizzle>, userId: string) {
	const now = Date.now();
	await db
		.insert(schema.users)
		.values({ id: userId, name: userId, email: `${userId}@example.com` });
	await db.insert(schema.accounts).values({
		userId,
		type: "oauth",
		provider: "spotify",
		providerAccountId: `spotify-${userId}`,
		access_token: "access",
		refresh_token: "refresh",
	});
	await db.insert(schema.sessions).values({
		id: `session-${userId}`,
		sessionToken: `token-${userId}`,
		userId,
		expires: new Date(now + 60_000).toISOString(),
	});
	await db.insert(schema.verificationTokens).values({
		identifier: `${userId}@example.com`,
		token: `verify-${userId}`,
		expires: new Date(now + 60_000).toISOString(),
	});
	await db.insert(schema.llmTokenUsage).values({
		userId,
		engine: "chatgpt",
		inputTokens: 10,
		outputTokens: 20,
		totalTokens: 30,
	});
	await db.insert(schema.playlists).values({
		id: `playlist-${userId}`,
		userId,
		prompt: "Pop for a heavy workout",
		length: 2,
		name: "Workout",
		description: "",
	});
	await db.insert(schema.songs).values([
		{
			id: `song-${userId}-1`,
			playlistId: `playlist-${userId}`,
			order: 1,
			title: "Track A",
			artist: "Artist A",
		},
		{
			id: `song-${userId}-2`,
			playlistId: `playlist-${userId}`,
			order: 2,
			title: "Track B",
			artist: "Artist B",
		},
	]);
	await db.insert(schema.playlistGenerations).values({
		id: `generation-${userId}`,
		userId,
		state: emptyDraft(),
		createdAt: now,
		updatedAt: now,
	});
	await db.insert(schema.playlistDrafts).values({
		id: `draft-${userId}`,
		userId,
		contents: { ...emptyDraft(), id: `draft-${userId}` },
		createdAt: now,
		updatedAt: now,
	});
	await db.insert(schema.generationRuns).values({
		id: `run-${userId}`,
		playlistId: `draft-${userId}`,
		userId,
		requestKey: `request-${userId}`,
		state: { status: "queued" } as never,
		createdAt: now,
		updatedAt: now,
	});
	await db.insert(schema.generationCheckpoints).values({
		id: `checkpoint-${userId}`,
		runId: `run-${userId}`,
		phase: "curation",
		attempt: "attempt-1",
		paid: true,
		deadline: now + 60_000,
	});
}

async function count(client: Client, sql: string, arg: string) {
	const result = await client.execute({ sql, args: [arg] });
	return Number(result.rows[0]?.n);
}

async function rowsFor(client: Client, userId: string) {
	const counts: Record<string, number> = {};
	for (const [table, column] of USER_TABLES)
		counts[table] = await count(
			client,
			`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`,
			userId,
		);
	counts.song = await count(
		client,
		"SELECT COUNT(*) AS n FROM song WHERE playlist_id IN (SELECT id FROM playlist WHERE user_id = ?)",
		userId,
	);
	counts.generation_checkpoint = await count(
		client,
		"SELECT COUNT(*) AS n FROM generation_checkpoint WHERE run_id IN (SELECT id FROM generation_run WHERE user_id = ?)",
		userId,
	);
	counts.verification_token = await count(
		client,
		"SELECT COUNT(*) AS n FROM verification_token WHERE identifier = ?",
		`${userId}@example.com`,
	);
	return counts;
}

test("deleteAccount removes every row of the caller and nothing of anyone else", async () => {
	const { client, db } = await setup();
	try {
		const before = await rowsFor(client, "bob");
		expect(
			Object.values(await rowsFor(client, "alice")).every((n) => n > 0),
		).toBe(true);

		const caller = createCallerFactory(accountRouter)({
			session: { user: { id: "alice" } } as never,
			drizzle: db,
			schema,
			op: {} as never,
		});
		await caller.deleteAccount();

		const after = await rowsFor(client, "alice");
		expect(Object.values(after).every((n) => n === 0)).toBe(true);
		expect(Object.keys(after).sort()).toEqual(
			[
				...USER_TABLES.map(([table]) => table),
				"song",
				"generation_checkpoint",
				"verification_token",
			].sort(),
		);
		expect(await rowsFor(client, "bob")).toEqual(before);
		expect(
			(await client.execute("PRAGMA foreign_key_check")).rows,
		).toHaveLength(0);
	} finally {
		client.close();
	}
});
