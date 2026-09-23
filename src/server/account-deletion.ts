import { eq, inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "~/server/schema";

type Database = LibSQLDatabase<typeof schema>;

/**
 * Removes every row the user owns, then the user itself, in one transaction.
 *
 * Deletes walk the foreign keys child-first because only `account` cascades
 * from `user` (migration 0000); every other reference is `ON DELETE no action`,
 * so a parent-first order would be rejected once SQLite enforces foreign keys.
 */
export async function deleteUserData(db: Database, userId: string) {
	await db.transaction(async (tx) => {
		const ownedRuns = tx
			.select({ id: schema.generationRuns.id })
			.from(schema.generationRuns)
			.where(eq(schema.generationRuns.userId, userId));
		await tx
			.delete(schema.generationCheckpoints)
			.where(inArray(schema.generationCheckpoints.runId, ownedRuns));
		await tx
			.delete(schema.generationRuns)
			.where(eq(schema.generationRuns.userId, userId));
		await tx
			.delete(schema.playlistDrafts)
			.where(eq(schema.playlistDrafts.userId, userId));
		await tx
			.delete(schema.playlistGenerations)
			.where(eq(schema.playlistGenerations.userId, userId));

		const ownedPlaylists = tx
			.select({ id: schema.playlists.id })
			.from(schema.playlists)
			.where(eq(schema.playlists.userId, userId));
		await tx
			.delete(schema.songs)
			.where(inArray(schema.songs.playlistId, ownedPlaylists));
		await tx
			.delete(schema.playlists)
			.where(eq(schema.playlists.userId, userId));

		await tx
			.delete(schema.llmTokenUsage)
			.where(eq(schema.llmTokenUsage.userId, userId));
		await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
		await tx.delete(schema.accounts).where(eq(schema.accounts.userId, userId));

		const [user] = await tx
			.select({ email: schema.users.email })
			.from(schema.users)
			.where(eq(schema.users.id, userId));
		if (user?.email)
			await tx
				.delete(schema.verificationTokens)
				.where(eq(schema.verificationTokens.identifier, user.email));
		await tx.delete(schema.users).where(eq(schema.users.id, userId));
	});
}
