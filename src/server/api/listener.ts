import {
	type KnownRecording,
	recentTracks,
	savedTracks,
	topTracks,
} from "~/server/api/spotify";

/**
 * What the app reads of a listener's account: the sources of the known
 * set, which only ever flags songs in the app's own interface and keeps a
 * budgeted playlist from repeating them; none of it reaches an engine.
 * Reads that fail throw, as Spotify's do, and the callers decide what a
 * failure means.
 */
export interface Listener {
	savedTracks(): Promise<KnownRecording[]>;
	topTracks(): Promise<KnownRecording[]>;
	recentTracks(): Promise<KnownRecording[]>;
}

/** The signed-in listener, read through their Spotify token. */
export const spotifyListener = (token: string): Listener => ({
	savedTracks: () => savedTracks(token),
	topTracks: () => topTracks(token),
	recentTracks: () => recentTracks(token),
});
