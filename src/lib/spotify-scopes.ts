// What the app asks Spotify for at login, and nothing more: every scope
// here is read or written by a named feature. Adding a scope means
// existing sessions keep the old grant until the listener signs in again.
export const SPOTIFY_SCOPES = [
	// Creating the playlist in the listener's account.
	"playlist-modify-public",
	"playlist-modify-private",
	// Signing in: the profile is the account.
	"user-read-email",
	"user-read-private",
	// The in-app play and pause buttons.
	"user-modify-playback-state",
	// The known set: top tracks, saved tracks and recent plays flag the songs
	// the listener already knows and keep a discovery playlist off them.
	// They are shown to the listener and compared in the app only; they are
	// never sent to an engine.
	"user-top-read",
	"user-library-read",
	"user-read-recently-played",
] as const;
