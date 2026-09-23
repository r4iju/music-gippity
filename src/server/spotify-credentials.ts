import { and, eq, isNull, lte } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";
import * as schema from "~/server/schema";

export const SpotifyTokenSchema = z.object({
	access_token: z.string().min(1),
	refresh_token: z.string().min(1).optional(),
	expires_in: z.number().positive(),
});
type Token = z.infer<typeof SpotifyTokenSchema>;

/** DB-backed credential source shared by HTTP sessions and detached workers. */
export async function spotifyTokenFor(
	db: LibSQLDatabase<typeof schema>,
	userId: string,
	refresh: (token: string) => Promise<Token>,
	minimumValidityMs = 60_000,
) {
	const table = schema.accounts;
	for (let attempt = 0; attempt < 40; attempt++) {
		const [row] = await db
			.select({
				id: table.id,
				access: table.access_token,
				refresh: table.refresh_token,
				expires: table.expires_at,
			})
			.from(table)
			.where(and(eq(table.userId, userId), eq(table.provider, "spotify")));
		if (!row)
			throw new Error("Reconnect your Spotify account to generate playlists.");
		if (
			row.access &&
			row.expires &&
			row.expires * 1000 > Date.now() + minimumValidityMs
		)
			return { accessToken: row.access, expiresAt: row.expires * 1000 };
		if (!row.refresh)
			throw new Error("Reconnect your Spotify account to generate playlists.");
		const lease = Date.now() + 15_000;
		const locked = await db
			.update(table)
			.set({ refreshLeaseUntil: lease })
			.where(
				and(
					eq(table.id, row.id),
					lte(table.refreshLeaseUntil, Date.now()),
					eq(table.refresh_token, row.refresh),
					row.expires === null
						? isNull(table.expires_at)
						: eq(table.expires_at, row.expires),
				),
			)
			.returning({ id: table.id });
		if (!locked.length) {
			await new Promise((resolve) => setTimeout(resolve, 500));
			continue;
		}
		try {
			const token = SpotifyTokenSchema.parse(await refresh(row.refresh));
			await db
				.update(table)
				.set({
					access_token: token.access_token,
					refresh_token: token.refresh_token ?? row.refresh,
					expires_at: Math.floor(Date.now() / 1000) + token.expires_in,
					refreshLeaseUntil: 0,
				})
				.where(and(eq(table.id, row.id), eq(table.refreshLeaseUntil, lease)));
		} finally {
			await db
				.update(table)
				.set({ refreshLeaseUntil: 0 })
				.where(and(eq(table.id, row.id), eq(table.refreshLeaseUntil, lease)));
		}
	}
	throw new Error("Spotify credentials are busy. Please try again.");
}
