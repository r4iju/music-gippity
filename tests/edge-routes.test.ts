import { beforeEach, describe, expect, mock, test } from "bun:test";
import { CREATIVITY, CREATIVITY_LEVELS } from "~/lib/creativity";
import { ENGINES } from "~/lib/engines";
import {
	CandidatesEventSchema,
	PlaylistLineSchema,
} from "~/lib/playlist-stream";
import { MAINSTREAM_LISTENERS, popularityBudget } from "~/lib/popularity";
import { PURPOSE, PURPOSES, type Purpose } from "~/lib/purpose";
import { SPOTIFY_SCOPES } from "~/lib/spotify-scopes";
import { surplusFor } from "~/server/api/engines/common";
import { gatherEvidence } from "~/server/api/evidence";
import { otherEngine } from "~/server/api/rerank";
import type { EvalCase } from "../evals/cases";
import { judgePlaylist } from "../evals/judge";
import { fixtureListener } from "../evals/listener";
import { summaryRow, TABLE_HEADER } from "../evals/report";
import { readPlaylistLine, runCase } from "../evals/runner";
import {
	artistOf,
	deezerTrack,
	EMPTY_SCENE,
	GEMINI_USAGE,
	geminiStream,
	hangs,
	installFakeFetch,
	lastfmApi,
	lastfmTrack,
	listenbrainzPopularity,
	lrclibRecord,
	musicbrainzArtists,
	musicbrainzRecording,
	musicbrainzReleases,
	notFound,
	OPENAI_USAGE,
	openaiStream,
	post,
	type RecordedRequest,
	readNdjson,
	recentlyPlayed,
	savedTracks,
	spotifyError,
	spotifyMatch,
	spotifyMatchPlainOnly,
	spotifyNoMatch,
	spotifyTracks,
	titleOf,
	topTracks,
} from "./fake-providers";
import {
	appSongFailure,
	appSongQueries,
	appSongRows,
	TEST_SESSION,
	tokenUsageInserts,
} from "./setup";

const { createPlaylist } = await import("~/server/api/create-playlist");
const { createPlaylist: createForListener } = await import(
	"~/server/api/create-playlist"
);
const { POST: recommendations } = await import(
	"~/app/api/edge/recommendations/route"
);
const { POST: replaceSong } = await import("~/app/api/edge/replace-song/route");

function geminiPrompt(call: RecordedRequest | undefined): string | undefined {
	const contents = call?.body.contents as
		| { parts: { text: string }[] }[]
		| undefined;
	return contents?.[0]?.parts[0]?.text;
}

function geminiSystem(call: RecordedRequest | undefined): string | undefined {
	const system = call?.body.systemInstruction as
		| { parts: { text: string }[] }
		| undefined;
	return system?.parts[0]?.text;
}

type ChatMessage = { role: string; content: string };
function openaiMessages(call: RecordedRequest | undefined): ChatMessage[] {
	return (call?.body.messages as ChatMessage[] | undefined) ?? [];
}

/** Requests whose URL contains the fragment, a host or a path. */
function providerCalls(fake: { requests: RecordedRequest[] }, urlPart: string) {
	return fake.requests.filter((r) => r.url.includes(urlPart));
}

function spotifyQueries(fake: { requests: RecordedRequest[] }): string[] {
	return providerCalls(fake, "api.spotify.com/v1/search").map(
		(r) => new URL(r.url).searchParams.get("q") ?? "",
	);
}

const PROVIDER_HOST = {
	chatgpt: "api.openai.com",
	gemini: "generativelanguage.googleapis.com",
} as const;

const PLAYLIST_TEXT = [
	'{"kind":"name","name":"Late Night Drive"}',
	'{"kind":"description","description":"Synths for empty highways."}',
	'{"kind":"song","order":1,"artist":"Kavinsky","title":"Nightcall"}',
	'{"kind":"song","order":2,"artist":"The Midnight","title":"Sunset"}',
].join("\n");

describe("curator eval through the playlist route", () => {
	for (const invalid of [
		"missing track",
		"duplicate track",
		"extra track",
		"missing criterion",
		"duplicate criterion",
	]) {
		test(`rejects judge coverage with ${invalid} while preserving output`, async () => {
			const assessment = {
				tracks: [1, 2].map((position) => ({
					position,
					verdict: "fit",
					reason: "Fits the brief.",
				})),
				playlist: ["creativity", "sequence", "description"].map(
					(criterionId) => ({
						criterionId,
						verdict: "fit",
						reason: "Fits the criterion.",
					}),
				),
			};
			if (invalid === "missing track") assessment.tracks.pop();
			if (invalid === "duplicate track")
				assessment.tracks = assessment.tracks.map((track) => ({
					...track,
					position: 1,
				}));
			if (invalid === "extra track")
				assessment.tracks.push({
					position: 3,
					verdict: "fit",
					reason: "Invented track.",
				});
			if (invalid === "missing criterion") assessment.playlist.pop();
			if (invalid === "duplicate criterion")
				assessment.playlist = assessment.playlist.map((criterion) => ({
					...criterion,
					criterionId: "sequence",
				}));
			installFakeFetch({
				openai: () => openaiStream(PLAYLIST_TEXT),
				gemini: () => geminiStream(JSON.stringify(assessment)),
			});
			const result = await runCase(
				{
					id: "coverage",
					brief: "Nocturnal synthwave",
					creativity: "balanced",
					purpose: "discover",
					trackCount: 2,
					trackCriteria: [],
					playlistCriteria: [],
				},
				"chatgpt",
			);
			const judgment = await judgePlaylist(result, "gemini");
			expect(judgment.status).toBe("error");
			expect(judgment.raw).toContain("Fits the brief");
			expect(result.songs).toHaveLength(2);
		});
	}

	test("retains uncertain judgments and uses the exact brief without exposing the generator", async () => {
		const fake = installFakeFetch({
			openai: () => openaiStream(PLAYLIST_TEXT),
			gemini: () =>
				geminiStream(
					JSON.stringify({
						tracks: [
							{
								position: 1,
								verdict: "uncertain",
								reason:
									"I do not know this recording well enough to assess its energy.",
							},
							{
								position: 2,
								verdict: "fit",
								reason:
									"The synthwave palette fits the requested night-drive atmosphere.",
							},
						],
						playlist: ["creativity", "sequence", "description"].map(
							(criterionId) => ({
								criterionId,
								verdict: "uncertain",
								reason: "Insufficient evidence.",
							}),
						),
					}),
				),
		});
		const result = await runCase(
			{
				id: "judge",
				brief: "Nocturnal synthwave for a long drive",
				creativity: "balanced",
				purpose: "discover",
				trackCount: 2,
				trackCriteria: [{ id: "sound", requirement: "Nocturnal synthwave." }],
				playlistCriteria: [],
			},
			"chatgpt",
		);
		const judgment = await judgePlaylist(result, "gemini");
		expect(judgment.status).toBe("ok");
		if (judgment.status !== "ok") throw new Error("Expected valid judgment");
		expect(judgment.assessment.tracks[0]?.verdict).toBe("uncertain");
		expect(judgment.model).toBe(ENGINES.gemini.model);
		const input = geminiPrompt(fake.requests.at(-1)) ?? "";
		expect(input).toContain(result.brief);
		expect(input).toContain(result.description);
		expect(input).not.toContain(ENGINES.chatgpt.model);
		expect(input).not.toContain('"engine"');
		expect(judgment.raw).toContain("Insufficient evidence");
	});

	test("keeps the sent context, description, and final replacement in listening order", async () => {
		let calls = 0;
		installFakeFetch({
			openai: () =>
				openaiStream(
					calls++ === 0
						? PLAYLIST_TEXT
						: '{"artist":"Com Truise","title":"Nightcall"}',
				),
			spotify: (query) =>
				query.includes("Kavinsky") ? spotifyNoMatch() : spotifyMatch(query),
		});
		const result = await runCase(
			{
				id: "capture",
				brief: "Nocturnal synthwave for a long drive",
				creativity: "adventurous",
				purpose: "discover",
				trackCount: 2,
				trackCriteria: [{ id: "fit", requirement: "Fits nocturnal driving." }],
				playlistCriteria: [],
			},
			"chatgpt",
		);
		expect(result.description).toBe("Synths for empty highways.");
		expect(result.generation.model).toBe(ENGINES.chatgpt.model);
		expect(result.generation.creativity).toBe("adventurous");
		expect(result.generation.userPrompt).toContain(
			"Nocturnal synthwave for a long drive",
		);
		expect(result.generation.userPrompt).toContain(
			CREATIVITY.adventurous.instruction,
		);
		expect(result.generation.systemPrompt).toContain("Curation rules:");
		expect(result.replaced).toBe(1);
		expect(result.songs.map((song) => song.artist)).toEqual([
			"Com Truise",
			"The Midnight",
		]);
		expect(result.onSpotify).toBe(2);
		expect(result.emissions.some((song) => song.artist === "Kavinsky")).toBe(
			true,
		);
	});
});

const playlistBody = (
	engine: "chatgpt" | "gemini",
	creativity: keyof typeof CREATIVITY = "balanced",
) => ({
	prompt: "Nocturnal synthwave for a long drive",
	trackCount: 2,
	creativity,
	engine,
});

/** Room at balanced creativity still runs the lookup round. */
const roomBody = (engine: "chatgpt" | "gemini") => ({
	...playlistBody(engine),
	purpose: "room",
});

beforeEach(() => {
	tokenUsageInserts.length = 0;
	appSongRows.length = 0;
	appSongQueries.length = 0;
	appSongFailure.error = null;
});

describe("without a session", () => {
	const routes = [
		["create-playlist", createPlaylist, playlistBody("gemini")],
		["recommendations", recommendations, { engine: "gemini" }],
		["replace-song", replaceSong, {}],
	] as const;

	for (const [name, handler, body] of routes) {
		test(`${name} responds 401 before touching any provider`, async () => {
			const fake = installFakeFetch();
			mock.module("~/server/auth", () => ({ auth: async () => null }));
			try {
				const res = await handler(post(`/api/edge/${name}`, body));
				expect(res.status).toBe(401);
				expect(fake.requests).toHaveLength(0);
			} finally {
				mock.module("~/server/auth", () => ({
					auth: async () => TEST_SESSION,
				}));
			}
		});
	}
});

/** Curator NDJSON for the given [artist, title] picks in listening order. */
const picks = (...songs: [string, string][]) =>
	[
		'{"kind":"name","name":"Versions"}',
		'{"kind":"description","description":"Which one."}',
		...songs.map(
			([artist, title], i) =>
				`{"kind":"song","order":${i + 1},"artist":"${artist}","title":"${title}"}`,
		),
	].join("\n");

/** The last song line per slot with its last evidence, in listening order. */
const slots = (lines: Record<string, unknown>[]): Record<string, unknown>[] => {
	const byOrder = new Map<number, Record<string, unknown>>();
	for (const line of lines)
		if (line.kind === "song") byOrder.set(line.order as number, line);
	const evidence = new Map<string, unknown>();
	for (const line of lines)
		if (line.kind === "evidence")
			evidence.set(line.id as string, line.evidence);
	return [...byOrder.entries()]
		.sort(([a], [b]) => a - b)
		.map(([, song]) => ({
			...song,
			evidence: evidence.get(song.id as string),
		}));
};
/** Curator calls after the lookup round: generation, reviews, replacements. */
const curatorCalls = (fake: { requests: RecordedRequest[] }) =>
	providerCalls(fake, PROVIDER_HOST.gemini).length;

