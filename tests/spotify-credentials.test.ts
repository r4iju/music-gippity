import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "~/server/schema";
import { spotifyTokenFor } from "~/server/spotify-credentials";

test("background credentials refresh once, persist rotation and reuse the fresh token", async () => {
	const client = createClient({ url: "file::memory:" });
	await client.execute(
		"CREATE TABLE account (id INTEGER PRIMARY KEY,userId TEXT,provider TEXT,access_token TEXT,refresh_token TEXT,expires_at INTEGER,refresh_lease_until INTEGER NOT NULL DEFAULT 0)",
	);
	await client.execute(
		"INSERT INTO account VALUES(1,'alice','spotify','expired','refresh-old',1,0)",
	);
	let calls = 0;
	const refresh = async () => {
		calls++;
		return {
			access_token: "fresh",
			refresh_token: "refresh-new",
			expires_in: 3600,
		};
	};
	try {
		const db = drizzle(client, { schema });
		expect((await spotifyTokenFor(db, "alice", refresh)).accessToken).toBe(
			"fresh",
		);
		expect((await spotifyTokenFor(db, "alice", refresh)).accessToken).toBe(
			"fresh",
		);
		expect(calls).toBe(1);
		expect(
			(await client.execute("SELECT refresh_token FROM account")).rows[0]
				?.refresh_token,
		).toBe("refresh-new");
	} finally {
		client.close();
	}
});
