import { env } from "~/env.mjs";
import { drizzle } from "~/server/drizzle";
import {
	SpotifyTokenSchema,
	spotifyTokenFor,
} from "~/server/spotify-credentials";

export const getSpotifyToken = (userId: string, minimumValidityMs = 60_000) =>
	spotifyTokenFor(
		drizzle,
		userId,
		async (refreshToken) => {
			const response = await fetch("https://accounts.spotify.com/api/token", {
				method: "POST",
				signal: AbortSignal.timeout(10_000),
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					client_id: env.SPOTIFY_CLIENT_ID,
					client_secret: env.SPOTIFY_CLIENT_SECRET,
					grant_type: "refresh_token",
					refresh_token: refreshToken,
				}),
			});
			if (!response.ok)
				throw new Error("Spotify authorization expired. Sign in again.");
			return SpotifyTokenSchema.parse(await response.json());
		},
		minimumValidityMs,
	);