describe("playlist generation core", () => {
	test("drops malformed curator lines and keeps every valid song in order", async () => {
		const text = [
			'{"kind":"name","name":"Late Night Drive"}',
			'{"kind":"banner","text":"not a playlist line"}',
			'{"kind":"description","description":"Synths for empty highways."}',
			'{"kind":"song","order":1,"artist":"Kavinsky","title":"Nightcall"}',
			'{"kind":"song","order":"2","artist":"Broken","title":"Order As Text"}',
			'{"kind":"song","order":3,"artist":"Kavinsky","title":42}',
			'{"kind":"song","order":4,"artist":"The Midnight","title":"Sunset"}',
		].join("\n");
		installFakeFetch({ gemini: () => geminiStream(text) });
		const res = await createPlaylist(
			post("/api/edge/create-playlist", playlistBody("gemini")),
		);
		const lines = await readNdjson(res);

		for (const line of lines) {
			expect(PlaylistLineSchema.safeParse(line).success).toBe(true);
		}
		expect(lines.map((l) => l.kind)).toEqual([
			"id",
			"intent",
			"novelty",
			// A request without a purpose is for discovery, which looks up candidates first.
			"candidates",
			"name",
			"description",
			"song",
			"song",
			"song",
			"song",
			"evidence",
			"evidence",
			"rerank",
			"budget",
			"popularity",
			"complete",
		]);
		expect(lines.filter((l) => l.kind === "song").map((s) => s.title)).toEqual([
			"Nightcall",
			"Nightcall",
			"Sunset",
			"Sunset",
		]);
	});

	test("streams a resolved song with a null year when the release date is unparseable", async () => {
		installFakeFetch({
			gemini: () =>
				geminiStream(
					'{"kind":"song","order":1,"artist":"Kavinsky","title":"Nightcall"}',
				),
			spotify: () =>
				Response.json({
					tracks: {
						items: [
							{
								id: "sp-undated",
								name: "Nightcall",
								preview_url: null,
								artists: [{ name: "Kavinsky" }],
								album: { name: "Album", release_date: "unknown", images: [] },
							},
						],
					},
				}),
		});
		const res = await createPlaylist(
			post("/api/edge/create-playlist", playlistBody("gemini")),
		);
		const songs = (await readNdjson(res)).filter((l) => l.kind === "song");

		expect(songs).toHaveLength(2);
		expect(songs[1]?.songId).toBeTruthy();
		expect(songs[1]?.albumYear).toBeNull();
	});

	describe("resolution", () => {
		const resolved = (lines: Record<string, unknown>[]) =>
			lines.filter((l) => l.kind === "song" && l.songId);

		test("picks the plain title over its vocal mix, and the vocal mix when asked for", async () => {
			installFakeFetch({
				gemini: () =>
					geminiStream(picks(["Rudman", "Bora"], ["Sotofett", "Bora Vocal"])),
				spotify: (query) =>
					spotifyTracks([
						{ id: "vocal", name: "Bora Vocal", artist: artistOf(query) },
						{ id: "plain", name: "Bora", artist: artistOf(query) },
					]),
			});
			const res = await createPlaylist(
				post("/api/edge/create-playlist", playlistBody("gemini")),
			);
			const songs = resolved(await readNdjson(res));

			expect(songs.map((s) => [s.title, s.songId])).toEqual([
				["Bora", "plain"],
				["Bora Vocal", "vocal"],
			]);
			expect(songs.map((s) => s.resolution)).toEqual([
				{ tier: "exact", drift: false, isrc: "ISRC-plain" },
				{ tier: "exact", drift: false, isrc: "ISRC-vocal" },
			]);
		});

		test("flags version drift when only a live or remix version exists", async () => {
			installFakeFetch({
				gemini: () => geminiStream(picks(["Kavinsky", "Nightcall"])),
				spotify: (query) =>
					spotifyTracks([
						{ id: "live", name: "Nightcall - Live", artist: artistOf(query) },
					]),
			});
			const res = await createPlaylist(
				post("/api/edge/create-playlist", playlistBody("gemini")),
			);
			const songs = resolved(await readNdjson(res));

			expect(songs).toHaveLength(1);
			expect(songs[0]?.songId).toBe("live");
			expect(songs[0]?.resolution).toEqual({
				tier: "normalized",
				drift: true,
				isrc: "ISRC-live",
			});
		});

		test("keeps searching past a drifted hit until a clean title match", async () => {
			const fake = installFakeFetch({
				gemini: () => geminiStream(picks(["Kavinsky", "Nightcall"])),
				spotify: (query) =>
					query.startsWith("artist:")
						? spotifyTracks([
								{
									id: "live",
									name: "Nightcall - Live",
									artist: artistOf(query),
								},
							])
						: spotifyTracks([
								{ id: "studio", name: "Nightcall", artist: artistOf(query) },
							]),
			});
			const res = await createPlaylist(
				post("/api/edge/create-playlist", playlistBody("gemini")),
			);
			const songs = resolved(await readNdjson(res));

			expect(songs.map((s) => s.songId)).toEqual(["studio"]);
			expect(songs[0]?.resolution).toEqual({
				tier: "exact",
				drift: false,
				isrc: "ISRC-studio",
			});
			expect(spotifyQueries(fake)).toEqual([
				"artist:Kavinsky track:Nightcall",
				"Kavinsky Nightcall",
			]);
		});

		test("every song carries a tier and ISRC, and unresolved songs say so", async () => {
			installFakeFetch({
				gemini: () =>
					geminiStream(picks(["Kavinsky", "Nightcall"], ["Nobody", "Ghost"])),
				spotify: (query) =>
					query.includes("Nightcall") ? spotifyMatch(query) : spotifyNoMatch(),
			});
			const res = await createPlaylist(
				post("/api/edge/create-playlist", playlistBody("gemini")),
			);
			const songs = (await readNdjson(res)).filter((l) => l.kind === "song");

			const last = (title: string) =>
				songs.filter((s) => s.title === title).at(-1)?.resolution;
			expect(last("Nightcall")).toEqual({
				tier: "exact",
				drift: false,
				isrc: "ISRC-sp-artist-kavinsky-track-nightcall",
			});
			expect(last("Ghost")).toEqual({
				tier: "unresolved",
				drift: false,
				isrc: null,
			});
		});

		test("prefers a release inside the intent's era over a later reissue", async () => {
			installFakeFetch({
				gemini: () => geminiStream(picks(["Kavinsky", "Nightcall"])),
				intent: () =>
					geminiStream(
						JSON.stringify({
							genres: ["synthwave"],
							era: { start: 2008, end: 2012 },
						}),
					),
				spotify: (query) =>
					spotifyTracks([
						{
							id: "reissue",
							name: "Nightcall",
							artist: artistOf(query),
							releaseDate: "2021-06-01",
						},
						{
							id: "original",
							name: "Nightcall",
							artist: artistOf(query),
							releaseDate: "2010-03-10",
						},
					]),
			});
			const res = await createPlaylist(
				post("/api/edge/create-playlist", playlistBody("gemini")),
			);
			const songs = resolved(await readNdjson(res));

			expect(songs.map((s) => s.songId)).toEqual(["original"]);
		});

		test("eval results and the report carry a resolution funnel and drift count", async () => {
			installFakeFetch({
				openai: () =>
					openaiStream(
						picks(["Kavinsky", "Nightcall"], ["The Midnight", "Sunset"]),
					),
				spotify: (query) =>
					query.includes("Sunset")
						? spotifyTracks([
								{ id: "live", name: "Sunset - Live", artist: artistOf(query) },
							])
						: spotifyTracks([
								{ id: "plain", name: "Nightcall", artist: artistOf(query) },
							]),
			});
			const result = await runCase(
				{
					id: "funnel",
					brief: "Nocturnal synthwave for a long drive",
					creativity: "balanced",
					purpose: "discover",
					trackCount: 2,
					trackCriteria: [],
					playlistCriteria: [],
				},
				"chatgpt",
			);
			expect(result.resolution).toEqual({
				exact: 1,
				normalized: 1,
				fuzzy: 0,
				unresolved: 0,
			});
			expect(result.drift).toBe(1);
			const row = summaryRow({
				caseId: "funnel",
				engine: "chatgpt",
				result,
				failures: [],
				overlap: "n/a",
			});
			expect(TABLE_HEADER).toContain("exact / normalized / fuzzy / unresolved");
			expect(TABLE_HEADER).toContain("drift");
			expect(row).toContain("1 / 1 / 0 / 0");
		});
	});

	describe("pool", () => {
		const FIVE = picks(
			["Kavinsky", "Nightcall"],
			["The Midnight", "Sunset"],
			["Com Truise", "Brokendate"],
			["Timecop1983", "Tonight"],
			["FM-84", "Running"],
		);

		test("the surplus is about half the count, between 3 and 10", () => {
			expect([1, 2, 12, 30].map(surplusFor)).toEqual([3, 3, 6, 10]);
		});

		test("asks the curator for a bounded surplus and keeps it out of the stream", async () => {
			const fake = installFakeFetch({ gemini: () => geminiStream(FIVE) });
			const res = await createPlaylist(
				post("/api/edge/create-playlist", playlistBody("gemini")),
			);
			const lines = await readNdjson(res);

			const prompt =
				geminiPrompt(providerCalls(fake, PROVIDER_HOST.gemini)[0]) ?? "";
			expect(prompt).toContain("2-track playlist");
			expect(prompt).toContain("3 reserve");
			expect(slots(lines).map((s) => [s.order, s.artist, s.origin])).toEqual([
				[1, "Kavinsky", "pick"],
				[2, "The Midnight", "pick"],
			]);
			expect(lines.filter((l) => l.kind === "song")).toHaveLength(4);
		});

		test("fills a miss from the pool without a curator replacement call", async () => {
			const fake = installFakeFetch({
				gemini: () => geminiStream(FIVE),
				spotify: (query) =>
					query.includes("Sunset") ? spotifyNoMatch() : spotifyMatch(query),
			});
			const res = await createPlaylist(
				post("/api/edge/create-playlist", playlistBody("gemini")),
			);
			const lines = await readNdjson(res);

			expect(slots(lines).map((s) => [s.artist, s.origin])).toEqual([
				["Kavinsky", "pick"],
				["Com Truise", "pool"],
			]);
			expect(slots(lines).every((s) => typeof s.songId === "string")).toBe(
				true,
			);
			expect(curatorCalls(fake)).toBe(1);
		});

		test("completes a short curator response to the requested count", async () => {
			const fake = installFakeFetch({
				gemini: (p) =>
					geminiStream(
						p.startsWith("Build")
							? picks(["Kavinsky", "Nightcall"])
							: '{"kind":"song","order":-1,"artist":"The Midnight","title":"Sunset"}',
					),
			});
			const res = await createPlaylist(
				post("/api/edge/create-playlist", playlistBody("gemini")),
			);
			const lines = await readNdjson(res);

			expect(slots(lines).map((s) => [s.order, s.artist, s.origin])).toEqual([
				[1, "Kavinsky", "pick"],
				[2, "The Midnight", "replacement"],
			]);
			expect(slots(lines).every((s) => typeof s.songId === "string")).toBe(
				true,
			);
			expect(curatorCalls(fake)).toBe(2);
		});

		test("keeps the first of two picks by the same credited artist and fills the other from the pool", async () => {
			const fake = installFakeFetch({
				gemini: () =>
					geminiStream(
						picks(
							["Kavinsky", "Nightcall"],
							["Kavinsky", "Roadgame"],
							["Com Truise", "Brokendate"],
						),
					),
			});
			const res = await createPlaylist(
				post("/api/edge/create-playlist", playlistBody("gemini")),
			);
			const lines = await readNdjson(res);

			expect(slots(lines).map((s) => [s.artist, s.title, s.origin])).toEqual([
				["Kavinsky", "Nightcall", "pick"],
				["Com Truise", "Brokendate", "pool"],
			]);
			expect(curatorCalls(fake)).toBe(1);
		});

		test("shows a duplicate pick as unresolved when neither pool nor curator can fill its slot", async () => {
			const fake = installFakeFetch({
				gemini: (p) =>
					p.startsWith("Build")
						? geminiStream(
								picks(["Kavinsky", "Nightcall"], ["Kavinsky", "Roadgame"]),
							)
						: geminiStream("not a song"),
			});
			const res = await createPlaylist(
				post("/api/edge/create-playlist", playlistBody("gemini")),
			);
			const lines = await readNdjson(res);

			expect(slots(lines).map((s) => [s.title, s.songId, s.origin])).toEqual([
				["Nightcall", expect.any(String), "pick"],
				["Roadgame", null, "pick"],
			]);
			expect(curatorCalls(fake)).toBe(2);
		});

		test("keeps the first of two picks resolving to the same ISRC", async () => {
			installFakeFetch({
				gemini: () =>
					geminiStream(
						picks(
							["Kavinsky", "Nightcall"],
							["College", "A Real Hero"],
							["Com Truise", "Brokendate"],
						),
					),
				spotify: (query) =>
					spotifyTracks([
						{
							id: `sp-${titleOf(query)}`,
							name: titleOf(query),
							artist: artistOf(query),
							isrc: query.includes("Brokendate") ? "ISRC-other" : "ISRC-same",
						},
					]),
			});
			const res = await createPlaylist(
				post("/api/edge/create-playlist", playlistBody("gemini")),
			);
			const lines = await readNdjson(res);

			expect(slots(lines).map((s) => [s.artist, s.origin])).toEqual([
				["Kavinsky", "pick"],
				["Com Truise", "pool"],
			]);
		});

		test("keeps one recording per album unless the intent asks for an album", async () => {
			const sameAlbum = (query: string) =>
				spotifyTracks([
					{
						id: `sp-${titleOf(query)}`,
						name: titleOf(query),
						artist: artistOf(query),
						albumId: query.includes("Brokendate") ? "album-b" : "album-a",
					},
				]);
			const text = picks(
				["Kavinsky", "Nightcall"],
				["College", "A Real Hero"],
				["Com Truise", "Brokendate"],
			);
			installFakeFetch({
				gemini: () => geminiStream(text),
				spotify: sameAlbum,
			});
			const capped = slots(
				await readNdjson(
					await createPlaylist(
						post("/api/edge/create-playlist", playlistBody("gemini")),
					),
				),
			);
			expect(capped.map((s) => s.artist)).toEqual(["Kavinsky", "Com Truise"]);

			installFakeFetch({
				gemini: () => geminiStream(text),
				intent: () =>
					geminiStream(
						JSON.stringify({ album: { quote: "soundtrack album" } }),
					),
				spotify: sameAlbum,
			});
			const asked = slots(
				await readNdjson(
					await createPlaylist(
						post("/api/edge/create-playlist", {
							...playlistBody("gemini"),
							prompt: "The Drive soundtrack album, in order",
						}),
					),
				),
			);
			expect(asked.map((s) => s.artist)).toEqual(["Kavinsky", "College"]);
		});

		test("eval run results record pool usage per slot", async () => {
			installFakeFetch({
				openai: () => openaiStream(FIVE),
				spotify: (query) =>
					query.includes("Sunset") ? spotifyNoMatch() : spotifyMatch(query),
			});
			const result = await runCase(
				{
					id: "pool",
					brief: "Nocturnal synthwave for a long drive",
					creativity: "balanced",
					purpose: "discover",
					trackCount: 2,
					trackCriteria: [],
					playlistCriteria: [],
				},
				"chatgpt",
			);
			expect(result.songs.map((s) => s.origin)).toEqual(["pick", "pool"]);
			expect(result.poolFills).toBe(1);
			const header = (TABLE_HEADER.split("\n")[0] ?? "").split(" | ");
			const row = summaryRow({
				caseId: "pool",
				engine: "chatgpt",
				result,
				failures: [],
				overlap: "n/a",
			}).split(" | ");
			expect(row).toHaveLength(header.length);
			expect(row[header.indexOf("pool")]).toBe("1");
		});
	});

	describe("evidence", () => {
		const THREE = picks(
			["Kavinsky", "Nightcall"],
			["The Midnight", "Sunset"],
			["Com Truise", "Brokendate"],
		);
		const NO_VOCALS = "Deep focus electronica, no vocals";
		const noVocalsIntent = () =>
			geminiStream(
				JSON.stringify({
					vocalRule: { rule: "no-vocals", quote: "no vocals" },
				}),
			);
		const reviewPrompt = (fake: { requests: RecordedRequest[] }) =>
			providerCalls(fake, PROVIDER_HOST.gemini)
				.map(geminiPrompt)
				.find((p) => p?.startsWith('{"task":"review-vocals"'));

		test("a no-vocals brief replaces a recording LRCLIB says is sung from the pool and keeps the source", async () => {
			const fake = installFakeFetch({
				gemini: () => geminiStream(THREE),
				intent: noVocalsIntent,
				lrclib: (params) =>
					params.get("track_name") === "Sunset"
						? lrclibRecord({ plainLyrics: "Sunset boulevard" })
						: lrclibRecord({ instrumental: true }),
			});
			const lines = await readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", {
						...playlistBody("gemini"),
						prompt: NO_VOCALS,
					}),
				),
			);
			const final = slots(lines);
			expect(final.map((s) => [s.artist, s.origin])).toEqual([
				["Kavinsky", "pick"],
				["Com Truise", "repair"],
			]);
			expect(lines.find((l) => l.kind === "repair")).toMatchObject({
				id: final[1]?.id,
				rule: "no-vocals",
				source: "lrclib",
				outcome: "replaced",
				replacement: { artist: "Com Truise", title: "Brokendate" },
			});
			expect(final[1]?.evidence).toMatchObject({
				instrumental: { value: true, source: "lrclib" },
			});
			// Every vocal status is known, so the LLM review never runs.
			expect(curatorCalls(fake)).toBe(1);
		});

		test("an era brief replaces a recording whose first release falls outside the era even when the Spotify album date is inside", async () => {
			installFakeFetch({
				gemini: () => geminiStream(THREE),
				intent: () =>
					geminiStream(JSON.stringify({ era: { start: 2008, end: 2012 } })),
				spotify: (query) =>
					spotifyTracks([
						{
							id: `sp-${titleOf(query)}`,
							name: titleOf(query),
							artist: artistOf(query),
							releaseDate: "2010-06-01",
						},
					]),
				musicbrainz: (isrc) =>
					musicbrainzRecording({
						mbid: `mb-${isrc}`,
						firstReleaseDate:
							isrc === "ISRC-sp-Sunset" ? "1984-05-01" : "2010-06-01",
					}),
			});
			const lines = await readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", {
						...playlistBody("gemini"),
						prompt: "Synthwave from 2008 to 2012",
					}),
				),
			);
			const final = slots(lines);
			expect(final.map((s) => [s.artist, s.origin])).toEqual([
				["Kavinsky", "pick"],
				["Com Truise", "repair"],
			]);
			expect(lines.find((l) => l.kind === "repair")).toMatchObject({
				rule: "era",
				source: "musicbrainz",
				detail: expect.stringContaining("1984"),
				outcome: "replaced",
			});
			expect(final[1]?.evidence).toMatchObject({
				firstReleaseYear: { value: 2010, source: "musicbrainz" },
			});
		});

		test("an artist exclusion replaces a recording MusicBrainz credits to the excluded act", async () => {
			installFakeFetch({
				gemini: () => geminiStream(THREE),
				intent: () =>
					geminiStream(
						JSON.stringify({
							exclusions: [
								{
									kind: "artist",
									value: "Daft Punk",
									quote: "nada de Daft Punk",
								},
							],
						}),
					),
				musicbrainz: (isrc) =>
					musicbrainzRecording({
						mbid: `mb-${isrc}`,
						credits: isrc.includes("sunset")
							? ["The Midnight", "Daft Punk"]
							: ["Artist"],
					}),
			});
			const lines = await readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", {
						...playlistBody("gemini"),
						prompt: "Synthwave, nada de Daft Punk",
					}),
				),
			);
			const final = slots(lines);
			expect(final.map((s) => [s.artist, s.origin])).toEqual([
				["Kavinsky", "pick"],
				["Com Truise", "repair"],
			]);
			expect(lines.find((l) => l.kind === "repair")).toMatchObject({
				id: final[1]?.id,
				rule: "exclusion",
				source: "musicbrainz",
				detail: 'credited to Daft Punk, excluded by "nada de Daft Punk"',
				outcome: "replaced",
				replacement: { artist: "Com Truise", title: "Brokendate" },
			});
		});

		test("a style exclusion replaces a recording Last.fm tags with the excluded style", async () => {
			installFakeFetch({
				gemini: () => geminiStream(THREE),
				intent: () =>
					geminiStream(
						JSON.stringify({
							exclusions: [{ kind: "style", value: "trap", quote: "no trap" }],
						}),
					),
				lastfm: (params) =>
					lastfmTrack({
						tags:
							params.get("track") === "Sunset"
								? ["synthwave", "trap"]
								: ["synthwave"],
					}),
			});
			const lines = await readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", {
						...playlistBody("gemini"),
						prompt: "Synthwave, no trap",
					}),
				),
			);
			expect(slots(lines).map((s) => [s.artist, s.origin])).toEqual([
				["Kavinsky", "pick"],
				["Com Truise", "repair"],
			]);
			expect(lines.find((l) => l.kind === "repair")).toMatchObject({
				rule: "exclusion",
				source: "lastfm",
				detail: 'tagged trap, excluded by "no trap"',
				outcome: "replaced",
			});
		});

		test("a version exclusion replaces a recording whose Spotify title is a live take, and the repair line parses", async () => {
			installFakeFetch({
				gemini: () => geminiStream(THREE),
				intent: () =>
					geminiStream(
						JSON.stringify({
							exclusions: [
								{ kind: "version", value: "live", quote: "no live versions" },
							],
						}),
					),
				spotify: (query) =>
					spotifyTracks([
						{
							id: `sp-${titleOf(query)}`,
							name:
								titleOf(query) === "Sunset"
									? "Sunset - Live at the Roxy"
									: titleOf(query),
							artist: artistOf(query),
						},
					]),
			});
			const lines = await readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", {
						...playlistBody("gemini"),
						prompt: "Synthwave, no live versions",
					}),
				),
			);
			expect(slots(lines).map((s) => [s.artist, s.origin])).toEqual([
				["Kavinsky", "pick"],
				["Com Truise", "repair"],
			]);
			const repair = lines.find((l) => l.kind === "repair");
			expect(PlaylistLineSchema.safeParse(repair).success).toBe(true);
			expect(repair).toMatchObject({
				rule: "exclusion",
				source: "spotify",
				detail:
					'a live version, "Sunset - Live at the Roxy", excluded by "no live versions"',
				outcome: "replaced",
			});
		});

		test("a recording with no evidence for the vocal rule goes through vocal review unchanged", async () => {
			const fake = installFakeFetch({
				gemini: (p) =>
					geminiStream(
						p.startsWith('{"task":"review-vocals"')
							? JSON.stringify({ restriction: null, tracks: [] })
							: THREE,
					),
				intent: noVocalsIntent,
				lrclib: (params) =>
					params.get("track_name") === "Nightcall"
						? lrclibRecord({ instrumental: true })
						: notFound(),
			});
			const lines = await readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", {
						...playlistBody("gemini"),
						prompt: NO_VOCALS,
					}),
				),
			);
			expect(slots(lines).map((s) => [s.artist, s.origin])).toEqual([
				["Kavinsky", "pick"],
				["The Midnight", "pick"],
			]);
			const review = reviewPrompt(fake);
			expect(review).toBeDefined();
			const reviewed = (
				JSON.parse(review ?? "{}") as { tracks: { artist: string }[] }
			).tracks.map((t) => t.artist);
			expect(reviewed).toEqual(["The Midnight"]);
			expect(lines.filter((l) => l.kind === "repair")).toHaveLength(0);
		});

		test("a source timeout or error leaves the recording in place with evidence marked unknown", async () => {
			{
				installFakeFetch({
					gemini: () => geminiStream(THREE),
					intent: noVocalsIntent,
					musicbrainz: () => new Response("down", { status: 503 }),
					lrclib: () =>
						new Promise((resolve) =>
							setTimeout(
								() => resolve(lrclibRecord({ plainLyrics: "late" })),
								300,
							),
						),
					deezer: () => deezerTrack({ bpm: 118 }),
				});
				const lines = await readNdjson(
					await createPlaylist(
						post("/api/edge/create-playlist", {
							...playlistBody("gemini"),
							prompt: NO_VOCALS,
						}),
					),
				);
				const final = slots(lines);
				expect(final.map((s) => [s.artist, s.origin])).toEqual([
					["Kavinsky", "pick"],
					["The Midnight", "pick"],
				]);
				expect(final[0]?.evidence).toMatchObject({
					instrumental: null,
					firstReleaseYear: null,
					tempo: { value: 118, source: "deezer" },
					sources: {
						musicbrainz: "error",
						lrclib: "timeout",
						deezer: "ok",
						lastfm: "unknown",
						listenbrainz: "unknown",
					},
				});
				expect(lines.filter((l) => l.kind === "repair")).toHaveLength(0);
			}
		});

		test("a violation with an empty pool asks the curator for a replacement as before", async () => {
			const fake = installFakeFetch({
				gemini: (p) =>
					geminiStream(
						p.startsWith("Build")
							? picks(["Kavinsky", "Nightcall"], ["The Midnight", "Sunset"])
							: '{"artist":"Com Truise","title":"Brokendate"}',
					),
				intent: () =>
					geminiStream(JSON.stringify({ era: { start: 2008, end: 2012 } })),
				musicbrainz: (isrc) =>
					musicbrainzRecording({
						mbid: `mb-${isrc}`,
						firstReleaseDate: isrc.includes("sunset")
							? "1984-05-01"
							: "2010-06-01",
					}),
			});
			const lines = await readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", {
						...playlistBody("gemini"),
						prompt: "Synthwave from 2008 to 2012",
					}),
				),
			);
			const final = slots(lines);
			expect(final.map((s) => [s.artist, s.origin])).toEqual([
				["Kavinsky", "pick"],
				["Com Truise", "replacement"],
			]);
			expect(lines.find((l) => l.kind === "repair")).toMatchObject({
				rule: "era",
				outcome: "no-substitute",
			});
			expect(final[1]?.evidence).toMatchObject({
				firstReleaseYear: { value: 2010, source: "musicbrainz" },
			});
			expect(curatorCalls(fake)).toBe(2);
		});

		test("a pool recording that breaks the rule itself is passed over", async () => {
			installFakeFetch({
				gemini: () =>
					geminiStream(
						picks(
							["Kavinsky", "Nightcall"],
							["The Midnight", "Sunset"],
							["Com Truise", "Brokendate"],
							["Timecop1983", "Tonight"],
						),
					),
				intent: noVocalsIntent,
				lrclib: (params) =>
					["Sunset", "Brokendate"].includes(params.get("track_name") ?? "")
						? lrclibRecord({ plainLyrics: "words" })
						: lrclibRecord({ instrumental: true }),
			});
			const lines = await readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", {
						...playlistBody("gemini"),
						prompt: NO_VOCALS,
					}),
				),
			);
			expect(slots(lines).map((s) => [s.artist, s.origin])).toEqual([
				["Kavinsky", "pick"],
				["Timecop1983", "repair"],
			]);
		});

		test("eval judge input and run results include evidence with sources", async () => {
			const fake = installFakeFetch({
				openai: () => openaiStream(THREE),
				lrclib: () => lrclibRecord({ instrumental: true }),
				musicbrainz: (isrc) =>
					musicbrainzRecording({
						mbid: `mb-${isrc}`,
						firstReleaseDate: "2011-03-01",
						country: "FR",
					}),
				listenbrainz: (mbids) => listenbrainzPopularity(mbids[0] ?? "", 4200),
				lastfm: () =>
					lastfmTrack({ tags: ["synthwave", "electronic"], listeners: 90000 }),
				deezer: () =>
					deezerTrack({ bpm: 96, gain: -8.1, titleVersion: "(Original Mix)" }),
			});
			const result = await runCase(
				{
					id: "evidence",
					brief: "Nocturnal synthwave for a long drive",
					creativity: "balanced",
					purpose: "discover",
					trackCount: 2,
					trackCriteria: [],
					playlistCriteria: [],
				},
				"chatgpt",
			);
			expect(result.songs[0]?.evidence).toEqual({
				firstReleaseYear: { value: 2011, source: "musicbrainz" },
				artistCountry: { value: "FR", source: "musicbrainz" },
				credits: { value: ["Artist"], source: "musicbrainz" },
				instrumental: { value: true, source: "lrclib" },
				tempo: { value: 96, source: "deezer" },
				gain: { value: -8.1, source: "deezer" },
				version: { value: "(Original Mix)", source: "deezer" },
				tags: { value: ["synthwave", "electronic"], source: "lastfm" },
				listeners: { value: 90000, source: "lastfm" },
				sources: {
					musicbrainz: "ok",
					lrclib: "ok",
					deezer: "ok",
					lastfm: "ok",
					listenbrainz: "ok",
				},
			});
			expect(result.repairs).toEqual([]);
			const mb = providerCalls(fake, "musicbrainz.org")[0];
			expect(mb?.headers["user-agent"]).toContain("music-gippity");
			await judgePlaylist(result, "gemini");
			const input = JSON.parse(geminiPrompt(fake.requests.at(-1)) ?? "{}") as {
				tracks: { evidence: unknown }[];
			};
			expect(input.tracks[0]?.evidence).toEqual(result.songs[0]?.evidence);
		});
	});

	describe("listener counts", () => {
		const TWO = picks(["Kavinsky", "Nightcall"], ["The Midnight", "Sunset"]);
		const CASE: EvalCase = {
			id: "listeners",
			brief: "Nocturnal synthwave for a long drive",
			creativity: "balanced",
			purpose: "discover",
			trackCount: 2,
			trackCriteria: [],
			playlistCriteria: [],
		};
		const { lastfm: LASTFM, listenbrainz: LISTENBRAINZ } = MAINSTREAM_LISTENERS;
		/** Nightcall at the Last.fm threshold, Sunset just under it. */
		const lastfmCounts = (params: URLSearchParams) =>
			lastfmTrack({
				tags: ["synthwave"],
				listeners: params.get("track") === "Nightcall" ? LASTFM : LASTFM - 1,
			});

		test("Last.fm counts listeners when ListenBrainz has none, with its source", async () => {
			installFakeFetch({
				openai: () => openaiStream(TWO),
				musicbrainz: (isrc) => musicbrainzRecording({ mbid: `mb-${isrc}` }),
				listenbrainz: () => Response.json([]),
				lastfm: lastfmCounts,
			});
			const result = await runCase(CASE, "chatgpt");
			expect(result.songs.map((s) => s.evidence?.listeners)).toEqual([
				{ value: LASTFM, source: "lastfm" },
				{ value: LASTFM - 1, source: "lastfm" },
			]);
			expect(result.songs[0]?.evidence?.tags).toEqual({
				value: ["synthwave"],
				source: "lastfm",
			});
			expect(result.popularity).toEqual({
				recordings: 2,
				median: { listenbrainz: null, lastfm: LASTFM - 0.5 },
				mainstream: 1,
				unknown: 0,
			});
		});

		test("Last.fm counts listeners when MusicBrainz has no record", async () => {
			const fake = installFakeFetch({
				openai: () => openaiStream(TWO),
				lastfm: lastfmCounts,
			});
			const result = await runCase(CASE, "chatgpt");
			expect(providerCalls(fake, "api.listenbrainz.org")).toHaveLength(0);
			expect(result.songs.map((s) => s.evidence?.listeners?.source)).toEqual([
				"lastfm",
				"lastfm",
			]);
		});

		test("a Last.fm count wins over ListenBrainz's", async () => {
			installFakeFetch({
				openai: () => openaiStream(TWO),
				musicbrainz: (isrc) => musicbrainzRecording({ mbid: `mb-${isrc}` }),
				listenbrainz: (mbids) =>
					listenbrainzPopularity(mbids[0] ?? "", LISTENBRAINZ),
				lastfm: lastfmCounts,
			});
			const result = await runCase(CASE, "chatgpt");
			expect(result.songs.map((s) => s.evidence?.listeners)).toEqual([
				{ value: LASTFM, source: "lastfm" },
				{ value: LASTFM - 1, source: "lastfm" },
			]);
			expect(result.popularity?.mainstream).toBe(1);
		});

		test("ListenBrainz counts listeners when Last.fm has no record, judged by its own threshold", async () => {
			installFakeFetch({
				openai: () => openaiStream(TWO),
				musicbrainz: (isrc) => musicbrainzRecording({ mbid: `mb-${isrc}` }),
				listenbrainz: (mbids) =>
					listenbrainzPopularity(mbids[0] ?? "", LISTENBRAINZ),
				lastfm: () => Response.json({ error: 6, message: "Track not found" }),
			});
			const result = await runCase(CASE, "chatgpt");
			expect(result.songs.map((s) => s.evidence?.listeners)).toEqual([
				{ value: LISTENBRAINZ, source: "listenbrainz" },
				{ value: LISTENBRAINZ, source: "listenbrainz" },
			]);
			expect(result.popularity?.mainstream).toBe(2);
		});

		test("ListenBrainz counts listeners when Last.fm fails or counts nobody", async () => {
			for (const lastfm of [
				() => Response.json({ error: 29, message: "Rate limit" }),
				() => lastfmTrack({ tags: ["synthwave"], listeners: 0 }),
			]) {
				installFakeFetch({
					openai: () => openaiStream(TWO),
					musicbrainz: (isrc) => musicbrainzRecording({ mbid: `mb-${isrc}` }),
					listenbrainz: (mbids) => listenbrainzPopularity(mbids[0] ?? "", 42),
					lastfm,
				});
				const result = await runCase(CASE, "chatgpt");
				expect(result.songs[0]?.evidence?.listeners).toEqual({
					value: 42,
					source: "listenbrainz",
				});
			}
		});

		test("a suffixed title is also asked under its base title, and the larger count wins", async () => {
			const ref = {
				isrc: null,
				title: "Tides - 2022 Remaster",
				artist: "Arovane",
				album: null,
				durationMs: null,
			};
			const counted = async (counts: Record<string, number>) => {
				const fake = installFakeFetch({
					lastfm: (params) =>
						lastfmTrack({
							tags: [params.get("track") ?? ""],
							listeners: counts[params.get("track") ?? ""] ?? 0,
						}),
				});
				const evidence = await gatherEvidence(ref);
				const asked = providerCalls(fake, "ws.audioscrobbler.com").map((r) =>
					new URL(r.url).searchParams.get("track"),
				);
				return { asked, listeners: evidence.listeners, tags: evidence.tags };
			};
			expect(
				await counted({ "Tides - 2022 Remaster": 5877, Tides: 30978 }),
			).toEqual({
				asked: ["Tides - 2022 Remaster", "Tides"],
				listeners: { value: 30978, source: "lastfm" },
				tags: { value: ["Tides"], source: "lastfm" },
			});
			expect(
				(await counted({ "Tides - 2022 Remaster": 212363, Tides: 7817 }))
					.listeners,
			).toEqual({ value: 212363, source: "lastfm" });
		});

		test("a Last.fm failure is reported as an error, not as no record", async () => {
			installFakeFetch({
				openai: () => openaiStream(TWO),
				lastfm: () => Response.json({ error: 29, message: "Rate limit" }),
			});
			const result = await runCase(CASE, "chatgpt");
			expect(result.songs[0]?.evidence?.sources.lastfm).toBe("error");
			expect(result.songs[0]?.evidence?.listeners).toBeNull();
		});

		test("Last.fm answers are read by their error code and shape", async () => {
			const ref = {
				isrc: null,
				title: "Nightcall",
				artist: "Kavinsky",
				album: null,
				durationMs: null,
			};
			const lastfmFor = async (lastfm: () => Response) => {
				installFakeFetch({ lastfm });
				const evidence = await gatherEvidence(ref);
				return [evidence.sources.lastfm, evidence.tags, evidence.listeners];
			};
			expect(
				await lastfmFor(() =>
					Response.json(
						{ error: 6, message: "Track not found" },
						{ status: 400 },
					),
				),
			).toEqual(["unknown", null, null]);
			expect(
				await lastfmFor(() =>
					Response.json({
						track: { listeners: "12", toptags: { tag: { name: "synthwave" } } },
					}),
				),
			).toEqual([
				"ok",
				{ value: ["synthwave"], source: "lastfm" },
				{ value: 12, source: "lastfm" },
			]);
			expect(
				await lastfmFor(() =>
					Response.json({ track: { toptags: { tag: [] } } }),
				),
			).toEqual(["unknown", null, null]);
		});

		test("a recording neither source counts is unknown and not mainstream", async () => {
			installFakeFetch({
				openai: () => openaiStream(TWO),
				musicbrainz: (isrc) => musicbrainzRecording({ mbid: `mb-${isrc}` }),
				listenbrainz: () => Response.json([]),
				lastfm: () => Response.json({ error: 6, message: "Track not found" }),
			});
			const result = await runCase(CASE, "chatgpt");
			expect(result.songs.map((s) => s.evidence?.listeners)).toEqual([
				null,
				null,
			]);
			expect(result.songs[0]?.evidence?.sources.lastfm).toBe("unknown");
			expect(result.popularity).toEqual({
				recordings: 2,
				median: { listenbrainz: null, lastfm: null },
				mainstream: 0,
				unknown: 2,
			});
			const header = (TABLE_HEADER.split("\n")[0] ?? "").split(" | ");
			const row = summaryRow({
				caseId: "listeners",
				engine: "chatgpt",
				result,
				failures: [],
				overlap: "n/a",
			}).split(" | ");
			expect(row).toHaveLength(header.length);
			expect(row[header.indexOf("median listeners (Last.fm / LB)")]).toBe(
				"n/a / n/a",
			);
			expect(row[header.indexOf("mainstream")]).toBe("0/2");
			expect(row[header.indexOf("unknown listeners")]).toBe("2/2");
		});

		test("unresolved picks do not count toward the listener summary", async () => {
			installFakeFetch({
				openai: () => openaiStream(TWO),
				spotify: (query) =>
					query.includes("Sunset") ? spotifyNoMatch() : spotifyMatch(query),
				lastfm: lastfmCounts,
			});
			const result = await runCase(CASE, "chatgpt");
			expect(result.songs).toHaveLength(2);
			expect(result.popularity).toMatchObject({ recordings: 1, unknown: 0 });
		});
	});

	describe("candidates", () => {
		const BRIEF = "Synthwave nocturno de los 80, nada de Daft Punk";
		const difficult = () =>
			geminiStream(
				JSON.stringify({
					genres: ["synthwave"],
					era: { start: 1980, end: 1989 },
					exclusions: [
						{ kind: "artist", value: "Daft Punk", quote: "nada de Daft Punk" },
					],
				}),
			);
		/** A scene plan naming MusicBrainz tags, an area or labels. */
		const scene = (plan: Record<string, unknown>) => () =>
			JSON.stringify({ tags: [], area: null, labels: [], ...plan });
		const SYNTHWAVE = scene({ tags: ["synthwave"] });
		/** The synthwave scene as MusicBrainz tags it: one act. */
		const KAVINSKY = [{ id: "mb-kavinsky", name: "Kavinsky" }];
		/** The synthwave chart on Last.fm: one track. */
		const CHART: Record<string, [string, string][]> = {
			synthwave: [["Ulrich", "Sunset - Live"]],
		};
		const curator = (p: string): Response =>
			geminiStream(
				p.startsWith("Build")
					? picks(["Kavinsky", "Nightcall"], ["The Midnight", "Sunset"])
					: "",
			);
		const generationPrompt = (fake: { requests: RecordedRequest[] }) =>
			providerCalls(fake, PROVIDER_HOST.gemini)
				.map(geminiPrompt)
				.find((p) => p?.startsWith("Build"));
		const lookups = {
			scene: SYNTHWAVE,
			musicbrainzSearch: () => musicbrainzArtists(KAVINSKY),
			lastfm: lastfmApi({ charts: CHART }),
		};
		const run = async (overrides: Parameters<typeof installFakeFetch>[0]) => {
			const fake = installFakeFetch({
				intent: difficult,
				gemini: curator,
				...lookups,
				...overrides,
			});
			const lines = await readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", {
						...playlistBody("gemini"),
						prompt: BRIEF,
					}),
				),
			);
			return {
				fake,
				lines,
				event: lines.find((l) => l.kind === "candidates"),
			};
		};

		test("a scene brief looks up MusicBrainz and Last.fm and offers what they found to the curator", async () => {
			const { fake, lines, event } = await run({});
			expect(lines.map((l) => l.kind).slice(0, 4)).toEqual([
				"id",
				"intent",
				"novelty",
				"candidates",
			]);
			expect(event).toMatchObject({
				engine: "gemini",
				status: "ok",
				musicbrainz: [
					{ source: "tag", query: 'tag:"synthwave"', status: "ok", hits: 1 },
				],
				lastfm: [
					{
						source: "chart",
						query: "tag.getTopTracks synthwave",
						status: "ok",
						hits: 1,
					},
				],
				excluded: 0,
				known: 0,
				pool: { tag: 1, label: 0, chart: 1 },
				artists: [{ name: "Kavinsky", mbid: "mb-kavinsky", source: "tag" }],
				tracks: [
					{
						artist: "Ulrich",
						title: "Sunset - Live",
						source: "chart",
						tag: "synthwave",
					},
				],
			});
			// Spotify is only ever asked to resolve the curator's own picks.
			expect(spotifyQueries(fake)).toEqual([
				"artist:Kavinsky track:Nightcall",
				"artist:The Midnight track:Sunset",
			]);
			const prompt = generationPrompt(fake) ?? "";
			expect(prompt).toContain("Candidates were gathered");
			expect(prompt).toContain("- Kavinsky");
			expect(prompt).toContain("- Ulrich - Sunset - Live");
			expect(prompt.indexOf(BRIEF)).toBeLessThan(
				prompt.indexOf("Candidates were gathered"),
			);
			expect(slots(lines).map((s) => [s.artist, s.candidate])).toEqual([
				["Kavinsky", "tag"],
				["The Midnight", undefined],
			]);
		});

		test("a pick of another take by a chart artist still counts as a candidate", async () => {
			const { lines } = await run({
				gemini: (p) =>
					geminiStream(
						p.startsWith("Build")
							? picks(["Ulrich", "Sunset"], ["The Midnight", "Sunset"])
							: "",
					),
			});
			expect(slots(lines).map((s) => [s.artist, s.candidate])).toEqual([
				["Ulrich", "chart"],
				["The Midnight", undefined],
			]);
		});

		const easy = () => geminiStream(JSON.stringify({ genres: ["synthwave"] }));
		const create = async (
			body: Record<string, unknown>,
			overrides: Parameters<typeof installFakeFetch>[0] = {},
		) => {
			const fake = installFakeFetch({
				intent: easy,
				gemini: curator,
				...lookups,
				...overrides,
			});
			const lines = await readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", {
						...playlistBody("gemini"),
						...body,
					}),
				),
			);
			return { fake, lines };
		};

		for (const [label, body] of [
			["a Discover brief", { purpose: "discover" }],
			["an Adventurous brief", { purpose: "room", creativity: "adventurous" }],
			["a Balanced room brief", { purpose: "room", creativity: "balanced" }],
		] as const)
			test(`${label} plans the scene even when the intent is easy`, async () => {
				const { fake, lines } = await create(body);
				expect(fake.scenePlans).toHaveLength(1);
				const event = CandidatesEventSchema.parse(
					lines.find((line) => line.kind === "candidates"),
				);
				expect(event).toMatchObject({
					status: "ok",
				});
				expect(event.artists.length + event.tracks.length).toBeGreaterThan(0);
				expect(generationPrompt(fake)).toContain("Candidates were gathered");
			});

		test("the scene plan is a call of its own in the token usage", async () => {
			await create({ purpose: "discover" });
			// The intent read, the plan, the generation, then the rerank.
			expect(tokenUsageInserts.map((row) => row.engine)).toEqual([
				"gemini",
				"gemini",
				"gemini",
				"chatgpt",
			]);
		});

		test("a Discover brief plans the scene even when the intent read fails", async () => {
			const { fake } = await create(
				{ purpose: "discover" },
				{ intent: () => geminiStream("") },
			);
			expect(fake.scenePlans).toHaveLength(1);
			expect(generationPrompt(fake)).toContain("Artists MusicBrainz lists");
		});

		test("the curator is told to pick mostly from the candidates and mark each pick's source", async () => {
			const { fake } = await create({ purpose: "discover" });
			const prompt = generationPrompt(fake) ?? "";
			expect(prompt).toContain("Pick most of the playlist from them");
			expect(prompt).toContain(
				'{"kind":"song","order":1,"artist":"...","title":"...","source":"..."}',
			);
		});

		test("each song carries the source the curator declared; an undeclared pick is recall", async () => {
			const { lines } = await create(
				{ purpose: "discover" },
				{
					gemini: (p) =>
						geminiStream(
							p.startsWith("Build")
								? [
										'{"kind":"name","name":"Versions"}',
										'{"kind":"description","description":"Which one."}',
										'{"kind":"song","order":1,"artist":"Kavinsky","title":"Nightcall","source":"candidates"}',
										'{"kind":"song","order":2,"artist":"The Midnight","title":"Sunset","source":"memory"}',
									].join("\n")
								: "",
						),
				},
			);
			expect(
				slots(lines).map((s) => [s.artist, s.source, s.candidate]),
			).toEqual([
				["Kavinsky", "candidates", "tag"],
				["The Midnight", "recall", undefined],
			]);
			expect(
				lines.filter((l) => l.kind === "song").every((l) => l.source),
			).toBe(true);
		});

		test("a declaration counts for nothing when no candidates were offered", async () => {
			const { lines } = await create(
				{ purpose: "discover" },
				{
					scene: () => EMPTY_SCENE,
					lastfm: notFound,
					gemini: (p) =>
						geminiStream(
							p.startsWith("Build")
								? '{"kind":"song","order":1,"artist":"Kavinsky","title":"Nightcall","source":"candidates"}'
								: "",
						),
				},
			);
			expect(slots(lines)[0]).toMatchObject({ source: "recall" });
		});

		test("a replacement for a missing pick is recall", async () => {
			const { lines } = await create(
				{ purpose: "discover" },
				{
					gemini: (p) =>
						geminiStream(
							p.startsWith("Build")
								? picks(["Kavinsky", "Nightcall"], ["The Midnight", "Sunset"])
								: '{"artist":"Com Truise","title":"Brokendate"}',
						),
					spotify: (q) =>
						q.includes("Nightcall") ? spotifyNoMatch() : spotifyMatch(q),
				},
			);
			expect(slots(lines)[0]).toMatchObject({
				artist: "Com Truise",
				origin: "replacement",
				source: "recall",
			});
		});

		test("under a budget, artists the listener knows are neither offered nor named to the planner", async () => {
			const { fake, lines } = await create(
				{ purpose: "discover" },
				{ library: () => savedTracks([{ id: "k1", artist: "Kavinsky" }]) },
			);
			expect(lines.find((l) => l.kind === "candidates")).toMatchObject({
				known: 1,
				artists: [],
				tracks: [{ artist: "Ulrich" }],
			});
			expect(generationPrompt(fake)).not.toContain("Kavinsky");
			const plan = geminiPrompt(fake.scenePlans[0]) ?? "{}";
			expect(Object.keys(JSON.parse(plan))).toEqual([
				"task",
				"brief",
				"intent",
			]);
			expect(plan).not.toContain("Kavinsky");
		});

		test("when every candidate is by a known artist nothing is offered and every pick is recall", async () => {
			installFakeFetch({
				intent: easy,
				gemini: (p) =>
					geminiStream(
						p.startsWith("Build")
							? [
									'{"kind":"name","name":"Versions"}',
									'{"kind":"description","description":"Which one."}',
									'{"kind":"song","order":1,"artist":"Kavinsky","title":"Nightcall","source":"candidates"}',
									'{"kind":"song","order":2,"artist":"The Midnight","title":"Sunset","source":"candidates"}',
								].join("\n")
							: "",
					),
				...lookups,
				library: () =>
					savedTracks([
						{ id: "k1", artist: "Kavinsky" },
						{ id: "u1", artist: "Ulrich" },
					]),
			});
			const result = await runCase(
				{
					id: "all-known",
					brief: BRIEF,
					creativity: "balanced",
					purpose: "discover",
					trackCount: 2,
					trackCriteria: [],
					playlistCriteria: [],
				},
				"gemini",
			);
			expect(result.candidates).toMatchObject({
				known: 2,
				artists: [],
				tracks: [],
			});
			expect(result.generation.userPrompt).not.toContain(
				"Candidates were gathered",
			);
			expect(result.songs.map((s) => s.source)).toEqual(["recall", "recall"]);
			const header = (TABLE_HEADER.split("\n")[0] ?? "").split(" | ");
			const row = summaryRow({
				caseId: "all-known",
				engine: "gemini",
				result,
				failures: [],
				overlap: "n/a",
			}).split(" | ");
			expect(row[header.indexOf("candidates")]).toBe("0/0 (2 known)");
			expect(row[header.indexOf("from candidates")]).toBe("skipped");
		});

		test("a reserve pick declared from the candidates keeps its source when it fills a slot", async () => {
			const { lines } = await create(
				{ purpose: "discover" },
				{
					gemini: (p) =>
						geminiStream(
							p.startsWith("Build")
								? [
										'{"kind":"song","order":1,"artist":"Missing","title":"Nowhere","source":"candidates"}',
										'{"kind":"song","order":2,"artist":"The Midnight","title":"Sunset","source":"recall"}',
										'{"kind":"song","order":3,"artist":"Kavinsky","title":"Nightcall","source":"candidates"}',
									].join("\n")
								: "",
						),
					spotify: (q) =>
						q.includes("Missing") ? spotifyNoMatch() : spotifyMatch(q),
				},
			);
			expect(slots(lines).map((s) => [s.artist, s.origin, s.source])).toEqual([
				["Kavinsky", "pool", "candidates"],
				["The Midnight", "pick", "recall"],
			]);
		});

		test("the report skips the share from candidates when none were offered", async () => {
			installFakeFetch({
				intent: easy,
				gemini: curator,
				scene: () => EMPTY_SCENE,
				lastfm: notFound,
			});
			const result = await runCase(
				{
					id: "nothing-offered",
					brief: BRIEF,
					creativity: "balanced",
					purpose: "discover",
					trackCount: 2,
					trackCriteria: [],
					playlistCriteria: [],
				},
				"gemini",
			);
			const header = (TABLE_HEADER.split("\n")[0] ?? "").split(" | ");
			const row = summaryRow({
				caseId: "nothing-offered",
				engine: "gemini",
				result,
				failures: [],
				overlap: "n/a",
			}).split(" | ");
			expect(row[header.indexOf("from candidates")]).toBe("skipped");
		});

		describe("MusicBrainz sources", () => {
			const mbQueries = (fake: { requests: RecordedRequest[] }) =>
				fake.requests
					.filter((r) =>
						/musicbrainz\.org\/ws\/2\/(artist|release)\?/.test(r.url),
					)
					.map((r) => {
						const url = new URL(r.url);
						return `${url.pathname.split("/ws/2/")[1]} ${url.searchParams.get("query")}`;
					});
			const HANDS = [
				[{ id: "mb-ancient", name: "Ancient Methods" }],
				[
					{ id: "mb-ancient", name: "Ancient Methods" },
					{ id: "mb-various", name: "Various Artists" },
				],
				[
					{
						id: "89ad4ac3-39f7-470e-963a-56509c546377",
						name: "Various Artists",
					},
				],
				[{ id: "mb-imminent", name: "Imminent" }],
			];

			test("a brief naming a label offers the artists on its releases", async () => {
				const { fake, lines } = await create(
					{ purpose: "discover" },
					{
						scene: scene({ labels: ["Hands Productions"] }),
						musicbrainzSearch: (entity) =>
							entity === "release"
								? musicbrainzReleases(HANDS)
								: musicbrainzArtists([]),
					},
				);
				expect(mbQueries(fake)).toEqual(['release label:"Hands Productions"']);
				const event = lines.find((l) => l.kind === "candidates");
				expect(event).toMatchObject({
					musicbrainz: [
						{
							source: "label",
							query: 'label:"Hands Productions"',
							status: "ok",
							hits: 3,
						},
					],
					artists: [
						{
							name: "Ancient Methods",
							source: "label",
							label: "Hands Productions",
						},
						{ name: "Various Artists", source: "label" },
						{ name: "Imminent", source: "label" },
					],
				});
				const prompt = generationPrompt(fake) ?? "";
				expect(prompt).toContain("Artists MusicBrainz lists");
				expect(prompt).toContain("- Ancient Methods (on Hands Productions)");
			});

			test("a scene brief offers artists tagged with it in its area, and a pick by one matches", async () => {
				const { fake, lines } = await create(
					{ purpose: "discover" },
					{
						scene: scene({ tags: ["EBM", "industrial"], area: "Spain" }),
						musicbrainzSearch: () =>
							musicbrainzArtists([
								{
									id: "mb-esplendor",
									name: "Esplendor Geométrico",
									area: "Spain",
									tags: ["industrial", "power electronics", "ebm", "noise"],
								},
							]),
						gemini: (p) =>
							geminiStream(
								p.startsWith("Build")
									? [
											'{"kind":"name","name":"Versions"}',
											'{"kind":"description","description":"Which one."}',
											'{"kind":"song","order":1,"artist":"Esplendor Geométrico","title":"Moscu Esta Helado","source":"candidates"}',
											'{"kind":"song","order":2,"artist":"Kavinsky","title":"Nightcall","source":"candidates"}',
										].join("\n")
									: "",
							),
					},
				);
				expect(mbQueries(fake)).toEqual([
					'artist (tag:"ebm" OR tag:"industrial") AND area:"Spain"',
				]);
				expect(generationPrompt(fake)).toContain(
					"- Esplendor Geométrico (Spain; industrial, power electronics, ebm)",
				);
				expect(slots(lines).map((s) => [s.artist, s.candidate])).toEqual([
					["Esplendor Geométrico", "tag"],
					["Kavinsky", undefined],
				]);
				expect(lines.find((l) => l.kind === "candidates")).toMatchObject({
					pool: { tag: 1, label: 0, chart: 1 },
				});
			});

			test("the curator sees a sample drawn from each source in turn, from a pool of five a track", async () => {
				const many = Array.from({ length: 20 }, (_, i) => ({
					id: `mb-${i}`,
					name: `Tagged ${i}`,
				}));
				const { lines } = await create(
					{ purpose: "discover" },
					{
						scene: scene({ tags: ["synthwave"], labels: ["Outrun"] }),
						musicbrainzSearch: (entity) =>
							entity === "artist"
								? musicbrainzArtists(many)
								: musicbrainzReleases([
										[{ id: "mb-label-1", name: "Label One" }],
										[{ id: "mb-label-2", name: "Label Two" }],
										[{ id: "mb-label-3", name: "Label Three" }],
									]),
						lastfm: notFound,
					},
				);
				const event = lines.find((l) => l.kind === "candidates") as {
					pool: Record<string, number>;
					artists: { name: string }[];
					tracks: unknown[];
				};
				// Two tracks: a pool of ten, six offered.
				expect(event.pool).toEqual({ label: 3, tag: 7, chart: 0 });
				expect(event.tracks).toEqual([]);
				expect(event.artists.map((a) => a.name)).toEqual([
					"Label One",
					"Label Two",
					"Label Three",
					"Tagged 0",
					"Tagged 1",
					"Tagged 2",
				]);
			});

			test("an artist already in the pool from one source is not offered again from another, and placeholders are dropped", async () => {
				const { lines } = await create(
					{ purpose: "discover" },
					{
						musicbrainzSearch: () =>
							musicbrainzArtists([
								{ id: "mb-act-0", name: "Act 0" },
								{ id: "mb-unknown", name: "[unknown]" },
							]),
						lastfm: lastfmApi({
							charts: {
								synthwave: [
									["Act 0", "Song 0"],
									["Act 1", "Song 1"],
								],
							},
						}),
					},
				);
				expect(lines.find((l) => l.kind === "candidates")).toMatchObject({
					pool: { tag: 1, label: 0, chart: 1 },
					artists: [{ name: "Act 0" }],
					tracks: [{ artist: "Act 1", title: "Song 1" }],
				});
			});

			test("a tag that cleans to nothing is left out of the plan", async () => {
				const { fake } = await create(
					{ purpose: "discover" },
					{ scene: scene({ tags: ['"', "  ebm\\ "], area: '""' }) },
				);
				expect(mbQueries(fake)).toEqual(['artist tag:"ebm"']);
			});

			test("MusicBrainz artists excluded or known are left out", async () => {
				const { lines } = await create(
					{ purpose: "discover", prompt: BRIEF },
					{
						intent: difficult,
						library: () => savedTracks([{ id: "k1", artist: "Known Act" }]),
						musicbrainzSearch: () =>
							musicbrainzArtists([
								{ id: "mb-kavinsky", name: "Kavinsky" },
								{ id: "mb-daft", name: "Daft Punk" },
								{ id: "mb-known", name: "Known Act" },
								{ id: "mb-new", name: "New Act" },
							]),
					},
				);
				expect(lines.find((l) => l.kind === "candidates")).toMatchObject({
					excluded: 1,
					known: 1,
					artists: [{ name: "Kavinsky" }, { name: "New Act" }],
				});
			});

			test("a failed MusicBrainz query costs only itself, and a garbled scene plan is ignored", async () => {
				const failed = await create(
					{ purpose: "discover" },
					{ musicbrainzSearch: () => new Response("busy", { status: 503 }) },
				);
				expect(failed.lines.find((l) => l.kind === "candidates")).toMatchObject(
					{
						status: "ok",
						musicbrainz: [
							{ source: "tag", status: "error", error: "MusicBrainz HTTP 503" },
						],
						artists: [],
						tracks: [{ artist: "Ulrich" }],
					},
				);
				const garbled = await create(
					{ purpose: "discover" },
					{ scene: scene({ tags: "synthwave", area: 7, labels: [null, ""] }) },
				);
				expect(
					garbled.lines.find((l) => l.kind === "candidates"),
				).toMatchObject({
					status: "ok",
					musicbrainz: [],
					artists: [],
					tracks: [{ artist: "Ulrich" }],
				});
			});

			test("the eval report shows each source's pool and the songs matching it", async () => {
				installFakeFetch({
					intent: easy,
					gemini: (p) =>
						geminiStream(
							p.startsWith("Build")
								? [
										'{"kind":"name","name":"Versions"}',
										'{"kind":"description","description":"Which one."}',
										'{"kind":"song","order":1,"artist":"Kavinsky","title":"Nightcall","source":"candidates"}',
										'{"kind":"song","order":2,"artist":"New Act","title":"Anything","source":"candidates"}',
									].join("\n")
								: "",
						),
					scene: SYNTHWAVE,
					musicbrainzSearch: () =>
						musicbrainzArtists([{ id: "mb-new", name: "New Act" }]),
					lastfm: lastfmApi({
						charts: { synthwave: [["Kavinsky", "Nightcall"]] },
					}),
				});
				const result = await runCase(
					{
						id: "sources",
						brief: BRIEF,
						creativity: "balanced",
						purpose: "discover",
						trackCount: 2,
						trackCriteria: [],
						playlistCriteria: [],
					},
					"gemini",
				);
				const header = (TABLE_HEADER.split("\n")[0] ?? "").split(" | ");
				const row = summaryRow({
					caseId: "sources",
					engine: "gemini",
					result,
					failures: [],
					overlap: "n/a",
				}).split(" | ");
				expect(row).toHaveLength(header.length);
				expect(row[header.indexOf("candidate sources (pool → used)")]).toBe(
					"tag 1→1 · label 0→0 · chart 1→1",
				);
				expect(row[header.indexOf("candidates")]).toBe("2/2");
				expect(result.generation.userPrompt).toContain("- New Act");
				expect(result.generation.userPrompt).toContain(
					"- Kavinsky - Nightcall",
				);
			});
		});

		describe("Last.fm sources", () => {
			const HIT = MAINSTREAM_LISTENERS.lastfm;
			const chart = (from: number, to: number) =>
				Array.from({ length: to - from + 1 }, (_, i): [string, string] => [
					`Chart ${from + i}`,
					`Song ${from + i}`,
				]);
			/** Nothing from MusicBrainz, so the offer is the chart alone. */
			const noScene = () => musicbrainzArtists([]);
			const offer = (lines: Record<string, unknown>[]) =>
				lines.find((l) => l.kind === "candidates") as {
					lastfm: {
						source: string;
						query: string;
						status: string;
						hits: number;
					}[];
					artists: { name: string }[];
					tracks: { artist: string; title: string; listeners: number | null }[];
					pool: Record<string, number>;
					popularity: unknown;
				};

			test("a genre brief offers its Last.fm chart, past the head for Adventurous", async () => {
				const charts = { synthwave: chart(1, 70) };
				const balanced = await create(
					{ purpose: "discover" },
					{ musicbrainzSearch: noScene, lastfm: lastfmApi({ charts }) },
				);
				expect(offer(balanced.lines).tracks.map((t) => t.title)).toEqual([
					"Song 1",
					"Song 2",
					"Song 3",
					"Song 4",
					"Song 5",
					"Song 6",
				]);
				expect(generationPrompt(balanced.fake) ?? "").toContain(
					"- Chart 1 - Song 1",
				);
				const adventurous = await create(
					{ purpose: "discover", creativity: "adventurous" },
					{ musicbrainzSearch: noScene, lastfm: lastfmApi({ charts }) },
				);
				expect(offer(adventurous.lines).tracks.map((t) => t.title)).toEqual([
					"Song 11",
					"Song 12",
					"Song 13",
					"Song 14",
					"Song 15",
					"Song 16",
				]);
			});

			test("the offer keeps to the ceiling's share of mainstream candidates", async () => {
				const listeners: Record<string, number> = {};
				for (let i = 1; i <= 10; i++)
					listeners[`Chart ${i}`] = i <= 6 ? HIT : 100;
				const { lines } = await create(
					{ purpose: "discover" },
					{
						musicbrainzSearch: noScene,
						lastfm: lastfmApi({
							listeners,
							charts: { synthwave: chart(1, 10) },
						}),
					},
				);
				const event = offer(lines);
				// Two tracks at Balanced: one mainstream pick, three of six offered.
				expect(event.popularity).toEqual({
					budget: { maxMainstream: 1, minMainstream: null },
					counted: 10,
					mainstream: 3,
				});
				expect(event.tracks.map((t) => [t.title, t.listeners])).toEqual([
					["Song 1", HIT],
					["Song 2", HIT],
					["Song 3", HIT],
					["Song 7", 100],
					["Song 8", 100],
					["Song 9", 100],
				]);
			});

			test("candidates are counted a source at a time in turn, at most five calls at once", async () => {
				let inFlight = 0;
				let most = 0;
				const api = lastfmApi({ charts: { synthwave: chart(1, 20) } });
				const { fake } = await create(
					{ purpose: "discover" },
					{
						scene: scene({ tags: ["synthwave"], labels: ["Outrun"] }),
						musicbrainzSearch: (entity) =>
							entity === "artist"
								? musicbrainzArtists(
										Array.from({ length: 10 }, (_, i) => ({
											id: `mb-${i}`,
											name: `Tagged ${i}`,
										})),
									)
								: musicbrainzReleases([
										[{ id: "mb-label-1", name: "Label One" }],
										[{ id: "mb-label-2", name: "Label Two" }],
									]),
						lastfm: async (params) => {
							inFlight += 1;
							most = Math.max(most, inFlight);
							await new Promise((resolve) => setTimeout(resolve, 1));
							inFlight -= 1;
							return api(params);
						},
					},
				);
				const counts = providerCalls(fake, "ws.audioscrobbler.com")
					.map((r) => new URL(r.url).searchParams)
					.filter((q) =>
						["track.getinfo", "artist.gettoptracks"].includes(
							q.get("method") ?? "",
						),
					)
					.map((q) => q.get("artist"));
				expect(counts.slice(0, 6)).toEqual([
					"Label One",
					"Tagged 0",
					"Chart 1",
					"Label Two",
					"Tagged 1",
					"Chart 2",
				]);
				expect(most).toBeLessThanOrEqual(5);
			});

			test("a plan the curator fails to write costs only the planned sources", async () => {
				const { lines } = await create(
					{ purpose: "discover" },
					{
						scene: () => {
							throw new Error("planner down");
						},
						lastfm: lastfmApi({ charts: { synthwave: chart(1, 5) } }),
					},
				);
				const event = offer(lines) as ReturnType<typeof offer> & {
					status: string;
					error?: string;
				};
				expect(event.status).toBe("ok");
				expect(event.error).toContain("HTTP 500");
				expect(event.artists).toEqual([]);
				expect(event.tracks.map((t) => t.title)).toEqual([
					"Song 1",
					"Song 2",
					"Song 3",
					"Song 4",
					"Song 5",
				]);
			});

			test("under Room's floor each source offers its mainstream candidates first", async () => {
				const listeners: Record<string, number> = {};
				for (const i of [16, 17, 18]) listeners[`Chart ${i}`] = HIT;
				const { lines } = await create(
					{ purpose: "room", creativity: "adventurous" },
					{
						musicbrainzSearch: noScene,
						lastfm: lastfmApi({
							listeners,
							charts: { synthwave: chart(1, 30) },
						}),
					},
				);
				expect(offer(lines).tracks.map((t) => t.title)).toEqual([
					"Song 16",
					"Song 17",
					"Song 18",
					"Song 11",
					"Song 12",
					"Song 13",
				]);
			});
		});

		test("a chart track by an excluded artist is never offered", async () => {
			const { fake, event } = await run({
				lastfm: lastfmApi({
					charts: {
						synthwave: [
							["Daft Punk", "Around the World"],
							["Ulrich", "Sunset - Live"],
						],
					},
				}),
			});
			expect(event).toMatchObject({
				status: "ok",
				excluded: 1,
				tracks: [{ artist: "Ulrich" }],
			});
			expect(generationPrompt(fake)).not.toContain("Daft Punk - ");
		});

		test("only the first chart track by an artist is offered", async () => {
			const { event } = await run({
				musicbrainzSearch: () => musicbrainzArtists([]),
				lastfm: lastfmApi({
					charts: {
						synthwave: [
							["Kavinsky", "Odd Look"],
							["Kavinsky", "Nightcall"],
							["Ulrich", "Sunset - Live"],
						],
					},
				}),
			});
			expect(event).toMatchObject({
				pool: { tag: 0, label: 0, chart: 2 },
				tracks: [
					{ artist: "Kavinsky", title: "Odd Look" },
					{ artist: "Ulrich", title: "Sunset - Live" },
				],
			});
		});

		test("a scene plan the curator fails to write falls back to plain generation", async () => {
			const { fake, lines, event } = await run({
				scene: () => {
					throw new Error("planner down");
				},
				lastfm: notFound,
			});
			expect(event).toMatchObject({
				status: "error",
				musicbrainz: [],
				lastfm: [{ source: "chart", status: "ok", hits: 0 }],
				artists: [],
				tracks: [],
			});
			expect(event?.error).toContain("HTTP 500");
			expect(generationPrompt(fake)).not.toContain("Candidates were gathered");
			expect(slots(lines).map((s) => s.artist)).toEqual([
				"Kavinsky",
				"The Midnight",
			]);
		});

		test("an empty plan means plain generation without an error", async () => {
			const { fake, event } = await run({
				scene: () => EMPTY_SCENE,
				lastfm: lastfmApi({ charts: {} }),
			});
			expect(event).toMatchObject({
				status: "ok",
				musicbrainz: [],
				artists: [],
				tracks: [],
			});
			expect(event?.error).toBeUndefined();
			expect(generationPrompt(fake)).not.toContain("Candidates were gathered");
		});

		test("one failed chart lookup drops only itself", async () => {
			const italo = lastfmApi({
				charts: { "italo disco": [["Ulrich", "Sunset - Live"]] },
			});
			const { fake, event } = await run({
				intent: () =>
					geminiStream(
						JSON.stringify({ genres: ["synthwave", "italo disco"] }),
					),
				lastfm: (params) =>
					params.get("tag") === "synthwave"
						? new Response("down", { status: 500 })
						: italo(params),
			});
			expect(event).toMatchObject({
				status: "ok",
				lastfm: [
					{ query: "tag.getTopTracks synthwave", status: "error", hits: 0 },
					{ query: "tag.getTopTracks italo disco", status: "ok", hits: 1 },
				],
				tracks: [{ artist: "Ulrich" }],
			});
			expect(
				((event?.lastfm ?? []) as { error?: string }[])[0]?.error,
			).toContain("500");
			expect(generationPrompt(fake)).toContain("- Ulrich - Sunset - Live");
		});

		test("every lookup failing records the cause and generation runs without candidates", async () => {
			const { fake, lines, event } = await run({
				musicbrainzSearch: () => new Response("busy", { status: 503 }),
				lastfm: () => new Response("down", { status: 500 }),
			});
			expect(event).toMatchObject({
				status: "error",
				musicbrainz: [{ source: "tag", status: "error" }],
				lastfm: [{ source: "chart", status: "error" }],
				artists: [],
				tracks: [],
			});
			expect(event?.error).toContain("2 failed");
			expect(event?.error).toContain("503");
			expect(generationPrompt(fake)).not.toContain("Candidates were gathered");
			expect(slots(lines)).toHaveLength(2);
		});

		test("a chart lookup past its deadline counts as failed when Last.fm never answers", async () => {
			const realTimeout = AbortSignal.timeout;
			AbortSignal.timeout = (ms: number) =>
				realTimeout.call(AbortSignal, ms === 5000 ? 1 : ms);
			try {
				const { lines, event } = await run({
					lastfm: (params) =>
						params.get("method") === "tag.gettoptracks" ? hangs() : notFound(),
				});
				expect(event).toMatchObject({
					status: "ok",
					lastfm: [
						{ query: "tag.getTopTracks synthwave", status: "error", hits: 0 },
					],
					artists: [{ name: "Kavinsky" }],
					tracks: [],
				});
				expect(slots(lines)).toHaveLength(2);
			} finally {
				AbortSignal.timeout = realTimeout;
			}
		});

		test("eval run results record the scene plan and which recordings came from candidates", async () => {
			const fake = installFakeFetch({
				intent: difficult,
				gemini: curator,
				...lookups,
			});
			const result = await runCase(
				{
					id: "candidates",
					brief: BRIEF,
					creativity: "balanced",
					purpose: "discover",
					trackCount: 2,
					trackCriteria: [],
					playlistCriteria: [],
				},
				"gemini",
			);
			expect(result.candidates).toMatchObject({
				status: "ok",
				musicbrainz: [{ query: 'tag:"synthwave"' }],
				lastfm: [{ query: "tag.getTopTracks synthwave" }],
			});
			expect(result.candidates?.userPrompt).toContain('"task":"plan-scene"');
			expect(result.generation.userPrompt).toContain("- Kavinsky");
			expect(result.songs.map((s) => s.candidate ?? null)).toEqual([
				"tag",
				null,
			]);
			expect(result.candidateUse).toBe(1);
			const header = (TABLE_HEADER.split("\n")[0] ?? "").split(" | ");
			const row = summaryRow({
				caseId: "candidates",
				engine: "gemini",
				result,
				failures: [],
				overlap: "n/a",
			}).split(" | ");
			expect(row).toHaveLength(header.length);
			expect(row[header.indexOf("candidates")]).toBe("1/2");
			// The fake curator declares nothing, so both picks read as recall.
			expect(result.fromCandidates).toBe(0);
			expect(row[header.indexOf("from candidates")]).toBe("0/2 (0%)");
			await judgePlaylist(result, "gemini");
			const input = JSON.parse(geminiPrompt(fake.requests.at(-1)) ?? "{}") as {
				tracks: {
					pickedFrom: string | null;
					matchedCandidate: string | null;
				}[];
			};
			expect(
				input.tracks.map((t) => [t.pickedFrom, t.matchedCandidate]),
			).toEqual([
				["recall", "tag"],
				["recall", null],
			]);
		});

		test("the eval rejects a song line without a source", () => {
			const song = {
				kind: "song",
				id: "slot-1",
				order: 1,
				artist: "Kavinsky",
				title: "Nightcall",
			};
			expect(() => readPlaylistLine(JSON.stringify(song))).toThrow(
				"Invalid playlist line",
			);
			expect(
				readPlaylistLine(JSON.stringify({ ...song, source: "recall" })),
			).toMatchObject({ source: "recall" });
		});
	});

	describe("rerank", () => {
		const THREE = picks(
			["Kavinsky", "Nightcall"],
			["The Midnight", "Sunset"],
			["Com Truise", "Brokendate"],
		);
		type RerankInput = {
			task: string;
			tracks: { id: string; artist: string }[];
			pool: { id: string; artist: string }[];
		};
		/** Answers the rerank call from the ids in its own input. */
		const rerankWith =
			(
				plan: (input: RerankInput) => {
					order: string[];
					prune?: string[];
					reasons: Record<string, string>;
				},
			) =>
			(p: string) =>
				p.startsWith('{"task":"rerank"')
					? JSON.stringify(plan(JSON.parse(p) as RerankInput))
					: "";
		const reasonsFor = (input: RerankInput) =>
			Object.fromEntries(
				[...input.tracks, ...input.pool].map((t) => [t.id, `${t.artist} fits`]),
			);
		const byId = (
			lines: Record<string, unknown>[],
			kind: string,
		): Record<string, string> =>
			Object.fromEntries(
				lines
					.filter((l) => l.kind === kind)
					.map((l) => [l.id as string, l.reason as string]),
			);

		test("orders the playlist by the rerank output and attaches a reason to every song", async () => {
			const fake = installFakeFetch({
				gemini: () => geminiStream(THREE),
				openai: (p) =>
					openaiStream(
						rerankWith((input) => ({
							order: [input.tracks[1]?.id ?? "", input.tracks[0]?.id ?? ""],
							reasons: reasonsFor(input),
						}))(p),
					),
			});
			const lines = await readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", playlistBody("gemini")),
				),
			);
			const final = slots(lines);
			const order = lines.find((l) => l.kind === "order");
			expect(order?.ids).toEqual([final[1]?.id, final[0]?.id]);
			expect(byId(lines, "reason")).toEqual({
				[final[0]?.id as string]: "Kavinsky fits",
				[final[1]?.id as string]: "The Midnight fits",
			});
			expect(lines.find((l) => l.kind === "rerank")).toMatchObject({
				engine: "chatgpt",
				status: "ok",
				order: [final[1]?.id, final[0]?.id],
				pruned: [],
			});
			const call = providerCalls(fake, PROVIDER_HOST.chatgpt)[0]?.body as
				| { messages: { content: string }[] }
				| undefined;
			const input = JSON.parse(
				call?.messages.at(-1)?.content ?? "{}",
			) as RerankInput & { intent: unknown; tracks: { evidence: unknown }[] };
			expect(input.tracks.map((t) => t.artist)).toEqual([
				"Kavinsky",
				"The Midnight",
			]);
			expect(input.pool.map((t) => t.artist)).toEqual(["Com Truise"]);
			expect(input.tracks[0]).toHaveProperty("evidence");
			expect(curatorCalls(fake)).toBe(1);
		});

		test("fills a pruned slot from the pool and gives the replacement a reason", async () => {
			installFakeFetch({
				gemini: () => geminiStream(THREE),
				openai: (p) =>
					openaiStream(
						rerankWith((input) => ({
							order: [input.tracks[0]?.id ?? "", input.pool[0]?.id ?? ""],
							prune: [input.tracks[1]?.id ?? ""],
							reasons: reasonsFor(input),
						}))(p),
					),
			});
			const lines = await readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", playlistBody("gemini")),
				),
			);
			const final = slots(lines);
			expect(final.map((s) => [s.artist, s.origin])).toEqual([
				["Kavinsky", "pick"],
				["Com Truise", "pool"],
			]);
			expect(lines.find((l) => l.kind === "order")?.ids).toEqual([
				final[0]?.id,
				final[1]?.id,
			]);
			expect(byId(lines, "reason")[final[1]?.id as string]).toBe(
				"Com Truise fits",
			);
			expect(lines.find((l) => l.kind === "rerank")).toMatchObject({
				status: "ok",
				pruned: [final[1]?.id],
			});
			expect(final[1]?.evidence).toBeDefined();
		});

		test("a pool fill takes the pruned slot of its own artist and a prune with no fill is restored", async () => {
			const FOUR = picks(
				["Kavinsky", "Nightcall"],
				["The Midnight", "Sunset"],
				["Com Truise", "Brokendate"],
				["The Midnight", "Los Angeles"],
			);
			installFakeFetch({
				gemini: () => geminiStream(FOUR),
				openai: (p) =>
					openaiStream(
						rerankWith((input) => ({
							order: [input.pool[1]?.id ?? ""],
							prune: input.tracks.map((t) => t.id),
							reasons: reasonsFor(input),
						}))(p),
					),
			});
			const lines = await readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", playlistBody("gemini")),
				),
			);
			const final = slots(lines);
			expect(final.map((s) => [s.artist, s.title, s.origin])).toEqual([
				["Kavinsky", "Nightcall", "pick"],
				["The Midnight", "Los Angeles", "pool"],
			]);
			expect(lines.find((l) => l.kind === "order")?.ids).toEqual([
				final[1]?.id,
				final[0]?.id,
			]);
			// The restored recording has no reason: nobody wrote one for it.
			expect(byId(lines, "reason")).toEqual({
				[final[1]?.id as string]: "The Midnight fits",
			});
			expect(lines.find((l) => l.kind === "rerank")).toMatchObject({
				status: "ok",
				pruned: [final[0]?.id, final[1]?.id],
				restored: [final[0]?.id],
			});
		});

		test("a pool fill the caps reject leaves the pruned slot as it was", async () => {
			const FOUR = picks(
				["Kavinsky", "Nightcall"],
				["The Midnight", "Sunset"],
				["Com Truise", "Brokendate"],
				["The Midnight", "Los Angeles"],
			);
			installFakeFetch({
				gemini: () => geminiStream(FOUR),
				openai: (p) =>
					openaiStream(
						rerankWith((input) => ({
							order: [input.tracks[1]?.id ?? "", input.pool[1]?.id ?? ""],
							prune: [input.tracks[0]?.id ?? ""],
							reasons: reasonsFor(input),
						}))(p),
					),
			});
			const lines = await readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", playlistBody("gemini")),
				),
			);
			const final = slots(lines);
			expect(final.map((s) => [s.artist, s.title])).toEqual([
				["Kavinsky", "Nightcall"],
				["The Midnight", "Sunset"],
			]);
			expect(lines.find((l) => l.kind === "order")?.ids).toEqual([
				final[1]?.id,
				final[0]?.id,
			]);
			expect(lines.find((l) => l.kind === "rerank")).toMatchObject({
				status: "ok",
				pruned: [final[0]?.id],
				restored: [final[0]?.id],
			});
		});

		test("an order that drops a kept track is rejected whole", async () => {
			installFakeFetch({
				gemini: () => geminiStream(THREE),
				openai: (p) =>
					openaiStream(
						rerankWith((input) => ({
							order: [input.tracks[0]?.id ?? ""],
							reasons: reasonsFor(input),
						}))(p),
					),
			});
			const lines = await readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", playlistBody("gemini")),
				),
			);
			expect(lines.find((l) => l.kind === "rerank")).toMatchObject({
				status: "error",
				error: "Order must list every kept track exactly once",
			});
			expect(slots(lines).map((s) => s.artist)).toEqual([
				"Kavinsky",
				"The Midnight",
			]);
			expect(lines.find((l) => l.kind === "order")).toBeUndefined();
			expect(lines.filter((l) => l.kind === "reason")).toHaveLength(0);
		});

		test("a rerank past its deadline leaves the streamed order intact", async () => {
			installFakeFetch({
				gemini: () => geminiStream(THREE),
				openai: () =>
					new Response(new ReadableStream<Uint8Array>({ start() {} })),
			});
			const realTimeout = globalThis.setTimeout;
			globalThis.setTimeout = ((callback: () => void, delay: number) =>
				realTimeout(
					callback,
					delay === 20000 ? 1 : delay,
				)) as typeof setTimeout;
			try {
				const lines = await readNdjson(
					await createPlaylist(
						post("/api/edge/create-playlist", playlistBody("gemini")),
					),
				);
				expect(slots(lines).map((s) => s.artist)).toEqual([
					"Kavinsky",
					"The Midnight",
				]);
				expect(lines.find((l) => l.kind === "rerank")).toMatchObject({
					status: "error",
					error: "chatgpt timed out after 20000 ms",
				});
				expect(lines.find((l) => l.kind === "order")).toBeUndefined();
			} finally {
				globalThis.setTimeout = realTimeout;
			}
		});

		test("fewer than two resolved recordings skip the rerank", async () => {
			// Only Nightcall resolves; nothing the curator offers for the other
			// slot does either.
			const fake = installFakeFetch({
				gemini: () => geminiStream(THREE),
				openai: () => openaiStream("unused"),
				spotify: (query) =>
					query.includes("Nightcall") ? spotifyMatch(query) : spotifyNoMatch(),
			});
			const lines = await readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", playlistBody("gemini")),
				),
			);
			expect(slots(lines).filter((s) => s.songId)).toHaveLength(1);
			expect(lines.find((l) => l.kind === "rerank")).toBeUndefined();
			expect(providerCalls(fake, PROVIDER_HOST.chatgpt)).toHaveLength(0);
		});

		test("a rerank failure leaves the streamed order and songs intact", async () => {
			installFakeFetch({
				gemini: () => geminiStream(THREE),
				openai: () => openaiStream("not json"),
			});
			const lines = await readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", playlistBody("gemini")),
				),
			);
			expect(slots(lines).map((s) => [s.order, s.artist])).toEqual([
				[1, "Kavinsky"],
				[2, "The Midnight"],
			]);
			expect(lines.find((l) => l.kind === "order")).toBeUndefined();
			expect(lines.filter((l) => l.kind === "reason")).toHaveLength(0);
			expect(lines.find((l) => l.kind === "rerank")).toMatchObject({
				status: "error",
			});
		});

		test("eval run results record the rerank input, output and reasons in the final order", async () => {
			installFakeFetch({
				openai: () => openaiStream(THREE),
				gemini: (p) =>
					geminiStream(
						rerankWith((input) => ({
							order: [input.tracks[1]?.id ?? "", input.tracks[0]?.id ?? ""],
							reasons: reasonsFor(input),
						}))(p),
					),
			});
			const result = await runCase(
				{
					id: "rerank",
					brief: "Nocturnal synthwave for a long drive",
					creativity: "balanced",
					purpose: "discover",
					trackCount: 2,
					trackCriteria: [],
					playlistCriteria: [],
				},
				"chatgpt",
			);
			expect(result.rerank).toMatchObject({
				engine: "gemini",
				status: "ok",
				pruned: [],
			});
			expect(result.rerank?.userPrompt).toContain('"task":"rerank"');
			expect(result.songs.map((s) => [s.artist, s.reason])).toEqual([
				["The Midnight", "The Midnight fits"],
				["Kavinsky", "Kavinsky fits"],
			]);
		});
	});

	describe("known set", () => {
		const FOUR = picks(
			["Kavinsky", "Nightcall"],
			["The Midnight", "Sunset"],
			["Com Truise", "Brokendate"],
			["Gunship", "Tech Noir"],
		);
		// Fixed Spotify ids, so the known set can name the resolved recordings.
		const spotify = (query: string) =>
			spotifyTracks([
				{
					id: `id-${artistOf(query)}`,
					name: titleOf(query),
					artist: artistOf(query),
				},
			]);
		const familiarity = (lines: Record<string, unknown>[]) =>
			Object.fromEntries(
				slots(lines).map((song) => [song.artist, song.familiarity]),
			);
		const create = async () =>
			readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", {
						...playlistBody("gemini"),
						trackCount: 4,
					}),
				),
			);

		test("flags songs the listener knows by track, by artist, or not at all", async () => {
			appSongRows.push({ songId: "id-Gunship", artist: "Gunship" });
			installFakeFetch({
				gemini: () => geminiStream(FOUR),
				spotify,
				topTracks: (range) =>
					topTracks(
						range === "short_term"
							? [{ id: "id-Kavinsky", artist: "Kavinsky" }]
							: [],
					),
				// Another release of the same recording: only the ISRC matches.
				library: () =>
					savedTracks([
						{
							id: "other-release",
							artist: "The Midnight",
							isrc: "ISRC-id-The Midnight",
						},
					]),
				recent: () =>
					recentlyPlayed([{ id: "a-different-song", artist: "Com Truise" }]),
			});
			const lines = await create();

			expect(familiarity(lines)).toEqual({
				Kavinsky: "known",
				"The Midnight": "known",
				"Com Truise": "known-artist",
				Gunship: "known",
			});
			expect(appSongQueries).toEqual([
				{ where: ["playlist.user_id", TEST_SESSION.user.id], limit: 1000 },
			]);
			expect(lines.find((l) => l.kind === "novelty")).toEqual({
				kind: "novelty",
				status: "ok",
				knownRecordings: 4,
				knownArtists: 4,
			});
		});

		test("a recent play of the same recording counts as known", async () => {
			installFakeFetch({
				gemini: () => geminiStream(FOUR),
				spotify,
				recent: () => recentlyPlayed([{ id: "id-Gunship", artist: "Gunship" }]),
			});
			const lines = await create();

			expect(familiarity(lines).Gunship).toBe("known");
		});

		test("without a novelty budget the curator is asked before the known set has answered", async () => {
			let curatorAsked: () => void = () => {};
			const asked = new Promise<void>((resolve) => {
				curatorAsked = resolve;
			});
			installFakeFetch({
				gemini: (p) => {
					if (p.startsWith("Build a")) curatorAsked();
					return geminiStream(FOUR);
				},
				spotify,
				// Answers only once the curator call has gone out; a route that
				// waited for the known set first would never get there.
				library: async () => {
					await asked;
					return savedTracks([{ id: "id-Kavinsky", artist: "Kavinsky" }]);
				},
			});
			const lines = await readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", {
						...playlistBody("gemini"),
						trackCount: 4,
						purpose: "room",
					}),
				),
			);

			expect(familiarity(lines).Kavinsky).toBe("known");
		});

		test("a supplied listener stands in for the account reads", async () => {
			const fake = installFakeFetch({
				gemini: () => geminiStream(FOUR),
				spotify,
			});
			const lines = await readNdjson(
				await createForListener(
					post("/api/edge/create-playlist", {
						...playlistBody("gemini"),
						trackCount: 4,
					}),
					fixtureListener({
						takenAt: "2026-09-19T00:00:00Z",
						savedTracks: [
							{ id: "id-Kavinsky", isrc: null, artists: ["Kavinsky"] },
						],
						topTracks: [],
						recentTracks: [{ id: null, isrc: null, artists: ["The Midnight"] }],
					}),
				),
			);

			expect(familiarity(lines)).toEqual({
				Kavinsky: "known",
				"The Midnight": "known-artist",
				"Com Truise": "new",
				Gunship: "new",
			});
			expect(providerCalls(fake, "api.spotify.com/v1/me")).toHaveLength(0);
		});

		test("a song nobody in the known set played is new", async () => {
			installFakeFetch({ gemini: () => geminiStream(FOUR), spotify });
			const lines = await create();

			expect(new Set(Object.values(familiarity(lines)))).toEqual(
				new Set(["new"]),
			);
		});

		test("reports the known set before the lookup round", async () => {
			installFakeFetch({
				gemini: () => geminiStream(FOUR),
				intent: () =>
					geminiStream(
						JSON.stringify({
							exclusions: [
								{ kind: "artist", value: "Daft Punk", quote: "no Daft Punk" },
							],
						}),
					),
			});
			const lines = await readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", {
						...playlistBody("gemini"),
						prompt: "Nocturnal synthwave, no Daft Punk",
					}),
				),
			);

			expect(lines.map((l) => l.kind).slice(0, 4)).toEqual([
				"id",
				"intent",
				"novelty",
				"candidates",
			]);
		});

		test("reads the saved library a page at a time, up to a thousand tracks", async () => {
			const offsets: number[] = [];
			installFakeFetch({
				gemini: () => geminiStream(FOUR),
				library: (offset) => {
					offsets.push(offset);
					return savedTracks([], 5000);
				},
			});
			await create();

			expect(offsets.sort((a, b) => a - b)).toEqual(
				Array.from({ length: 20 }, (_, page) => page * 50),
			);
		});

		test("a known set that cannot be read is reported and leaves songs unflagged", async () => {
			installFakeFetch({
				gemini: () => geminiStream(FOUR),
				spotify,
				library: () => spotifyError(403),
			});
			const lines = await create();

			// A refused grant is the one failure signing in again fixes.
			expect(lines.find((l) => l.kind === "novelty")).toMatchObject({
				kind: "novelty",
				status: "error",
				cause: "access",
			});
			expect(Object.values(familiarity(lines))).toEqual([
				undefined,
				undefined,
				undefined,
				undefined,
			]);
			expect(slots(lines)).toHaveLength(4);
		});

		test("a rate-limited library read is not blamed on the grant", async () => {
			installFakeFetch({
				spotify,
				library: (offset) =>
					offset === 0 ? savedTracks([], 400) : spotifyError(429),
			});
			const lines = await create();

			expect(lines.find((l) => l.kind === "novelty")).toMatchObject({
				status: "error",
				cause: "unavailable",
			});
		});
		test("an earlier-playlist query that fails leaves every song unflagged", async () => {
			appSongFailure.error = new Error("database unreachable");
			installFakeFetch({
				gemini: () => geminiStream(FOUR),
				spotify,
				topTracks: () => topTracks([{ id: "id-Kavinsky", artist: "Kavinsky" }]),
			});
			const lines = await create();

			expect(lines.find((l) => l.kind === "novelty")).toEqual({
				kind: "novelty",
				status: "error",
				cause: "unavailable",
				error: "database unreachable",
			});
			expect(Object.values(familiarity(lines))).toEqual([
				undefined,
				undefined,
				undefined,
				undefined,
			]);
		});

		test("eval results and the report count known tracks and known artists", async () => {
			installFakeFetch({
				gemini: () => geminiStream(FOUR),
				spotify,
				topTracks: () => topTracks([{ id: "id-Kavinsky", artist: "Kavinsky" }]),
				recent: () => recentlyPlayed([{ id: "x", artist: "Gunship" }]),
			});
			const result = await runCase(
				{
					id: "known",
					brief: "Nocturnal synthwave for a long drive",
					creativity: "balanced",
					purpose: "discover",
					trackCount: 4,
					trackCriteria: [],
					playlistCriteria: [],
				},
				"gemini",
			);

			expect(result.known).toBe(1);
			expect(result.knownArtist).toBe(1);
			const header = (TABLE_HEADER.split("\n")[0] ?? "").split(" | ");
			const row = summaryRow({
				caseId: "known",
				engine: "gemini",
				result,
				failures: [],
				overlap: "n/a",
			}).split(" | ");
			expect(row).toHaveLength(header.length);
			expect(row[header.indexOf("known / artist")]).toBe("1 / 1");
		});

		test("login asks for the saved library and recent plays", () => {
			expect(SPOTIFY_SCOPES).toContain("user-library-read");
			expect(SPOTIFY_SCOPES).toContain("user-read-recently-played");
		});
	});

	describe("novelty budget", () => {
		// Six slots, so Discover allows two known tracks and two songs by known artists.
		const SIX = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"];
		const curate = (...pool: string[]) =>
			picks(
				...[...SIX, ...pool].map((artist): [string, string] => [
					artist,
					"Song",
				]),
			);
		const spotify = (query: string) =>
			spotifyTracks([
				{
					id: `id-${artistOf(query)}`,
					name: titleOf(query),
					artist: artistOf(query),
				},
			]);
		const knowsTracks =
			(...artists: string[]) =>
			() =>
				savedTracks(artists.map((artist) => ({ id: `id-${artist}`, artist })));
		const knowsArtists =
			(...artists: string[]) =>
			() =>
				savedTracks(
					artists.map((artist) => ({ id: `other-${artist}`, artist })),
				);
		const create = async (
			purpose: Purpose = "discover",
			prompt = playlistBody("gemini").prompt,
		) =>
			readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", {
						...playlistBody("gemini"),
						prompt,
						trackCount: 6,
						purpose,
					}),
				),
			);
		const budgetLine = (lines: Record<string, unknown>[]) =>
			lines.find((line) => line.kind === "budget");
		const rerankInput = (fake: ReturnType<typeof installFakeFetch>) =>
			JSON.parse(
				providerCalls(fake, PROVIDER_HOST.chatgpt)
					.flatMap((call) => openaiMessages(call))
					.find((m) => m.content.includes('"task":"rerank"'))?.content ?? "{}",
			) as {
				tracks: { artist: string }[];
				pool: { artist: string }[];
			};

		test("Discover swaps known tracks past two for new pool songs before rerank", async () => {
			const fake = installFakeFetch({
				gemini: () => geminiStream(curate("Golf", "Hotel")),
				spotify,
				library: knowsTracks("Alpha", "Bravo", "Charlie", "Golf"),
			});
			const lines = await create();
			const final = slots(lines);
			expect(final.map((s) => s.artist)).toEqual([
				"Alpha",
				"Bravo",
				"Hotel",
				"Delta",
				"Echo",
				"Foxtrot",
			]);
			expect(final[2]).toMatchObject({ origin: "novelty", familiarity: "new" });
			expect(budgetLine(lines)).toEqual({
				kind: "budget",
				status: "held",
				budget: { knownTracks: 2, knownArtists: 2 },
				known: 2,
				byKnownArtist: 2,
				swapped: [final[2]?.id],
			});
			const input = rerankInput(fake);
			// The budget is enforced in the app: rerank is told neither the
			// budget nor which recordings the listener knows.
			expect(input).not.toHaveProperty("noveltyBudget");
			expect(input.tracks.some((track) => "familiarity" in track)).toBe(false);
			expect(input.tracks.map((t) => t.artist)).toEqual([
				"Alpha",
				"Bravo",
				"Hotel",
				"Delta",
				"Echo",
				"Foxtrot",
			]);
			// Golf is known, so rerank is never offered it as a fill.
			expect(input.pool).toEqual([]);
		});

		test("Discover caps songs by known artists at a third", async () => {
			installFakeFetch({
				gemini: () => geminiStream(curate("Golf")),
				spotify,
				library: knowsArtists("Alpha", "Bravo", "Charlie"),
			});
			const lines = await create();
			expect(slots(lines).map((s) => s.artist)).toEqual([
				"Alpha",
				"Bravo",
				"Golf",
				"Delta",
				"Echo",
				"Foxtrot",
			]);
			expect(budgetLine(lines)).toMatchObject({
				status: "held",
				known: 0,
				byKnownArtist: 2,
			});
		});

		test("a known song brought in by evidence repair still counts, and swaps skip rule breakers", async () => {
			installFakeFetch({
				gemini: () => geminiStream(curate("Golf", "India", "Hotel")),
				intent: () =>
					geminiStream(
						JSON.stringify({
							vocalRule: { rule: "no-vocals", quote: "no vocals" },
						}),
					),
				spotify,
				library: knowsTracks("Alpha", "Bravo", "Golf"),
				lrclib: (params) =>
					["Charlie", "India"].includes(params.get("artist_name") ?? "")
						? lrclibRecord({ plainLyrics: "words" })
						: lrclibRecord({ instrumental: true }),
			});
			const lines = await create("discover", "Synthwave with no vocals");
			// Repair puts known Golf in Charlie's slot; the budget then swaps it
			// for Hotel, passing over India, which breaks the no-vocals rule.
			expect(
				lines
					.filter((l) => l.kind === "song" && l.order === 3)
					.map((l) => [l.artist, l.origin]),
			).toEqual([
				["Charlie", "pick"],
				["Charlie", "pick"],
				["Golf", "repair"],
				["Hotel", "novelty"],
			]);
			expect(budgetLine(lines)).toMatchObject({ status: "held", known: 2 });
		});

		test("under a budget rerank is offered only new pool songs", async () => {
			const fake = installFakeFetch({
				gemini: () => geminiStream(curate("Golf", "Hotel")),
				spotify,
				library: knowsArtists("Golf"),
			});
			await create();
			expect(rerankInput(fake).pool.map((song) => song.artist)).toEqual([
				"Hotel",
			]);
		});

		test("a budget the pool cannot restore keeps the songs and reads as breached", async () => {
			installFakeFetch({
				gemini: () => geminiStream(curate()),
				spotify,
				library: knowsTracks("Alpha", "Bravo", "Charlie"),
			});
			const lines = await create();
			expect(slots(lines).map((s) => s.artist)).toEqual(SIX);
			expect(budgetLine(lines)).toMatchObject({
				status: "breached",
				known: 3,
				byKnownArtist: 3,
				swapped: [],
			});
		});

		for (const purpose of ["room", "comfort"] as const)
			test(`${purpose} swaps nothing and still reports the counts`, async () => {
				const fake = installFakeFetch({
					gemini: () => geminiStream(curate("Golf")),
					spotify,
					library: knowsTracks("Alpha", "Bravo", "Charlie"),
				});
				const lines = await create(purpose);
				expect(slots(lines).map((s) => s.artist)).toEqual(SIX);
				expect(budgetLine(lines)).toEqual({
					kind: "budget",
					status: "uncapped",
					known: 3,
					byKnownArtist: 3,
				});
				expect(rerankInput(fake)).not.toHaveProperty("noveltyBudget");
			});

		test("without a known set nothing is swapped and the budget is unknown", async () => {
			installFakeFetch({
				gemini: () => geminiStream(curate("Golf")),
				spotify,
				library: () => spotifyError(403),
			});
			const lines = await create();
			expect(slots(lines).map((s) => s.artist)).toEqual(SIX);
			expect(budgetLine(lines)).toEqual({ kind: "budget", status: "unknown" });
		});

		test("eval results show the budget outcome, which the judge never sees", async () => {
			const fake = installFakeFetch({
				gemini: () => geminiStream(curate("Golf")),
				spotify,
				library: knowsTracks("Alpha", "Bravo", "Charlie"),
			});
			const result = await runCase(
				{
					id: "budget",
					brief: "Nocturnal synthwave for a long drive",
					creativity: "balanced",
					purpose: "discover",
					trackCount: 6,
					trackCriteria: [],
					playlistCriteria: [],
				},
				"gemini",
			);
			expect(result.budget).toMatchObject({ status: "held", known: 2 });
			const header = (TABLE_HEADER.split("\n")[0] ?? "").split(" | ");
			const row = summaryRow({
				caseId: "budget",
				engine: "gemini",
				result,
				failures: [],
				overlap: "n/a",
			}).split(" | ");
			expect(row).toHaveLength(header.length);
			expect(row[header.indexOf("budget")]).toBe("held, 1 swapped");
			// The judge is an engine too: the known set stays in the app.
			await judgePlaylist(result, "gemini");
			const input = JSON.parse(geminiPrompt(fake.requests.at(-1)) ?? "{}") as {
				tracks: Record<string, unknown>[];
			};
			expect(input.tracks).toHaveLength(6);
			expect(input.tracks.some((track) => "familiarity" in track)).toBe(false);
		});
	});

	describe("popularity budget", () => {
		const SIX = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"];
		const curate = (...pool: string[]) =>
			picks(
				...[...SIX, ...pool].map((artist): [string, string] => [
					artist,
					"Song",
				]),
			);
		const spotify = (query: string) =>
			spotifyTracks([
				{
					id: `id-${artistOf(query)}`,
					name: titleOf(query),
					artist: artistOf(query),
				},
			]);
		const HIT = MAINSTREAM_LISTENERS.lastfm;
		/** Last.fm counts by artist; an artist left out has no Last.fm record. */
		const listeners =
			(counts: Record<string, number>) => (params: URLSearchParams) => {
				const count = counts[params.get("artist") ?? ""];
				return count === undefined
					? Response.json({ error: 6, message: "Track not found" })
					: lastfmTrack({ listeners: count });
			};
		const create = async (body: Record<string, unknown>) =>
			readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", {
						...playlistBody("gemini"),
						trackCount: 6,
						...body,
					}),
				),
			);
		const popularityLine = (lines: Record<string, unknown>[]) =>
			lines.find((line) => line.kind === "popularity");
		type RerankInput = {
			popularityBudget: unknown;
			tracks: { id: string; artist: string; mainstream: boolean }[];
			pool: { id: string; artist: string; mainstream: boolean }[];
		};
		const rerankInput = (fake: ReturnType<typeof installFakeFetch>) =>
			JSON.parse(
				providerCalls(fake, PROVIDER_HOST.chatgpt)
					.flatMap((call) => openaiMessages(call))
					.find((m) => m.content.includes('"task":"rerank"'))?.content ?? "{}",
			) as RerankInput;

		test("each creativity sets a ceiling and Room sets a floor instead", () => {
			expect(popularityBudget("safe", "discover", 10)).toBeNull();
			expect(popularityBudget("balanced", "discover", 10)).toEqual({
				maxMainstream: 6,
				minMainstream: null,
			});
			expect(popularityBudget("adventurous", "comfort", 10)).toEqual({
				maxMainstream: 3,
				minMainstream: null,
			});
			for (const creativity of CREATIVITY_LEVELS)
				expect(popularityBudget(creativity, "room", 9)).toEqual({
					maxMainstream: null,
					minMainstream: 5,
				});
		});

		test("Adventurous keeps the first three mainstream picks and swaps later ones for pool songs that are not, unknown counts included", async () => {
			const fake = installFakeFetch({
				gemini: () => geminiStream(curate("Golf", "Hotel", "India")),
				spotify,
				lastfm: listeners({
					Alpha: HIT,
					Bravo: HIT,
					Charlie: HIT,
					Delta: HIT,
					Echo: HIT,
					Foxtrot: 100,
					Golf: HIT,
					Hotel: HIT - 1,
				}),
			});
			const lines = await create({ creativity: "adventurous" });
			const final = slots(lines);
			expect(final.map((s) => [s.artist, s.origin])).toEqual([
				["Alpha", "pick"],
				["Bravo", "pick"],
				["Charlie", "pick"],
				["Hotel", "popularity"],
				["India", "popularity"],
				["Foxtrot", "pick"],
			]);
			expect(popularityLine(lines)).toMatchObject({
				status: "held",
				budget: { maxMainstream: 3, minMainstream: null },
				recordings: 6,
				mainstream: 3,
				unknown: 1,
				swapped: [final[3]?.id, final[4]?.id],
			});
			const input = rerankInput(fake);
			expect(input.popularityBudget).toEqual({
				maxMainstream: 3,
				minMainstream: null,
			});
			expect(input.tracks.map((t) => t.mainstream)).toEqual([
				true,
				true,
				true,
				false,
				false,
				false,
			]);
			expect(input.pool.map((t) => [t.artist, t.mainstream])).toEqual([
				["Golf", true],
			]);
		});

		test("Room lifts a set below half mainstream from the pool, replacing the least-heard picks first", async () => {
			installFakeFetch({
				gemini: () => geminiStream(curate("Golf", "Hotel", "India")),
				spotify,
				lastfm: listeners({
					Alpha: HIT,
					Bravo: 100,
					Delta: 5000,
					Echo: 200,
					Foxtrot: 300,
					Golf: HIT,
					Hotel: 50,
					India: HIT * 2,
				}),
			});
			const lines = await create({ purpose: "room" });
			const final = slots(lines);
			expect(final.map((s) => [s.artist, s.origin])).toEqual([
				["Alpha", "pick"],
				["India", "popularity"],
				["Golf", "popularity"],
				["Delta", "pick"],
				["Echo", "pick"],
				["Foxtrot", "pick"],
			]);
			expect(popularityLine(lines)).toMatchObject({
				status: "held",
				budget: { maxMainstream: null, minMainstream: 3 },
				mainstream: 3,
				swapped: [final[2]?.id, final[1]?.id],
			});
		});

		test("the floor ranks picks by how near they come to their own source's threshold", async () => {
			const LB = MAINSTREAM_LISTENERS.listenbrainz;
			installFakeFetch({
				gemini: () => geminiStream(curate("Golf", "Hotel")),
				spotify,
				musicbrainz: (isrc) => musicbrainzRecording({ mbid: `mb-${isrc}` }),
				listenbrainz: (mbids) =>
					mbids[0]?.includes("Charlie")
						? listenbrainzPopularity(mbids[0], LB - 100)
						: Response.json([]),
				lastfm: listeners({
					Alpha: HIT,
					Bravo: HIT * 0.8,
					Delta: HIT * 0.6,
					Echo: HIT * 0.76,
					Foxtrot: HIT * 0.84,
					Golf: HIT,
					Hotel: HIT,
				}),
			});
			const final = slots(await create({ purpose: "room" }));
			// Charlie's ListenBrainz count is the smallest number but the
			// nearest its threshold, so Delta and Echo make way.
			expect(final.map((s) => [s.artist, s.origin])).toEqual([
				["Alpha", "pick"],
				["Bravo", "pick"],
				["Charlie", "pick"],
				["Golf", "popularity"],
				["Hotel", "popularity"],
				["Foxtrot", "pick"],
			]);
		});

		test("under a novelty budget a popularity swap never brings in a known song", async () => {
			installFakeFetch({
				gemini: () => geminiStream(curate("Golf", "Hotel")),
				spotify,
				library: () => savedTracks([{ id: "id-Golf", artist: "Golf" }]),
				lastfm: listeners({
					Alpha: HIT,
					Bravo: HIT,
					Charlie: HIT,
					Delta: HIT,
					Echo: HIT,
				}),
			});
			const lines = await create({
				purpose: "discover",
				creativity: "adventurous",
			});
			const final = slots(lines);
			expect(final.map((s) => s.artist)).toEqual([
				"Alpha",
				"Bravo",
				"Charlie",
				"Hotel",
				"Echo",
				"Foxtrot",
			]);
			expect(popularityLine(lines)).toMatchObject({
				status: "breached",
				mainstream: 4,
				swapped: [final[3]?.id],
			});
		});

		test("a budget the pool cannot meet stays breached, and Safe is uncapped", async () => {
			const famous = Object.fromEntries(SIX.map((artist) => [artist, HIT]));
			installFakeFetch({
				gemini: () => geminiStream(curate()),
				spotify,
				lastfm: listeners(famous),
			});
			expect(
				popularityLine(await create({ creativity: "adventurous" })),
			).toMatchObject({ status: "breached", mainstream: 6, swapped: [] });
			installFakeFetch({
				gemini: () => geminiStream(curate()),
				spotify,
				lastfm: listeners(famous),
			});
			expect(popularityLine(await create({ creativity: "safe" }))).toEqual({
				kind: "popularity",
				status: "uncapped",
				recordings: 6,
				mainstream: 6,
				unknown: 0,
				median: { lastfm: HIT, listenbrainz: null },
			});
		});

		test("rerank may not fill a pruned slot with a song that breaks the budget", async () => {
			installFakeFetch({
				gemini: () => geminiStream(curate("Golf")),
				spotify,
				lastfm: listeners({ Alpha: HIT, Bravo: HIT, Charlie: HIT, Golf: HIT }),
				openai: (p) =>
					openaiStream(
						p.startsWith('{"task":"rerank"')
							? (() => {
									const input = JSON.parse(p) as RerankInput;
									// Delta, not mainstream, makes way for Golf, which is.
									const delta = input.tracks[3]?.id ?? "";
									return JSON.stringify({
										order: [
											...input.tracks
												.filter((t) => t.id !== delta)
												.map((t) => t.id),
											input.pool[0]?.id ?? "",
										],
										prune: [delta],
										reasons: Object.fromEntries(
											[...input.tracks, ...input.pool].map((t) => [
												t.id,
												`${t.artist} fits`,
											]),
										),
									});
								})()
							: "",
					),
			});
			const lines = await create({ creativity: "adventurous" });
			expect(slots(lines).map((s) => s.artist)).toEqual(SIX);
			expect(lines.find((l) => l.kind === "rerank")).toMatchObject({
				status: "ok",
				restored: [slots(lines)[3]?.id],
			});
			expect(popularityLine(lines)).toMatchObject({
				status: "held",
				mainstream: 3,
			});
		});

		test("the eval report shows the budget outcome", async () => {
			installFakeFetch({
				gemini: () => geminiStream(curate("Golf", "Hotel")),
				spotify,
				lastfm: listeners({
					Alpha: HIT,
					Bravo: HIT,
					Charlie: HIT,
					Delta: HIT,
					Echo: HIT,
				}),
			});
			const result = await runCase(
				{
					id: "popularity",
					brief: "Nocturnal synthwave for a long drive",
					creativity: "adventurous",
					purpose: "comfort",
					trackCount: 6,
					trackCriteria: [],
					playlistCriteria: [],
				},
				"gemini",
			);
			const header = (TABLE_HEADER.split("\n")[0] ?? "").split(" | ");
			const row = summaryRow({
				caseId: "popularity",
				engine: "gemini",
				result,
				failures: [],
				overlap: "n/a",
			}).split(" | ");
			expect(row).toHaveLength(header.length);
			expect(row[header.indexOf("popularity budget")]).toBe(
				"held ≤3, 2 swapped",
			);
		});
	});

	describe("purpose", () => {
		const THREE = picks(
			["Kavinsky", "Nightcall"],
			["The Midnight", "Sunset"],
			["Com Truise", "Brokendate"],
		);
		const curatorPrompt = (fake: { requests: RecordedRequest[] }) =>
			providerCalls(fake, PROVIDER_HOST.gemini)
				.map(geminiPrompt)
				.find((p) => p?.startsWith("Build a")) ?? "";
		/** The rerank input the other engine received. */
		const rerankInput = (fake: { requests: RecordedRequest[] }) =>
			JSON.parse(
				providerCalls(fake, PROVIDER_HOST.chatgpt)
					.map((call) => openaiMessages(call).at(-1)?.content ?? "")
					.find((c) => c.startsWith('{"task":"rerank"')) ?? "{}",
			) as { purpose?: string; sequencing?: string };

		test("a request without a purpose is built for discovery and says so on the intent line", async () => {
			const fake = installFakeFetch({ gemini: () => geminiStream(THREE) });
			const lines = await readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", playlistBody("gemini")),
				),
			);

			expect(lines[1]).toMatchObject({ kind: "intent", purpose: "discover" });
			expect(curatorPrompt(fake)).toContain(PURPOSE.discover.instruction);
			expect(rerankInput(fake)).toMatchObject({
				purpose: "discover",
				sequencing: PURPOSE.discover.sequencing,
			});
		});

		for (const purpose of PURPOSES) {
			test(`a ${purpose} playlist names its purpose to the curator, rerank and eval report`, async () => {
				const fake = installFakeFetch({ gemini: () => geminiStream(THREE) });
				const result = await runCase(
					{
						id: purpose,
						brief: "Nocturnal synthwave for a long drive",
						creativity: "balanced",
						purpose,
						trackCount: 2,
						trackCriteria: [],
						playlistCriteria: [],
					},
					"gemini",
				);

				const prompt = curatorPrompt(fake);
				expect(prompt).toContain(PURPOSE[purpose].instruction);
				for (const other of PURPOSES.filter((p) => p !== purpose))
					expect(prompt).not.toContain(PURPOSE[other].instruction);
				expect(rerankInput(fake)).toMatchObject({
					purpose,
					sequencing: PURPOSE[purpose].sequencing,
				});
				expect(result.generation.purpose).toBe(purpose);
				const header = (TABLE_HEADER.split("\n")[0] ?? "").split(" | ");
				const row = summaryRow({
					caseId: purpose,
					engine: "gemini",
					result,
					failures: [],
					overlap: "n/a",
				}).split(" | ");
				expect(row[header.indexOf("purpose")]).toBe(purpose);
			});
		}

		test("an unknown purpose is rejected", async () => {
			installFakeFetch({ gemini: () => geminiStream(THREE) });
			await expect(
				createPlaylist(
					post("/api/edge/create-playlist", {
						...playlistBody("gemini"),
						purpose: "background",
					}),
				),
			).rejects.toThrow();
		});

		test("a replacement for a missing pick is asked for with the purpose", async () => {
			let calls = 0;
			const fake = installFakeFetch({
				gemini: (p) =>
					geminiStream(
						p.startsWith("Build a") || calls++ > 0
							? picks(["Kavinsky", "Nightcall"], ["The Midnight", "Sunset"])
							: "",
					),
				spotify: (query) =>
					query.includes("Kavinsky") ? spotifyNoMatch() : spotifyMatch(query),
			});
			await readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", {
						...playlistBody("gemini"),
						purpose: "comfort",
					}),
				),
			);
			const replacement = providerCalls(fake, PROVIDER_HOST.gemini)
				.map(geminiPrompt)
				.find((p) => p?.includes("Suggest ONE new song"));
			expect(replacement).toContain(PURPOSE.comfort.instruction);
		});
	});

	describe("intent", () => {
		const BRIEF = "Synthwave nocturno, sin cantantes, nada de Daft Punk";
		const INTENT_TEXT = JSON.stringify({
			genres: ["synthwave"],
			era: { start: 2010, end: 2020 },
			mood: "late night drive",
			energy: "steady",
			language: "Spanish",
			vocalRule: { rule: "no-vocals", quote: "sin cantantes" },
			exclusions: [
				{ kind: "artist", value: "Daft Punk", quote: "nada de Daft Punk" },
				{ kind: "style", value: "trap", quote: "not in the brief" },
			],
			mustInclude: [],
		});
		test("records the read's token usage", async () => {
			installFakeFetch({
				openai: () => openaiStream(PLAYLIST_TEXT),
				intent: () => geminiStream(INTENT_TEXT),
			});
			await (
				await createPlaylist(
					post("/api/edge/create-playlist", {
						...playlistBody("chatgpt"),
						prompt: BRIEF,
					}),
				)
			).text();
			expect(tokenUsageInserts[0]).toMatchObject({
				userId: "user-1",
				engine: "gemini",
				inputTokens: GEMINI_USAGE.promptTokenCount,
				outputTokens:
					GEMINI_USAGE.candidatesTokenCount + GEMINI_USAGE.thoughtsTokenCount,
				totalTokens: GEMINI_USAGE.totalTokenCount,
			});
		});

		test("emits an intent line before the first song, keeping only hard rules that quote the brief", async () => {
			const fake = installFakeFetch({
				openai: () => openaiStream(PLAYLIST_TEXT),
				intent: () => geminiStream(INTENT_TEXT),
			});
			const res = await createPlaylist(
				post("/api/edge/create-playlist", {
					...playlistBody("chatgpt"),
					prompt: BRIEF,
				}),
			);
			const lines = await readNdjson(res);

			for (const line of lines) {
				expect(PlaylistLineSchema.safeParse(line).success).toBe(true);
			}
			expect(lines.map((l) => l.kind).slice(0, 5)).toEqual([
				"id",
				"intent",
				"novelty",
				// A difficult brief gets a search round before the curator writes.
				"candidates",
				"name",
			]);
			const intent = lines[1]?.intent as Record<string, unknown>;
			expect(intent.genres).toEqual(["synthwave"]);
			expect(intent.vocalRule).toEqual({
				rule: "no-vocals",
				quote: "sin cantantes",
			});
			expect(intent.exclusions).toEqual([
				{ kind: "artist", value: "Daft Punk", quote: "nada de Daft Punk" },
			]);
			expect(intent.difficulty).toBe("difficult");

			expect(fake.intentReads).toHaveLength(1);
			const read = fake.intentReads[0];
			if (!read) throw new Error("intent read not recorded");
			expect(
				(read.body.generationConfig as { temperature: number }).temperature,
			).toBe(0);
			expect(JSON.parse(geminiPrompt(read) ?? "{}").brief).toBe(BRIEF);
		});

		test("a failed intent read yields a null intent and an otherwise normal playlist", async () => {
			installFakeFetch({
				gemini: () => geminiStream(PLAYLIST_TEXT),
				intent: () => geminiStream("not json at all"),
			});
			const res = await createPlaylist(
				post("/api/edge/create-playlist", playlistBody("gemini")),
			);
			const lines = await readNdjson(res);

			expect(lines[1]).toEqual({
				kind: "intent",
				intent: null,
				purpose: "discover",
			});
			expect(lines.filter((l) => l.kind === "song")).toHaveLength(4);
		});

		test("routes vocal repair from the intent's vocal rule, not the brief wording", async () => {
			const fake = installFakeFetch({
				gemini: (p) =>
					geminiStream(
						p.startsWith('{"task":"review-vocals"')
							? '{"restriction":null,"tracks":[]}'
							: PLAYLIST_TEXT,
					),
				intent: () => geminiStream(INTENT_TEXT),
			});
			const res = await createPlaylist(
				post("/api/edge/create-playlist", {
					...playlistBody("gemini"),
					prompt: BRIEF,
				}),
			);
			const lines = await readNdjson(res);

			expect(lines.filter((l) => l.kind === "vocal-review")).toHaveLength(1);
			expect(
				fake.requests.some((r) =>
					geminiPrompt(r)?.startsWith('{"task":"review-vocals"'),
				),
			).toBe(true);
		});

		test("skips vocal repair when the intent welcomes vocals even though the brief mentions them", async () => {
			const brief = "Electronic music, vocals welcome";
			const fake = installFakeFetch({
				gemini: () => geminiStream(PLAYLIST_TEXT),
				intent: () =>
					geminiStream(
						JSON.stringify({
							genres: ["electronic"],
							era: null,
							mood: null,
							energy: null,
							language: null,
							vocalRule: { rule: "vocals-welcome", quote: "vocals welcome" },
							exclusions: [],
							mustInclude: [],
						}),
					),
			});
			const res = await createPlaylist(
				post("/api/edge/create-playlist", {
					...playlistBody("gemini"),
					prompt: brief,
				}),
			);
			const lines = await readNdjson(res);

			expect(lines.filter((l) => l.kind === "vocal-review")).toHaveLength(0);
			expect(
				fake.requests.some((r) =>
					geminiPrompt(r)?.startsWith('{"task":"review-vocals"'),
				),
			).toBe(false);
		});

		test("an intent read past its deadline yields a null intent", async () => {
			installFakeFetch({
				gemini: () => geminiStream(PLAYLIST_TEXT),
				intent: () =>
					new Response(new ReadableStream<Uint8Array>({ start() {} })),
			});
			const realTimeout = globalThis.setTimeout;
			// Accelerate only the read deadline; the fallback catches a hang.
			globalThis.setTimeout = ((callback: () => void, delay: number) =>
				realTimeout(callback, delay === 8000 ? 1 : delay)) as typeof setTimeout;
			try {
				const reading = readNdjson(
					await createPlaylist(
						post("/api/edge/create-playlist", playlistBody("gemini")),
					),
				);
				const lines = await Promise.race([
					reading,
					new Promise<null>((resolve) => realTimeout(() => resolve(null), 50)),
				]);
				expect(lines?.[1]).toEqual({
					kind: "intent",
					intent: null,
					purpose: "discover",
				});
				expect(lines?.filter((l) => l.kind === "song")).toHaveLength(4);
			} finally {
				globalThis.setTimeout = realTimeout;
			}
		});

		test("falls back to the wording cue when the intent took no stance on vocals", async () => {
			const fake = installFakeFetch({
				gemini: (p) =>
					geminiStream(
						p.startsWith('{"task":"review-vocals"')
							? '{"restriction":null,"tracks":[]}'
							: PLAYLIST_TEXT,
					),
				intent: () =>
					geminiStream(
						JSON.stringify({
							genres: ["lo-fi"],
							vocalRule: { rule: "no-vocals", quote: "without vocals" },
						}),
					),
			});
			const res = await createPlaylist(
				post("/api/edge/create-playlist", {
					...playlistBody("gemini"),
					prompt: "Deep focus beats, no vocals!",
				}),
			);
			const lines = await readNdjson(res);

			const intent = lines[1]?.intent as { vocalRule: unknown };
			expect(intent.vocalRule).toEqual({ rule: "none", quote: null });
			expect(lines.filter((l) => l.kind === "vocal-review")).toHaveLength(1);
			expect(
				fake.requests.some((r) =>
					geminiPrompt(r)?.startsWith('{"task":"review-vocals"'),
				),
			).toBe(true);
		});

		test("eval run results record the intent", async () => {
			installFakeFetch({
				openai: () => openaiStream(PLAYLIST_TEXT),
				intent: () => geminiStream(INTENT_TEXT),
			});
			const result = await runCase(
				{
					id: "intent-capture",
					brief: BRIEF,
					creativity: "balanced",
					purpose: "discover",
					trackCount: 2,
					trackCriteria: [],
					playlistCriteria: [],
				},
				"chatgpt",
			);
			expect(result.intent?.genres).toEqual(["synthwave"]);
			expect(result.intent?.vocalRule.rule).toBe("no-vocals");
		});
	});

	for (const engine of ["chatgpt", "gemini"] as const) {
		describe(`engine=${engine}`, () => {
			test("streams id, metadata, and songs in order", async () => {
				installFakeFetch({
					openai: () => openaiStream(PLAYLIST_TEXT),
					gemini: () => geminiStream(PLAYLIST_TEXT),
				});
				const res = await createPlaylist(
					post("/api/edge/create-playlist", playlistBody(engine)),
				);
				expect(res.status).toBe(200);
				const lines = await readNdjson(res);

				expect(lines[0]?.kind).toBe("id");
				expect(lines.map((l) => l.kind)).toEqual([
					"id",
					"intent",
					"novelty",
					"candidates",
					"name",
					"description",
					"song",
					"song",
					"song",
					"song",
					"evidence",
					"evidence",
					"rerank",
					"budget",
					"popularity",
					"complete",
				]);
				const songs = lines.filter((l) => l.kind === "song");
				expect(songs.map((s) => s.title)).toEqual([
					"Nightcall",
					"Nightcall",
					"Sunset",
					"Sunset",
				]);
				// The second emission of each song is the Spotify-enriched one.
				expect(songs[0]).not.toHaveProperty("songId");
				expect(typeof songs[1]?.songId).toBe("string");
				expect(songs[0]?.id).toBe(songs[1]?.id);
			});

			test("falls back to a plain-text Spotify search when the fielded query misses", async () => {
				const fake = installFakeFetch({
					openai: () => openaiStream(PLAYLIST_TEXT),
					gemini: () => geminiStream(PLAYLIST_TEXT),
					spotify: spotifyMatchPlainOnly,
				});
				const res = await createPlaylist(
					post("/api/edge/create-playlist", playlistBody(engine)),
				);
				const songs = (await readNdjson(res)).filter((l) => l.kind === "song");

				expect(spotifyQueries(fake).slice(0, 2)).toEqual([
					"artist:Kavinsky track:Nightcall",
					"Kavinsky Nightcall",
				]);
				expect(typeof songs[1]?.songId).toBe("string");
				expect(providerCalls(fake, PROVIDER_HOST[engine])).toHaveLength(1);
			});

			test("asks the curator for a replacement when a song is not on Spotify", async () => {
				const replacement = '{"artist":"Com Truise","title":"Brokendate"}';
				let calls = 0;
				const answer = (stream: (text: string) => Response) => () =>
					stream(calls++ === 0 ? PLAYLIST_TEXT : replacement);
				const fake = installFakeFetch({
					openai: answer(openaiStream),
					gemini: answer(geminiStream),
					spotify: (query) =>
						query.includes("Nightcall")
							? spotifyNoMatch()
							: spotifyMatch(query),
				});
				const res = await createPlaylist(
					post("/api/edge/create-playlist", playlistBody(engine)),
				);
				const songs = (await readNdjson(res)).filter((l) => l.kind === "song");

				// The unresolved row is swapped in place (same id and order): raw
				// pick, raw replacement, enriched replacement. The replacement runs
				// off the main stream, so the second song may resolve in between.
				const slot = songs.filter((s) => s.id === songs[0]?.id);
				expect(slot.map((s) => s.title)).toEqual([
					"Nightcall",
					"Brokendate",
					"Brokendate",
				]);
				expect(slot[1]).not.toHaveProperty("songId");
				expect(typeof slot[2]?.songId).toBe("string");
				expect(slot.every((s) => s.order === 1)).toBe(true);
				expect(songs.filter((s) => s.title === "Sunset")).toHaveLength(2);

				const provider = providerCalls(fake, PROVIDER_HOST[engine]);
				expect(provider).toHaveLength(2);
				const replacePrompt =
					engine === "chatgpt"
						? openaiMessages(provider[1]).at(-1)?.content
						: geminiPrompt(provider[1]);
				expect(replacePrompt).toContain("Kavinsky - Nightcall");
				expect(replacePrompt).toContain("Late Night Drive");
				expect(replacePrompt).toContain("Nocturnal synthwave");
			});

			test("retries without a remix suffix and accepts loosely spelled artists", async () => {
				const text = [
					'{"kind":"name","name":"Garage"}',
					'{"kind":"description","description":"UKG."}',
					'{"kind":"song","order":1,"artist":"Brasstooth","title":"Celebrate Life - El-B Vocal Mix"}',
					'{"kind":"song","order":2,"artist":"LeMatos","title":"Sarah"}',
				].join("\n");
				const fake = installFakeFetch({
					openai: () => openaiStream(text),
					gemini: () => geminiStream(text),
					spotify: (query) => {
						if (query === "artist:Brasstooth track:Celebrate Life")
							return spotifyMatch(query, "Brasstooth");
						if (query.includes("Sarah")) return spotifyMatch(query, "Le Matos");
						return spotifyNoMatch();
					},
				});
				const res = await createPlaylist(
					post("/api/edge/create-playlist", playlistBody(engine)),
				);
				const songs = (await readNdjson(res)).filter((l) => l.kind === "song");
				expect(songs.filter((s) => typeof s.songId === "string")).toHaveLength(
					2,
				);
				expect(spotifyQueries(fake)).toEqual([
					"artist:Brasstooth track:Celebrate Life - El-B Vocal Mix",
					"Brasstooth Celebrate Life - El-B Vocal Mix",
					"artist:Brasstooth track:Celebrate Life",
					"artist:LeMatos track:Sarah",
				]);
			});

			test("matches non-Latin artist names without matching everything", async () => {
				const text = [
					'{"kind":"name","name":"東京"}',
					'{"kind":"description","description":"J-pop."}',
					'{"kind":"song","order":1,"artist":"宇多田ヒカル","title":"Automatic"}',
					'{"kind":"song","order":2,"artist":"!!!","title":"Heart of Hearts"}',
				].join("\n");
				const fake = installFakeFetch({
					openai: () => openaiStream(text),
					gemini: () => geminiStream(text),
					spotify: (query) =>
						query.startsWith("artist:")
							? spotifyNoMatch()
							: spotifyMatch(
									query,
									query.includes("Automatic") ? "宇多田ヒカル" : "Taylor Swift",
								),
				});
				const res = await createPlaylist(
					post("/api/edge/create-playlist", playlistBody(engine)),
				);
				const songs = (await readNdjson(res)).filter((l) => l.kind === "song");
				const utada = songs.filter((s) => s.artist === "宇多田ヒカル");
				expect(typeof utada.at(-1)?.songId).toBe("string");
				const chk = songs.filter((s) => s.title === "Heart of Hearts");
				expect(chk.at(-1)?.songId ?? null).toBeNull();
				expect(
					providerCalls(fake, PROVIDER_HOST[engine]).length,
				).toBeGreaterThan(1);
			});

			test("rejects a plain-text hit by a different artist", async () => {
				const fake = installFakeFetch({
					openai: () => openaiStream(PLAYLIST_TEXT),
					gemini: () => geminiStream(PLAYLIST_TEXT),
					spotify: (query) =>
						query.startsWith("artist:")
							? spotifyNoMatch()
							: spotifyMatch(query, "Somebody Else"),
				});
				const res = await createPlaylist(
					post("/api/edge/create-playlist", playlistBody(engine)),
				);
				const songs = (await readNdjson(res)).filter((l) => l.kind === "song");
				// Nothing resolves, and the curator (called with the playlist text
				// again) offers picks that also miss, so every slot ends unresolved.
				expect(songs.every((s) => !s.songId)).toBe(true);
				expect(
					providerCalls(fake, PROVIDER_HOST[engine]).length,
				).toBeGreaterThan(1);
			});

			test("does not swap a song when Spotify itself fails", async () => {
				const fake = installFakeFetch({
					openai: () => openaiStream(PLAYLIST_TEXT),
					gemini: () => geminiStream(PLAYLIST_TEXT),
					spotify: () => spotifyError(429),
				});
				const res = await createPlaylist(
					post("/api/edge/create-playlist", playlistBody(engine)),
				);
				expect(res.status).toBe(200);
				const songs = (await readNdjson(res)).filter((l) => l.kind === "song");
				expect(songs.map((s) => s.title)).toEqual([
					"Nightcall",
					"Nightcall",
					"Sunset",
					"Sunset",
				]);
				expect(songs[1]).toHaveProperty("songId", null);
				expect(providerCalls(fake, PROVIDER_HOST[engine])).toHaveLength(1);
			});

			test("a rate-limited search is retried once the limit lifts", async () => {
				let searches = 0;
				const fake = installFakeFetch({
					openai: () => openaiStream(PLAYLIST_TEXT),
					gemini: () => geminiStream(PLAYLIST_TEXT),
					spotify: (q) =>
						searches++ === 0 ? spotifyError(429) : spotifyMatch(q),
				});
				const res = await createPlaylist(
					post("/api/edge/create-playlist", playlistBody(engine)),
				);
				const songs = (await readNdjson(res)).filter((l) => l.kind === "song");
				expect(songs.map((s) => s.songId ?? null)).toEqual([
					null,
					"sp-artist-kavinsky-track-nightcall",
					null,
					"sp-artist-the-midnight-track-sunset",
				]);
				// The first fielded search is answered on its retry, so every
				// song resolves on its first query.
				expect(spotifyQueries(fake)).toEqual([
					"artist:Kavinsky track:Nightcall",
					"artist:Kavinsky track:Nightcall",
					"artist:The Midnight track:Sunset",
				]);
			});

			test("keeps the unresolved song when the curator repeats an artist", async () => {
				let calls = 0;
				const answer = (stream: (text: string) => Response) => () =>
					stream(
						calls++ === 0
							? PLAYLIST_TEXT
							: '{"artist":"The Midnight","title":"Los Angeles"}',
					);
				installFakeFetch({
					openai: answer(openaiStream),
					gemini: answer(geminiStream),
					spotify: (query) =>
						query.includes("Nightcall")
							? spotifyNoMatch()
							: spotifyMatch(query),
				});
				const res = await createPlaylist(
					post("/api/edge/create-playlist", playlistBody(engine)),
				);
				const songs = (await readNdjson(res)).filter((l) => l.kind === "song");
				expect(songs.map((s) => s.title)).not.toContain("Los Angeles");
				expect(songs.at(-1)).toMatchObject({
					title: "Nightcall",
					songId: null,
				});
			});

			test("keeps the unresolved song when the curator is unreachable", async () => {
				let calls = 0;
				const answer = (stream: (text: string) => Response) => () => {
					if (calls++ === 0) return stream(PLAYLIST_TEXT);
					throw new TypeError("fetch failed");
				};
				installFakeFetch({
					openai: answer(openaiStream),
					gemini: answer(geminiStream),
					spotify: spotifyNoMatch,
				});
				const res = await createPlaylist(
					post("/api/edge/create-playlist", playlistBody(engine)),
				);
				const songs = (await readNdjson(res)).filter((l) => l.kind === "song");
				expect(songs).toHaveLength(4);
				expect(songs.filter((s) => s.songId === null)).toHaveLength(2);
			});

			test("keeps the unresolved song when the curator has no replacement", async () => {
				let calls = 0;
				const answer = (stream: (text: string) => Response) => () =>
					stream(calls++ === 0 ? PLAYLIST_TEXT : "no idea, sorry");
				installFakeFetch({
					openai: answer(openaiStream),
					gemini: answer(geminiStream),
					spotify: spotifyNoMatch,
				});
				const res = await createPlaylist(
					post("/api/edge/create-playlist", playlistBody(engine)),
				);
				expect(res.status).toBe(200);
				const songs = (await readNdjson(res)).filter((l) => l.kind === "song");
				expect(songs.map((s) => s.title).sort()).toEqual([
					"Nightcall",
					"Nightcall",
					"Sunset",
					"Sunset",
				]);
				expect(songs.filter((s) => s.songId === null)).toHaveLength(2);
			});

			test("sends the curator system prompt and the creativity clause", async () => {
				const fake = installFakeFetch({
					openai: () => openaiStream(PLAYLIST_TEXT),
					gemini: () => geminiStream(PLAYLIST_TEXT),
				});
				await (
					await createPlaylist(
						post(
							"/api/edge/create-playlist",
							playlistBody(engine, "adventurous"),
						),
					)
				).text();
				const call = providerCalls(fake, PROVIDER_HOST[engine])[0];
				const system =
					engine === "chatgpt"
						? openaiMessages(call).find((m) => m.role === "system")?.content
						: geminiSystem(call);
				const prompt =
					engine === "chatgpt"
						? openaiMessages(call).find((m) => m.role === "user")?.content
						: geminiPrompt(call);
				expect(system).toContain("curator");
				expect(prompt).toContain(CREATIVITY.adventurous.instruction);
				expect(prompt).toContain("Nocturnal synthwave for a long drive");
			});

			test("calls the provider with the registry model", async () => {
				const fake = installFakeFetch({
					openai: () => openaiStream(PLAYLIST_TEXT),
					gemini: () => geminiStream(PLAYLIST_TEXT),
				});
				await (
					await createPlaylist(
						post("/api/edge/create-playlist", playlistBody(engine)),
					)
				).text();

				const call = providerCalls(fake, PROVIDER_HOST[engine])[0];
				expect(call).toBeDefined();
				if (!call) return;

				if (engine === "chatgpt") {
					expect(call.body.model).toBe(ENGINES.chatgpt.model);
					expect(call.headers.authorization).toBe(
						`Bearer ${process.env.OPENAI_KEY}`,
					);
					expect(call.body.stream).toBe(true);
					expect(call.body.reasoning_effort).toBe("none");
					expect(call.body.stream_options).toEqual({ include_usage: true });
					expect(call.body.max_completion_tokens).toBeGreaterThan(0);
					expect(call.body.temperature).toBe(CREATIVITY.balanced.temperature);
					expect(call.body).not.toHaveProperty("top_p");
				} else {
					expect(call.url).toContain(
						`/models/${ENGINES.gemini.model}:streamGenerateContent`,
					);
					expect(call.url).not.toContain("key=");
					expect(call.headers["x-goog-api-key"]).toBe(
						process.env.GEMINI_API_KEY,
					);
					expect(call.body.generationConfig).toEqual({
						temperature: CREATIVITY.balanced.temperature,
						thinkingConfig: { thinkingLevel: "low" },
					});
				}
			});

			test("records token usage for the engine", async () => {
				installFakeFetch({
					openai: () => openaiStream(PLAYLIST_TEXT),
					gemini: () => geminiStream(PLAYLIST_TEXT),
				});
				await (
					await createPlaylist(
						post("/api/edge/create-playlist", roomBody(engine)),
					)
				).text();
				// One row per call: intent read, search plan, generation, and rerank.
				expect(tokenUsageInserts.map((row) => row.engine)).toEqual([
					"gemini",
					engine,
					engine,
					otherEngine(engine),
				]);
				expect(tokenUsageInserts[2]).toMatchObject({
					userId: "user-1",
					engine,
					...(engine === "chatgpt"
						? {
								inputTokens: OPENAI_USAGE.prompt_tokens,
								outputTokens: OPENAI_USAGE.completion_tokens,
								totalTokens: OPENAI_USAGE.total_tokens,
							}
						: {
								inputTokens: GEMINI_USAGE.promptTokenCount,
								outputTokens:
									GEMINI_USAGE.candidatesTokenCount +
									GEMINI_USAGE.thoughtsTokenCount,
								totalTokens: GEMINI_USAGE.totalTokenCount,
							}),
				});
			});

			if (engine === "chatgpt") {
				test("estimates token usage when OpenAI sends no usage chunk", async () => {
					installFakeFetch({
						openai: () => openaiStream(PLAYLIST_TEXT, { withUsage: false }),
					});
					await (
						await createPlaylist(
							post("/api/edge/create-playlist", roomBody(engine)),
						)
					).text();
					const rows = tokenUsageInserts.filter(
						(row) => row.engine === "chatgpt",
					);
					expect(rows).toHaveLength(2);
					for (const row of rows) {
						expect(row.inputTokens).toBeGreaterThan(0);
						expect(row.outputTokens).toBeGreaterThan(0);
						expect(row.totalTokens).toBe(row.inputTokens + row.outputTokens);
					}
				});
			}

			test("forwards a provider error with its status", async () => {
				const failing = () => new Response("quota exceeded", { status: 429 });
				installFakeFetch({ openai: failing, gemini: failing });
				const res = await createPlaylist(
					post("/api/edge/create-playlist", playlistBody(engine)),
				);
				expect(res.status).toBe(429);
				expect(await res.text()).toBe("quota exceeded");
			});
		});
	}
});

