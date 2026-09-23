import { mock } from "bun:test";
import type { EngineId } from "~/lib/engines";

Object.assign(process.env, { NODE_ENV: "test" });
// Evals preload this file too but run on a real env file, so they keep its
// validation, whose defaults set the real evidence pacing, and leave an
// absent Last.fm key off.
if (!process.env.LIVE_EVAL) {
	// The env schema is validated at import time; tests run without a real .env.
	process.env.SKIP_ENV_VALIDATION = "1";
	process.env.OPENAI_KEY ??= "test-openai-key";
	process.env.OPENAI_ORGANIZATION_ID ??= "test-openai-org";
	process.env.GEMINI_API_KEY ??= "test-gemini-key";
	process.env.LASTFM_API_KEY ??= "test-lastfm-key";
	// Evidence settings are read at load time: no MusicBrainz pacing, and a
	// deadline short enough for a test to overrun on purpose.
	process.env.MUSICBRAINZ_INTERVAL_MS = "0";
	process.env.EVIDENCE_DEADLINE_MS = "200";
}

export const TEST_SESSION = {
	user: { id: "user-1", accessToken: "spotify-token" },
};

export interface TokenUsageInsert {
	userId: string;
	engine: EngineId;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

export const tokenUsageInserts: TokenUsageInsert[] = [];

/** Songs from the listener's earlier playlists, as the known-set query returns them. */
export const appSongRows: { songId: string | null; artist: string }[] = [];
/** The column and value each earlier-playlist query was filtered by, and its row cap. */
export const appSongQueries: { where: [unknown, unknown]; limit: number }[] =
	[];
/** Set to make the earlier-playlist query fail. */
export const appSongFailure: { error: Error | null } = { error: null };

mock.module("~/server/auth", () => ({
	auth: async () => TEST_SESSION,
}));

mock.module("~/server/drizzle", () => ({
	drizzle: {
		select: () => ({
			from: () => ({
				innerJoin: () => ({
					where: (condition: { eq: [unknown, unknown] }) => ({
						orderBy: () => ({
							limit: async (limit: number) => {
								if (appSongFailure.error) throw appSongFailure.error;
								appSongQueries.push({ where: condition.eq, limit });
								return appSongRows.slice(0, limit);
							},
						}),
					}),
				}),
			}),
		}),
		insert: () => ({
			values: async (row: TokenUsageInsert) => {
				tokenUsageInserts.push(row);
			},
		}),
	},
	schema: {
		llmTokenUsage: {},
		songs: {
			songId: "song.song_id",
			artist: "song.artist",
			playlistId: "song.playlist_id",
		},
		playlists: { id: "playlist.id", userId: "playlist.user_id" },
	},
	op: {
		eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
		sql: () => ({}),
	},
}));

// Keep test output readable; the routes log every prompt and chunk.
for (const level of ["log", "debug", "info", "warn", "error"] as const) {
	console[level] = () => {};
}
