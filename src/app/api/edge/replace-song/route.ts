import type { ServerRuntime } from "next";
import { v4 as uuidv4 } from "uuid";
import { ReplaceSongSchema } from "~/app/dashboard/create-playlist/playlist-form-schema";
import type { Song } from "~/contexts/playlist-provider";
import type { Intent } from "~/lib/intent";
import { UNRESOLVED } from "~/lib/resolution";
import { suggestReplacement } from "~/server/api/replacement";
import { findSpotifyTrack } from "~/server/api/spotify";
import { auth } from "~/server/auth";
import { logger } from "~/utils";

export const runtime = "edge" satisfies ServerRuntime;

async function enrichSongWithSpotify(
	song: { artist: string; title: string },
	spotifyToken: string,
	intent: Intent | null,
): Promise<Song> {
	const base = {
		id: uuidv4(),
		order: 0,
		artist: song.artist,
		title: song.title,
	};
	try {
		return await findSpotifyTrack({ song: base, token: spotifyToken, intent });
	} catch (err) {
		logger.error("Error enriching song with Spotify:", err as Error);
		return {
			...base,
			songId: null,
			previewUrl: null,
			albumImage: null,
			albumTitle: null,
			albumYear: null,
			resolution: UNRESOLVED,
		};
	}
}

export async function POST(req: Request) {
	const session = await auth();
	if (!session) return new Response("Unauthorized", { status: 401 });
	const spotifyToken = session.user.accessToken;

	try {
		const body: unknown = await req.json();
		const data = ReplaceSongSchema.parse(body);

		const suggestion = await suggestReplacement(
			data.engine,
			{
				prompt: data.prompt,
				playlistName: data.playlistName,
				playlistDescription: data.playlistDescription,
				currentSongs: data.currentSongs,
				avoidedSongs: data.avoidedSongs,
				purpose: data.purpose,
			},
			data.creativity,
		);
		if (!suggestion) throw new Error("Engine returned no usable song");

		const finalSong = await enrichSongWithSpotify(
			suggestion,
			spotifyToken,
			data.intent,
		);
		return Response.json(finalSong);
	} catch (error) {
		logger.error("Error in replace-song:", error as Error);
		return Response.json({ error: "Failed to replace song" }, { status: 500 });
	}
}