describe("POST /api/edge/recommendations", () => {
	const body = {
		engine: "gemini",
		mood: "melancholic",
		genres: ["shoegaze"],
		selectedArtists: ["Slowdive"],
		rejectedArtists: ["Oasis"],
		expectedCount: 2,
	};
	const RECS_TEXT = '[{"artist":"Ride"},{"kind":"noise"},{"artist":"Lush"}]';

	test("streams only artist objects, incrementally", async () => {
		installFakeFetch({ gemini: () => geminiStream(RECS_TEXT) });
		const res = await recommendations(post("/api/edge/recommendations", body));
		expect(res.status).toBe(200);
		expect(await readNdjson(res)).toEqual([
			{ artist: "Ride" },
			{ artist: "Lush" },
		]);
	});

	test("puts selected and rejected artists in the prompt", async () => {
		const fake = installFakeFetch({ gemini: () => geminiStream(RECS_TEXT) });
		await (
			await recommendations(post("/api/edge/recommendations", body))
		).text();
		const call = fake.requests.find((r) => r.url.includes("googleapis"));
		const prompt = geminiPrompt(call);
		expect(prompt).toContain("Slowdive");
		expect(prompt).toContain("Oasis");
	});
});

describe("POST /api/edge/replace-song", () => {
	const body = {
		playlistName: "Late Night Drive",
		playlistDescription: "Synths for empty highways.",
		currentSongs: [{ artist: "Kavinsky", title: "Nightcall" }],
		avoidedSongs: ["The Midnight - Sunset"],
		targetSongId: "song-2",
	};

	test("returns a single enriched song using the requested engine", async () => {
		const fake = installFakeFetch({
			openai: () =>
				openaiStream('{"artist":"Com Truise","title":"Brokendate"}'),
		});
		const res = await replaceSong(
			post("/api/edge/replace-song", { ...body, engine: "chatgpt" }),
		);
		expect(res.status).toBe(200);
		const song = (await res.json()) as Record<string, unknown>;
		expect(song).toMatchObject({
			artist: "Com Truise",
			title: "Brokendate",
		});
		expect(typeof song.id).toBe("string");
		expect(typeof song.songId).toBe("string");
		expect(fake.requests.some((r) => r.url.includes("api.openai.com"))).toBe(
			true,
		);
	});

	test("scores candidates the same way as generation", async () => {
		installFakeFetch({
			openai: () => openaiStream('{"artist":"Rudman","title":"Bora"}'),
			spotify: (query) =>
				spotifyTracks([
					{ id: "vocal", name: "Bora Vocal", artist: artistOf(query) },
					{ id: "plain", name: "Bora", artist: artistOf(query) },
				]),
		});
		const res = await replaceSong(
			post("/api/edge/replace-song", { ...body, engine: "chatgpt" }),
		);
		const song = (await res.json()) as Record<string, unknown>;
		expect(song.songId).toBe("plain");
		expect(song.resolution).toEqual({
			tier: "exact",
			drift: false,
			isrc: "ISRC-plain",
		});
	});

	test("asks for the replacement with the playlist's purpose, discovery when it has none", async () => {
		for (const [purpose, expected] of [
			["room", PURPOSE.room.instruction],
			[undefined, PURPOSE.discover.instruction],
		] as const) {
			const fake = installFakeFetch({
				gemini: () =>
					geminiStream('{"artist":"Com Truise","title":"Brokendate"}'),
			});
			await replaceSong(post("/api/edge/replace-song", { ...body, purpose }));
			expect(
				geminiPrompt(
					providerCalls(fake, PROVIDER_HOST.gemini).find((c) =>
						geminiPrompt(c)?.includes("Suggest ONE new song"),
					),
				),
			).toContain(expected);
		}
	});

	test("defaults to Gemini and tells it which songs to avoid", async () => {
		const fake = installFakeFetch({
			gemini: () =>
				geminiStream('{"artist":"Com Truise","title":"Brokendate"}'),
		});
		const res = await replaceSong(post("/api/edge/replace-song", body));
		expect(res.status).toBe(200);
		const call = fake.requests.find((r) => r.url.includes("googleapis"));
		expect(call).toBeDefined();
		const prompt = geminiPrompt(call);
		expect(prompt).toContain("The Midnight - Sunset");
		expect(geminiSystem(call)).toContain("curator");
	});

	test("passes the original brief and creativity through to the curator", async () => {
		const fake = installFakeFetch({
			gemini: () =>
				geminiStream('{"artist":"Com Truise","title":"Brokendate"}'),
		});
		await replaceSong(
			post("/api/edge/replace-song", {
				...body,
				prompt: "Nocturnal synthwave for a long drive",
				creativity: "safe",
			}),
		);
		const call = fake.requests.find((r) => r.url.includes("googleapis"));
		expect(geminiPrompt(call)).toContain(
			"Nocturnal synthwave for a long drive",
		);
		expect(geminiPrompt(call)).toContain(CREATIVITY.safe.instruction);
		expect(call?.body.generationConfig).toMatchObject({
			temperature: CREATIVITY.safe.temperature,
		});
	});

	test("returns 500 when the provider output has no JSON", async () => {
		installFakeFetch({
			gemini: () => geminiStream("Sorry, I cannot help with that."),
		});
		const res = await replaceSong(post("/api/edge/replace-song", body));
		expect(res.status).toBe(500);
	});
});

