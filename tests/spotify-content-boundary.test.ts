// Spotify's Developer Policy forbids ingesting Spotify content into an AI
// model. This file holds the line end to end: a full generation runs with a
// fake Spotify that answers with sentinel strings wherever its content can
// appear, and no engine request may carry any of them.
import { afterEach, expect, test } from "bun:test";
import { SPOTIFY_SCOPES } from "~/lib/spotify-scopes";
import {
	artistOf,
	geminiStream,
	installFakeFetch,
	lastfmApi,
	musicbrainzArtists,
	openaiStream,
	post,
	type RecordedRequest,
	readNdjson,
} from "./fake-providers";
import { appSongRows } from "./setup";

const { createPlaylist } = await import("~/server/api/create-playlist");

/**
 * Every string the fake Spotify answers with. Each names where Spotify
 * content enters the app; none may leave it for an engine.
 */
export const SPOTIFY_SENTINELS = [
	// The listener's saved tracks, GET /v1/me/tracks.
	"ZZ-LIBRARY-ARTIST-7Q",
	"ZZ-LIBRARY-TITLE-7Q",
	"ZZLIBRARYID7Q",
	"ZZLIBRARYISRC7Q",
	// The listener's top tracks, GET /v1/me/top/tracks.
	"ZZ-TOP-ARTIST-5M",
	"ZZ-TOP-TITLE-5M",
	"ZZTOPID5M",
	"ZZTOPISRC5M",
	// The listener's recent plays, GET /v1/me/player/recently-played.
	"ZZ-RECENT-ARTIST-2W",
	"ZZ-RECENT-TITLE-2W",
	"ZZRECENTID2W",
	"ZZRECENTISRC2W",
	// Songs from the listener's earlier playlists in the app, resolved on
	// Spotify when they were made.
	"ZZ-APP-ARTIST-9R",
	"ZZAPPSONGID9R",
	// What a curator pick resolved to in the catalogue, GET /v1/search.
	"ZZ-SPOTIFY-TITLE-3K",
	"ZZ-SPOTIFY-ARTIST-3K",
	"ZZ-SPOTIFY-ALBUM-3K",
	"ZZSPOTIFYID3K",
	"ZZSPOTIFYALBUMID3K",
	"ZZISRC3K",
	"ZZPREVIEW3K",
	"ZZIMAGE3K",
] as const;

const ENGINE_HOSTS = ["api.openai.com", "generativelanguage.googleapis.com"];

const BRIEF = "Synthwave for a long night drive, no vocals";

/** A track the listener already has, in Spotify's shape with every field the app could read. */
const accountTrack = (tag: string, code: string) => ({
	id: `ZZ${tag}ID${code}`,
	name: `ZZ-${tag}-TITLE-${code}`,
	artists: [{ name: `ZZ-${tag}-ARTIST-${code}` }],
	external_ids: { isrc: `ZZ${tag}ISRC${code}` },
	album: { id: `ZZ${tag}ALBUM${code}`, name: `ZZ-${tag}-ALBUM-${code}` },
});

/**
 * Every search resolves to a recording whose title, second credit, album,
 * ids and ISRC are Spotify's own words, not the curator's. The pick's
 * artist is credited so the hit is accepted, at the fuzzy tier.
 */
const catalogueHit = (query: string): Response => {
	const artist = artistOf(query);
	const slug = artist.replace(/\W+/g, "-").toLowerCase();
	return Response.json({
		tracks: {
			items: [
				{
					id: `ZZSPOTIFYID3K-${slug}`,
					name: "ZZ-SPOTIFY-TITLE-3K",
					preview_url: "https://p.scdn.co/mp3-preview/ZZPREVIEW3K",
					duration_ms: 200000,
					artists: [{ name: artist }, { name: `ZZ-SPOTIFY-ARTIST-3K-${slug}` }],
					external_ids: { isrc: `ZZISRC3K${slug}` },
					album: {
						id: `ZZSPOTIFYALBUMID3K-${slug}`,
						name: "ZZ-SPOTIFY-ALBUM-3K",
						release_date: "2011-01-01",
						images: [{ url: "https://i.scdn.co/image/ZZIMAGE3K" }],
					},
				},
			],
		},
	});
};

