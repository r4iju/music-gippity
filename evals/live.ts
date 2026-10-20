// Without LIVE_EVAL the test preload swaps in test-only evidence settings and
// fake keys, which silently turns a live run into a broken one.
if (!process.env.LIVE_EVAL)
	throw new Error("Run evals through `bun run eval*`, which sets LIVE_EVAL=1.");

/** A client-credentials token for the dev Spotify app; it cannot read an account. */
export async function clientCredentialsToken(): Promise<string> {
	const id = process.env.SPOTIFY_CLIENT_ID;
	const secret = process.env.SPOTIFY_CLIENT_SECRET;
	if (!id || !secret) throw new Error("SPOTIFY_CLIENT_ID/SECRET missing");
	const res = await fetch("https://accounts.spotify.com/api/token", {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
		},
		body: "grant_type=client_credentials",
	});
	if (!res.ok) throw new Error(`Spotify token HTTP ${res.status}`);
	return ((await res.json()) as { access_token: string }).access_token;
}