describe("no-voices playlist repair", () => {
	for (const engine of ["chatgpt", "gemini"] as const) {
		test(`${engine}: repairs the resolved vocal version and checks its replacement in the same slot`, async () => {
			const generated = [
				'{"kind":"name","name":"Reading"}',
				'{"kind":"description","description":"Electronic instrumentals."}',
				'{"kind":"song","order":0,"artist":"Rone","title":"Bora","source":"candidates"}',
				'{"kind":"song","order":1,"artist":"Tycho","title":"Awake"}',
			].join("\n");
			const respond = (prompt: string) => {
				if (!prompt.startsWith('{"task":"review-vocals"')) return generated;
				const input = JSON.parse(prompt);
				expect(input.brief).toBe("Electronic music for reading. No vocals.");
				return JSON.stringify({
					restriction: "No vocals",
					tracks: input.tracks.map(
						(s: { id: string; artist: string; title: string }) => {
							if (s.artist === "Rone") {
								// The reviewer sees the curator's title, not Spotify's.
								expect(s.title).toBe("Bora");
								return {
									id: s.id,
									verdict: "vocals",
									reason: "Spoken vocal recording.",
									replacement: { artist: "Bonobo", title: "Cirrus" },
								};
							}
							return {
								id: s.id,
								verdict: "instrumental",
								reason: "Instrumental recording.",
								briefFit: "fit",
							};
						},
					),
				});
			};
			const fake = installFakeFetch({
				openai: (p) => openaiStream(respond(p)),
				gemini: (p) => geminiStream(respond(p)),
				// Rone is offered as a candidate; its substitute is still recall.
				scene: () => '{"tags":["electronic"],"area":null,"labels":[]}',
				musicbrainzSearch: () =>
					musicbrainzArtists([{ id: "mb-rone", name: "Rone" }]),
				spotify: (query) => {
					const artist = query.includes("Rone")
						? "Rone"
						: query.includes("Tycho")
							? "Tycho"
							: "Bonobo";
					return Response.json({
						tracks: {
							items: [
								{
									id: artist,
									name:
										artist === "Rone"
											? "Bora Vocal"
											: artist === "Tycho"
												? "Awake"
												: "Cirrus",
									artists: [{ name: artist }],
									album: {
										name: "Album",
										release_date: "2010-01-01",
										images: [],
									},
								},
							],
						},
					});
				},
			});
			const lines = await readNdjson(
				await createPlaylist(
					post("/api/edge/create-playlist", {
						...playlistBody(engine),
						prompt: "Electronic music for reading. No vocals.",
					}),
				),
			);
			const songs = lines.filter((l) => l.kind === "song");
			const first = songs.find((s) => s.artist === "Rone");
			const final = [...new Map(songs.map((s) => [s.id, s])).values()];
			expect(final.map((s) => s.artist)).toEqual(["Bonobo", "Tycho"]);
			expect(final[0]?.id).toBe(first?.id);
			expect(final[0]?.order).toBe(first?.order);
			expect(final[0]?.songId).toBe("Bonobo");
			expect(first?.source).toBe("candidates");
			expect(final[0]?.source).toBe("recall");
			expect(lines.filter((l) => l.kind === "vocal-review")).toHaveLength(2);
			const detector = providerCalls(fake, PROVIDER_HOST.gemini).find((call) =>
				geminiPrompt(call)?.startsWith('{"task":"review-vocals"'),
			);
			const verifier = providerCalls(fake, PROVIDER_HOST.chatgpt).find((call) =>
				openaiMessages(call)
					.at(-1)
					?.content.startsWith('{"task":"review-vocals"'),
			);
			expect(JSON.parse(geminiPrompt(detector) ?? "{}").allowReplacements).toBe(
				true,
			);
			expect(
				JSON.parse(openaiMessages(verifier).at(-1)?.content ?? "{}")
					.allowReplacements,
			).toBe(false);
		});
	}
});

