export type SpotifyEntityKind = "track" | "playlist" | "artist" | "album";

/** The open.spotify.com URL of an item, the link target the design guidelines require. */
export function spotifyUrl(kind: SpotifyEntityKind, id: string) {
	return `https://open.spotify.com/${kind}/${encodeURIComponent(id)}`;
}
