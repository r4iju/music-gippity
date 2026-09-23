// Freezes a signed-in listener's account into evals/listener.json: their top
// artists and the sources of the known set. Evals read the snapshot in place
// of Spotify's /me reads, which a client-credentials token cannot make.
// A real account's snapshot is listening history: keep it local. The committed
// snapshot is a fictional persona built from public catalogue tracks.
// Runs against the app's database for the refresh token:
//   bun run eval:snapshot-listener
// With several Spotify accounts, EVAL_LISTENER names the Spotify account id.
import { writeFile } from "node:fs/promises";
import { env } from "~/env.mjs";
import { spotifyListener } from "~/server/api/listener";
import { drizzle, op, schema } from "~/server/drizzle";
import { type ListenerSnapshot, SNAPSHOT_PATH } from "./listener";

const wanted = process.env.EVAL_LISTENER;
const spotify = op.eq(schema.accounts.provider, "spotify");
const accounts = await drizzle
	.select({
		id: schema.accounts.providerAccountId,
		name: schema.users.name,
		email: schema.users.email,
		refreshToken: schema.accounts.refresh_token,
	})
	.from(schema.accounts)
	.innerJoin(schema.users, op.eq(schema.accounts.userId, schema.users.id))
	.where(
		wanted
			? op.and(spotify, op.eq(schema.accounts.providerAccountId, wanted))
			: spotify,
	);
const account = accounts.length === 1 ? accounts[0] : undefined;
if (!account?.refreshToken)
	throw new Error(
		accounts.length
			? `Choose a listener with EVAL_LISTENER=<Spotify account id>: ${accounts
					.map(
						(candidate) =>
							`${candidate.id} (${candidate.name ?? "?"}, ${candidate.email ?? "no email"})`,
					)
					.join(", ")}`
			: `No Spotify account${wanted ? ` ${wanted}` : ""} with a refresh token is linked`,
	);

const exchange = await fetch("https://accounts.spotify.com/api/token", {
	method: "POST",
	headers: {
		"Content-Type": "application/x-www-form-urlencoded",
		Authorization: `Basic ${btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`)}`,
	},
	body: new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: account.refreshToken,
	}),
});
if (!exchange.ok)
	throw new Error(
		`Spotify token HTTP ${exchange.status}: ${await exchange.text()}`,
	);
const grant = (await exchange.json()) as {
	access_token: string;
	refresh_token?: string;
};
// Spotify may rotate the refresh token. The app keeps a rotated one only in
// its session, so the row is updated here for the next snapshot.
if (grant.refresh_token && grant.refresh_token !== account.refreshToken) {
	await drizzle
		.update(schema.accounts)
		.set({ refresh_token: grant.refresh_token })
		.where(
			op.and(spotify, op.eq(schema.accounts.providerAccountId, account.id)),
		);
	process.stdout.write(
		"Spotify rotated the refresh token; the account row now holds the new one\n",
	);
}
const token = grant.access_token;

const listener = spotifyListener(token);
const snapshot: ListenerSnapshot = {
	takenAt: new Date().toISOString(),
	savedTracks: await listener.savedTracks(),
	topTracks: await listener.topTracks(),
	recentTracks: await listener.recentTracks(),
};
await writeFile(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, "\t")}\n`);
process.stdout.write(
	`Wrote ${SNAPSHOT_PATH}: ${snapshot.savedTracks.length} saved, ${snapshot.topTracks.length} top and ${snapshot.recentTracks.length} recent tracks\n`,
);
drizzle.$client.close();