test("does not introduce a duplicate credited artist through a replacement alias", async () => {
	const respond = (prompt: string) => {
		if (!prompt.startsWith('{"task":"review-vocals"')) return PLAYLIST_TEXT;
		const input = JSON.parse(prompt);
		return JSON.stringify({
			restriction: "No vocals",
			tracks: input.tracks.map((s: { id: string }, i: number) => ({
				id: s.id,
				verdict: input.allowReplacements && i === 0 ? "vocals" : "instrumental",
				reason: "Recording-specific assessment.",
				briefFit: "fit",
				...(input.allowReplacements && i === 0
					? {
							replacement: {
								artist: "The Midnight Project",
								title: "Instrumental",
							},
						}
					: {}),
			})),
		});
	};
	installFakeFetch({
		openai: (p) => openaiStream(respond(p)),
		gemini: (p) => geminiStream(respond(p)),
		spotify: (q) =>
			spotifyMatch(
				q,
				q.includes("The Midnight Project") ? "The Midnight" : undefined,
			),
	});
	const lines = await readNdjson(
		await createPlaylist(
			post("/api/edge/create-playlist", {
				...playlistBody("chatgpt"),
				prompt: "No vocals please",
			}),
		),
	);
	const final = [
		...new Map(
			lines.filter((l) => l.kind === "song").map((s) => [s.id, s]),
		).values(),
	];
	expect(final.map((s) => s.artist)).toEqual(["Kavinsky", "The Midnight"]);
});