const PICKS = [
	'{"kind":"name","name":"Night Drive"}',
	'{"kind":"description","description":"Instrumental synths."}',
	'{"kind":"song","order":1,"artist":"Artist A","title":"Song A","source":"candidates"}',
	'{"kind":"song","order":2,"artist":"Artist B","title":"Song B","source":"candidates"}',
	'{"kind":"song","order":3,"artist":"Artist C","title":"Song C","source":"recall"}',
].join("\n");

type Reviewed = { id: string; artist: string; title: string };

/**
 * Answers every engine call from its own input: the playlist, a
 * replacement for the pick that never resolves, a vocal review that swaps
 * one recording, its verification, and the rerank.
 */
const engine = (prompt: string): string => {
	if (prompt.startsWith("Build")) return PICKS;
	if (prompt.includes("Suggest ONE new song"))
		return '{"kind":"song","order":-1,"artist":"Artist D","title":"Song D"}';
	if (prompt.startsWith('{"task":"review-vocals"')) {
		const input = JSON.parse(prompt) as {
			allowReplacements: boolean;
			tracks: Reviewed[];
		};
		return JSON.stringify({
			restriction: "no vocals",
			tracks: input.tracks.map((track) =>
				input.allowReplacements && track.artist === "Artist A"
					? {
							id: track.id,
							verdict: "vocals",
							reason: "Sung throughout.",
							replacement: { artist: "Artist E", title: "Song E" },
						}
					: {
							id: track.id,
							verdict: "instrumental",
							briefFit: "fit",
							reason: "No voices.",
						},
			),
		});
	}
	if (prompt.startsWith('{"task":"rerank"')) {
		const input = JSON.parse(prompt) as { tracks: Reviewed[] };
		return JSON.stringify({
			order: input.tracks.map((track) => track.id),
			prune: [],
			reasons: Object.fromEntries(
				input.tracks.map((track) => [track.id, `${track.artist} fits`]),
			),
		});
	}
	return "";
};

/** A generation that reads the account, resolves, reviews, replaces and reranks. */
async function generate() {
	appSongRows.push({ songId: "ZZAPPSONGID9R", artist: "ZZ-APP-ARTIST-9R" });
	const fake = installFakeFetch({
		intent: () =>
			geminiStream(
				JSON.stringify({
					genres: ["synthwave"],
					vocalRule: { rule: "no-vocals", quote: "no vocals" },
				}),
			),
		scene: () => '{"tags":["synthwave"],"area":null,"labels":[]}',
		musicbrainzSearch: () =>
			musicbrainzArtists([{ id: "mb-artist-a", name: "Artist A" }]),
		lastfm: lastfmApi({ charts: { synthwave: [["Artist B", "Song B"]] } }),
		gemini: (prompt) => geminiStream(engine(prompt)),
		openai: (prompt) => openaiStream(engine(prompt)),
		spotify: (query) =>
			query.includes("Artist C")
				? Response.json({ tracks: { items: [] } })
				: catalogueHit(query),
		library: () =>
			Response.json({
				items: [
					{ track: accountTrack("LIBRARY", "7Q") },
					// A pick's artist, so the known set marks a song.
					{
						track: {
							id: "known-b",
							name: "Song B",
							artists: [{ name: "Artist B" }],
							external_ids: {},
						},
					},
				],
				total: 2,
			}),
		topTracks: () => Response.json({ items: [accountTrack("TOP", "5M")] }),
		recent: () =>
			Response.json({ items: [{ track: accountTrack("RECENT", "2W") }] }),
	});
	const lines = await readNdjson(
		await createPlaylist(
			post("/api/edge/create-playlist", {
				prompt: BRIEF,
				trackCount: 3,
				creativity: "balanced",
				engine: "gemini",
				purpose: "discover",
			}),
		),
	);
	return { fake, lines };
}

