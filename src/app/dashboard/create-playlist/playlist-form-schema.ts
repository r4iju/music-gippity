import { z } from "zod";
import { CREATIVITY_LEVELS, DEFAULT_CREATIVITY } from "~/lib/creativity";
import { ENGINE_IDS } from "~/lib/engines";
import { IntentSchema } from "~/lib/intent";
import { DEFAULT_PURPOSE, PURPOSES } from "~/lib/purpose";

export const PlaylistFormSchema = z.object({
	prompt: z
		.string()
		.min(10, "Prompt must be at least 10 characters")
		.max(3000, "Prompt must be less than 3000 characters"),
	trackCount: z.number().min(2, "Min 2 tracks").max(100, "Max 100 tracks"),
	creativity: z.enum(CREATIVITY_LEVELS).default(DEFAULT_CREATIVITY),
	engine: z.enum(ENGINE_IDS),
	purpose: z.enum(PURPOSES).default(DEFAULT_PURPOSE),
});

// Everything here is interpolated into a prompt, hence the size bounds.
const SongLabel = z.string().max(300);
export const ReplaceSongSchema = z.object({
	prompt: z.string().max(3000).optional(), // The original brief, when the client still has it
	playlistName: SongLabel,
	playlistDescription: z.string().max(1000),
	currentSongs: z
		.array(z.object({ artist: SongLabel, title: SongLabel }))
		.max(100),
	avoidedSongs: z.array(SongLabel).max(200), // "Artist - Title" strings to exclude
	targetSongId: z.string(),
	engine: z.enum(ENGINE_IDS).default("gemini"), // Reuse the playlist's engine or default
	creativity: z.enum(CREATIVITY_LEVELS).default(DEFAULT_CREATIVITY),
	// Playlists made before purpose existed have none; they were built for discovery.
	purpose: z.enum(PURPOSES).default(DEFAULT_PURPOSE),
	intent: IntentSchema.nullable().default(null), // What the playlist was read as, when the client still has it
});

export type PlaylistFormSchema = z.infer<typeof PlaylistFormSchema>;
export type PlaylistFormInput = z.input<typeof PlaylistFormSchema>;
export type ReplaceSongSchema = z.infer<typeof ReplaceSongSchema>;