for (const scenario of ["uncertain", "malformed", "vocals welcome"] as const) {
	test(`eval retains ${scenario} review and the original resolved snapshot`, async () => {
		const respond = (prompt: string) => {
			if (!prompt.startsWith('{"task":"review-vocals"')) return PLAYLIST_TEXT;
			const input = JSON.parse(prompt);
			if (scenario === "malformed")
				return '{"restriction":"No vocals","tracks":[]}';
			if (scenario === "vocals welcome")
				return '{"restriction":null,"tracks":[]}';
			return JSON.stringify({
				restriction: "No vocals",
				tracks: input.tracks.map((s: { id: string }) => ({
					id: s.id,
					verdict: "uncertain",
					reason: "Exact vocal content unknown.",
				})),
			});
		};
		installFakeFetch({
			openai: (p) => openaiStream(respond(p)),
			gemini: (p) => geminiStream(respond(p)),
		});
		const result = await runCase(
			{
				id: "vocal-capture",
				brief:
					scenario === "vocals welcome"
						? "Electronic music, vocals welcome"
						: "No vocals please",
				creativity: "balanced",
				purpose: "discover",
				trackCount: 2,
				trackCriteria: [],
				playlistCriteria: [],
			},
			"chatgpt",
		);
		expect(result.vocalReviews).toHaveLength(1);
		expect(result.vocalReviews[0]?.status).toBe(
			scenario === "malformed" ? "error" : "ok",
		);
		expect(result.beforeVocalRepair?.map((s) => s.artist)).toEqual([
			"Kavinsky",
			"The Midnight",
		]);
		expect(result.songs.map((s) => s.artist)).toEqual([
			"Kavinsky",
			"The Midnight",
		]);
	});
}

