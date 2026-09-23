import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
	index,
	integer,
	sqliteTable,
	text,
	unique,
} from "drizzle-orm/sqlite-core";
import type { EngineId } from "~/lib/engines";
import type { PlaylistContents, RunState } from "~/lib/generation-run";
import type { Intent } from "~/lib/intent";
import type { PlaylistDraft } from "~/lib/playlist-generation";
import { PURPOSES } from "~/lib/purpose";

// users table (referenced by several models)
export const users = sqliteTable("user", {
	id: text("id")
		.primaryKey()
		.notNull()
		.$defaultFn(() => createId()),
	name: text("name"),
	email: text("email").unique(),
	emailVerified: text("emailVerified"), // allows NULL by default
	image: text("image"),
	role: text("role").notNull().default("USER"),
});

export const playlistGenerations = sqliteTable(
	"playlist_generation",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id),
		state: text("state", { mode: "json" }).$type<PlaylistDraft>().notNull(),
		revision: integer("revision").notNull().default(0),
		workerId: text("worker_id"),
		dispatchUntil: integer("dispatch_until").notNull().default(0),
		startedAt: integer("started_at"),
		finishedAt: integer("finished_at"),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		index("playlist_generation_user_created_idx").on(
			table.userId,
			table.createdAt,
		),
	],
);

export const playlistDrafts = sqliteTable(
	"playlist_draft",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id),
		contents: text("contents", { mode: "json" })
			.$type<PlaylistContents>()
			.notNull(),
		revision: integer("revision").notNull().default(0),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		index("playlist_draft_user_created_idx").on(table.userId, table.createdAt),
	],
);

export const generationRuns = sqliteTable(
	"generation_run",
	{
		id: text("id").primaryKey(),
		playlistId: text("playlist_id")
			.notNull()
			.unique()
			.references(() => playlistDrafts.id),
		userId: text("user_id")
			.notNull()
			.references(() => users.id),
		requestKey: text("request_key").notNull(),
		state: text("state", { mode: "json" }).$type<RunState>().notNull(),
		workerId: text("worker_id"),
		dispatchUntil: integer("dispatch_until").notNull().default(0),
		startedAt: integer("started_at"),
		finishedAt: integer("finished_at"),
		deadline: integer("deadline"),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		unique("generation_run_owner_request_unique").on(
			table.userId,
			table.requestKey,
		),
	],
);

// Account model
export const generationCheckpoints = sqliteTable("generation_checkpoint", {
	id: text("id").primaryKey(),
	runId: text("run_id")
		.notNull()
		.references(() => generationRuns.id),
	phase: text("phase").notNull(),
	version: integer("version").notNull().default(1),
	attempt: text("attempt").notNull(),
	paid: integer("paid", { mode: "boolean" }).notNull(),
	deadline: integer("deadline").notNull(),
	completedAt: integer("completed_at"),
	output: text("output", { mode: "json" }).$type<unknown>(),
});

export const accounts = sqliteTable(
	"account",
	{
		id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
		userId: text("userId")
			.notNull()
			.references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
		type: text("type").notNull(),
		provider: text("provider").notNull(),
		providerAccountId: text("providerAccountId").notNull(),
		refresh_token: text("refresh_token"),
		access_token: text("access_token"),
		expires_at: integer("expires_at"),
		refreshLeaseUntil: integer("refresh_lease_until").notNull().default(0),
		token_type: text("token_type"),
		scope: text("scope"),
		id_token: text("id_token"),
		session_state: text("session_state"),
		createdAt: text("createdAt").default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text("updatedAt").default(sql`CURRENT_TIMESTAMP`),
	},
	(account) => [
		index("account_user_id_idx").on(account.userId),
		unique("account_provider_account_unique").on(
			account.provider,
			account.providerAccountId,
		),
	],
);

// Session model
export const sessions = sqliteTable(
	"session",
	{
		id: text("id").primaryKey(),
		sessionToken: text("sessionToken").notNull().unique(),
		userId: text("userId")
			.notNull()
			.references(() => users.id),
		expires: text("expires").notNull(),
	},
	(session) => [index("session_user_id_idx").on(session.userId)],
);

// VerificationToken model
export const verificationTokens = sqliteTable(
	"verification_token",
	{
		identifier: text("identifier").notNull(),
		token: text("token").notNull(),
		expires: text("expires").notNull(), // stored as an ISO string
	},
	(vt) => [
		unique("verification_token_token_unique").on(vt.token),
		unique("verification_token_identifier_token_unique").on(
			vt.identifier,
			vt.token,
		),
	],
);

// LLM Token Usage model
export const llmTokenUsage = sqliteTable("llm_token_usage", {
	id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => users.id),
	engine: text("engine").$type<EngineId>().notNull(),
	inputTokens: integer("input_tokens").notNull(),
	outputTokens: integer("output_tokens").notNull(),
	totalTokens: integer("total_tokens").notNull(),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Playlist model
export const playlists = sqliteTable(
	"playlist",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id),
		prompt: text("prompt").notNull(),
		length: integer("length").notNull(),
		name: text("name").notNull(),
		description: text("description").notNull(),
		error: text("error").notNull().default(""),
		isExported: integer("is_exported", { mode: "boolean" })
			.notNull()
			.default(false),
		// Spotify's id for the exported playlist, so the app can link back to
		// it; null for rows exported before the column existed.
		spotifyPlaylistId: text("spotify_playlist_id"),
		// json array of strings
		selectedEngine: text("selected_engine")
			.$type<EngineId>()
			.notNull()
			.default("chatgpt"),
		selectedMood: text("selected_mood").notNull().default(""),
		selectedTrackCount: integer("selected_track_count").notNull().default(10),
		selectedArtists: text("selected_artists", { mode: "json" })
			.$type<string[]>()
			.notNull()
			.default([]),
		ignoredArtists: text("ignored_artists", { mode: "json" })
			.$type<string[]>()
			.notNull()
			.default([]),
		recommendations: text("recommendations", { mode: "json" })
			.$type<{ value: string; label: string }[]>()
			.notNull()
			.default([]),
		selectedGenres: text("selected_genres", { mode: "json" })
			.$type<string[]>()
			.notNull()
			.default([]),
		intent: text("intent", { mode: "json" }).$type<Intent | null>(),
		// Null for playlists saved before purpose existed.
		purpose: text("purpose", { enum: PURPOSES }),
	},
	(playlist) => [index("playlist_user_id_idx").on(playlist.userId)],
);

// Song model
export const songs = sqliteTable(
	"song",
	{
		id: text("id").primaryKey(), // consider generating a uuid externally
		playlistId: text("playlist_id")
			.notNull()
			.references(() => playlists.id),
		order: integer("order").notNull(),
		title: text("title").notNull(),
		artist: text("artist").notNull(),
		songId: text("song_id"),
		previewUrl: text("preview_url"),
		albumTitle: text("album_title"),
		albumImage: text("album_image"),
		albumYear: integer("album_year"),
	},
	(song) => [index("song_playlist_id_idx").on(song.playlistId)],
);

// Log model
export const logs = sqliteTable("log", {
	id: text("id").primaryKey(),
	createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
	level: text("level").notNull(),
	message: text("message").notNull(),
	meta: text("meta"),
});