const isEngineCall = (request: RecordedRequest) =>
	ENGINE_HOSTS.includes(new URL(request.url).hostname);

const promptOf = (request: RecordedRequest): string => {
	const contents = request.body.contents as
		| { parts: { text: string }[] }[]
		| undefined;
	const messages = request.body.messages as { content: string }[] | undefined;
	return contents?.[0]?.parts[0]?.text ?? messages?.at(-1)?.content ?? "";
};

afterEach(() => {
	appSongRows.length = 0;
});

test("nothing read from Spotify reaches an engine, while every stage that reads it runs", async () => {
	const { fake, lines } = await generate();

	// Spotify content did enter the app: picks resolved to the catalogue's
	// recordings and the known set flagged a song.
	const songs = [
		...new Map(
			lines.filter((l) => l.kind === "song").map((l) => [l.id, l]),
		).values(),
	].sort((a, b) => (a.order as number) - (b.order as number));
	expect(songs.map((s) => [s.artist, s.origin])).toEqual([
		["Artist E", "repair"],
		["Artist B", "pick"],
		["Artist D", "replacement"],
	]);
	expect(songs.every((s) => String(s.songId).startsWith("ZZSPOTIFYID3K"))).toBe(
		true,
	);
	expect(songs.map((s) => s.familiarity)).toEqual([
		"new",
		"known-artist",
		"new",
	]);
	expect(lines.find((l) => l.kind === "novelty")).toMatchObject({
		status: "ok",
	});
	expect(lines.find((l) => l.kind === "rerank")).toMatchObject({
		status: "ok",
	});
	expect(
		lines.filter((l) => l.kind === "vocal-review").map((l) => l.status),
	).toEqual(["ok", "ok"]);
	expect(lines.find((l) => l.kind === "vocal-repair")).toMatchObject({
		outcome: "accepted",
	});

	// Every kind of engine call went out.
	const engineCalls = [
		...fake.intentReads,
		...fake.scenePlans,
		...fake.requests.filter(isEngineCall),
	];
	const prompts = engineCalls.map(promptOf);
	for (const stage of [
		'{"task":"read-brief"',
		'{"task":"plan-scene"',
		"Build a 3-track playlist",
		"Suggest ONE new song",
		`{"task":"review-vocals","brief":"${BRIEF}","allowReplacements":true`,
		`{"task":"review-vocals","brief":"${BRIEF}","allowReplacements":false`,
		'{"task":"rerank"',
	])
		expect(prompts.some((prompt) => prompt.includes(stage))).toBe(true);

	// And none of them carried anything Spotify said.
	const leaks = engineCalls.flatMap((call) => {
		const text = JSON.stringify(call.body);
		return SPOTIFY_SENTINELS.filter((sentinel) => text.includes(sentinel)).map(
			(sentinel) => `${sentinel} in ${promptOf(call).slice(0, 40)}`,
		);
	});
	expect(leaks).toEqual([]);
});

test("login asks for the known set only, and the app reads no top artists", async () => {
	const scope = SPOTIFY_SCOPES.join(" ");
	expect(scope).not.toMatch(/\bstreaming\b/);
	expect(scope.split(" ")).toEqual(
		expect.arrayContaining([
			"user-top-read",
			"user-library-read",
			"user-read-recently-played",
		]),
	);

	const { fake } = await generate();
	const paths = fake.requests
		.filter((r) => new URL(r.url).hostname === "api.spotify.com")
		.map((r) => new URL(r.url).pathname);
	expect(paths).toContain("/v1/me/top/tracks");
	expect(paths).toContain("/v1/me/tracks");
	expect(paths).toContain("/v1/me/player/recently-played");
	expect(paths).not.toContain("/v1/me/top/artists");
});