test("eval judge receives the curator's title, never the resolved Spotify identity", async () => {
	const fake = installFakeFetch({
		openai: () => openaiStream(PLAYLIST_TEXT),
		gemini: () => geminiStream("{}"),
		spotify: (query) =>
			spotifyTracks([
				{
					id: "sp-resolved",
					name: "Nightcall - Remaster",
					artist: artistOf(query),
				},
			]),
	});
	const result = await runCase(
		{
			id: "resolved-identity",
			brief: "Night drive",
			creativity: "balanced",
			purpose: "discover",
			trackCount: 2,
			trackCriteria: [],
			playlistCriteria: [],
		},
		"chatgpt",
	);
	await judgePlaylist(result, "gemini");
	const input = JSON.parse(
		geminiPrompt(providerCalls(fake, PROVIDER_HOST.gemini).at(-1)) ?? "{}",
	);
	expect(result.songs[0]?.songId).toBe("sp-resolved");
	expect(input.tracks[0].title).toBe("Nightcall");
	expect(JSON.stringify(input)).not.toContain("sp-resolved");
	expect(JSON.stringify(input)).not.toContain("Remaster");
});

for (const outcome of [
	"accepted",
	"unresolved",
	"lookup-error",
	"not-instrumental",
	"review-error",
] as const) {
	test(`reports why a vocal replacement was ${outcome}`, async () => {
		const respond = (prompt: string) => {
			if (!prompt.startsWith('{"task":"review-vocals"')) return PLAYLIST_TEXT;
			const input = JSON.parse(prompt);
			if (!input.allowReplacements && outcome === "review-error") return "{}";
			return JSON.stringify({
				restriction: "No vocals",
				tracks: input.tracks.map((s: { id: string }, i: number) => ({
					id: s.id,
					verdict:
						input.allowReplacements && i === 0
							? "vocals"
							: !input.allowReplacements && outcome === "not-instrumental"
								? "uncertain"
								: "instrumental",
					reason: "Specific recording assessment.",
					briefFit: "fit",
					...(input.allowReplacements && i === 0
						? { replacement: { artist: "Com Truise", title: "Propagation" } }
						: {}),
				})),
			});
		};
		installFakeFetch({
			openai: (p) => openaiStream(respond(p)),
			gemini: (p) => geminiStream(respond(p)),
			spotify: (q) =>
				q.includes("Com Truise") && outcome === "unresolved"
					? spotifyNoMatch()
					: q.includes("Com Truise") && outcome === "lookup-error"
						? spotifyError(429)
						: spotifyMatch(q),
		});
		const result = await runCase(
			{
				id: "outcomes",
				brief: "No vocals please",
				creativity: "balanced",
				purpose: "discover",
				trackCount: 2,
				trackCriteria: [],
				playlistCriteria: [],
			},
			"chatgpt",
		);
		expect(result.vocalRepairs).toHaveLength(1);
		expect(result.vocalRepairs[0]?.outcome).toBe(outcome);
		expect(result.vocalRepairs[0]?.suggestion.artist).toBe("Com Truise");
		expect(result.songs[0]?.artist).toBe(
			outcome === "accepted" ? "Com Truise" : "Kavinsky",
		);
	});
}

test("a stalled vocal review closes the playlist with its original songs", async () => {
	let pending: ReadableStreamDefaultController<Uint8Array> | undefined;
	installFakeFetch({
		openai: () => openaiStream(PLAYLIST_TEXT),
		gemini: (prompt) =>
			prompt.startsWith('{"task":"review-vocals"')
				? new Response(
						new ReadableStream<Uint8Array>({
							start(controller) {
								pending = controller;
							},
						}),
					)
				: openaiStream(PLAYLIST_TEXT),
	});
	const realTimeout = globalThis.setTimeout;
	// Accelerate only the new review deadline; the fallback catches a hang.
	globalThis.setTimeout = ((callback: () => void, delay: number) =>
		realTimeout(callback, delay === 15000 ? 1 : delay)) as typeof setTimeout;
	try {
		const reading = readNdjson(
			await createPlaylist(
				post("/api/edge/create-playlist", {
					...playlistBody("chatgpt"),
					prompt: "No vocals please",
				}),
			),
		);
		const result = await Promise.race([
			reading,
			new Promise<null>((resolve) => realTimeout(() => resolve(null), 50)),
		]);
		expect(result).not.toBeNull();
		expect(
			result?.find((line) => line.kind === "vocal-review")?.error,
		).toContain("timed out");
		expect(result?.filter((line) => line.kind === "song").at(-1)?.artist).toBe(
			"The Midnight",
		);
	} finally {
		globalThis.setTimeout = realTimeout;
		pending?.close();
	}
});

test("rejects an instrumental substitute that breaks the rest of the brief", async () => {
	const respond = (prompt: string) => {
		if (!prompt.startsWith('{"task":"review-vocals"')) return PLAYLIST_TEXT;
		const input = JSON.parse(prompt);
		return JSON.stringify({
			restriction: "No vocals",
			tracks: input.tracks.map((s: { id: string }, i: number) => ({
				id: s.id,
				verdict: input.allowReplacements && i === 0 ? "vocals" : "instrumental",
				briefFit: input.allowReplacements ? "fit" : "mismatch",
				reason: input.allowReplacements
					? "Vocal recording."
					: "Solo acoustic piano breaks the electronic-only brief.",
				...(input.allowReplacements && i === 0
					? { replacement: { artist: "Goldmund", title: "Threnody" } }
					: {}),
			})),
		});
	};
	installFakeFetch({
		openai: (p) => openaiStream(respond(p)),
		gemini: (p) => geminiStream(respond(p)),
	});
	const lines = await readNdjson(
		await createPlaylist(
			post("/api/edge/create-playlist", {
				...playlistBody("chatgpt"),
				prompt: "Electronic music only. No vocals.",
			}),
		),
	);
	const final = [
		...new Map(
			lines.filter((l) => l.kind === "song").map((s) => [s.id, s]),
		).values(),
	];
	expect(final.map((s) => s.artist)).toEqual(["Kavinsky", "The Midnight"]);
});
