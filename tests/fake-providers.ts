// Fakes for the three upstream services, applied at the global fetch boundary.
// Each fake answers in the provider's real wire format so the routes' stream
// parsing is exercised end to end.

export interface RecordedRequest {
	url: string;
	headers: Record<string, string>;
	body: Record<string, unknown>;
}

export interface FakeProviders {
	/** Every provider call except brief reads and scene plans, which land in their own lists. */
	requests: RecordedRequest[];
	/** The intent reads the route made before generating, one per request. */
	intentReads: RecordedRequest[];
	/** The scene plans the route asked the curator for, on either engine. */
	scenePlans: RecordedRequest[];
	openai: (prompt: string) => Response;
	gemini: (prompt: string) => Response;
	/** Receives the brief; by default the read fails and the intent is null. */
	intent: (brief: string) => Response;
	/**
	 * Receives the brief and returns the scene plan text, streamed in the
	 * engine's wire format; by default the plan names no tags or labels.
	 */
	scene: (brief: string) => string;
	/** Receives the decoded search query, e.g. `artist:X track:Y` or `X Y`. */
	spotify: (query: string) => Response | Promise<Response>;
	/** Saved tracks, GET /v1/me/tracks, by page offset. */
	library: (offset: number) => Response | Promise<Response>;
	/** Top tracks, GET /v1/me/top/tracks, by time range. */
	topTracks: (range: string) => Response;
	/** Recently played, GET /v1/me/player/recently-played. */
	recent: () => Response;
	/** Evidence providers receive their lookup key; by default every record is unknown. */
	musicbrainz: (isrc: string) => Response | Promise<Response>;
	/** MusicBrainz artist and release searches; by default they find nothing. */
	musicbrainzSearch: (
		entity: "artist" | "release",
		query: string,
	) => Response | Promise<Response>;
	lrclib: (params: URLSearchParams) => Response | Promise<Response>;
	deezer: (isrc: string) => Response | Promise<Response>;
	lastfm: (params: URLSearchParams) => Response | Promise<Response>;
	listenbrainz: (mbids: string[]) => Response | Promise<Response>;
}

const JSON_HEADERS = { "Content-Type": "application/json" };
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export const notFound = () => json({ error: "not found" }, 404);

/** A MusicBrainz artist search result, in the ws/2 JSON shape. */
export function musicbrainzArtists(
	artists: { id: string; name: string; area?: string; tags?: string[] }[],
) {
	return json({
		artists: artists.map((artist) => ({
			id: artist.id,
			name: artist.name,
			area: artist.area ? { name: artist.area } : null,
			tags: (artist.tags ?? []).map((name, i) => ({ name, count: 10 - i })),
		})),
	});
}

/** A MusicBrainz release search result: each release credits the given artists. */
export function musicbrainzReleases(credits: { id: string; name: string }[][]) {
	return json({
		releases: credits.map((artists) => ({
			"artist-credit": artists.map((artist) => ({ artist })),
		})),
	});
}

/** A MusicBrainz ISRC lookup with one recording, in the ws/2 JSON shape. */
export function musicbrainzRecording({
	mbid = "mb-1",
	firstReleaseDate = "2010-01-01",
	country = "FR",
	credits = ["Artist"],
}: {
	mbid?: string;
	firstReleaseDate?: string;
	country?: string;
	credits?: string[];
} = {}) {
	return json({
		recordings: [
			{
				id: mbid,
				title: "Recording",
				"first-release-date": firstReleaseDate,
				"artist-credit": credits.map((name, i) => ({
					name,
					artist: { id: `artist-${i + 1}`, name, country },
				})),
			},
		],
	});
}

/** An LRCLIB record; lyrics text means the recording is sung. */
export function lrclibRecord({
	instrumental = false,
	plainLyrics = "",
}: {
	instrumental?: boolean;
	plainLyrics?: string;
} = {}) {
	return json({
		id: 1,
		instrumental,
		plainLyrics: instrumental ? null : plainLyrics || null,
		syncedLyrics: null,
		duration: 240,
	});
}

export function deezerTrack({
	bpm = 120,
	gain = -7.5,
	titleVersion = "",
}: {
	bpm?: number;
	gain?: number;
	titleVersion?: string;
} = {}) {
	return json({ id: 1, bpm, gain, title_version: titleVersion });
}

/** A Last.fm track.getInfo answer; Last.fm sends counts as strings. */
export function lastfmTrack({
	tags = [],
	listeners,
}: {
	tags?: string[];
	listeners?: number;
}) {
	return json({
		track: {
			...(listeners === undefined ? {} : { listeners: `${listeners}` }),
			toptags: { tag: tags.map((name) => ({ name })) },
		},
	});
}

/**
 * A Last.fm API answering by method: listeners by artist for track.getInfo
 * and artist.getTopTracks, and chart tracks by tag. Anything it does not
 * know is "not found".
 */
export function lastfmApi({
	listeners = {},
	charts = {},
}: {
	listeners?: Record<string, number>;
	charts?: Record<string, [string, string][]>;
}) {
	const notFound = () => json({ error: 6, message: "Not found" });
	return (params: URLSearchParams): Response => {
		const artist = params.get("artist") ?? "";
		const count = listeners[artist];
		switch (params.get("method")) {
			case "track.getinfo":
				return count === undefined
					? notFound()
					: json({ track: { listeners: `${count}` } });
			case "artist.gettoptracks":
				return count === undefined
					? notFound()
					: json({ toptracks: { track: [{ listeners: `${count}` }] } });
			case "tag.gettoptracks": {
				const limit = Number(params.get("limit") ?? "50");
				const tracks = charts[params.get("tag") ?? ""] ?? [];
				return json({
					tracks: {
						track: tracks
							.slice(0, limit)
							.map(([name, title]) => ({ name: title, artist: { name } })),
					},
				});
			}
			default:
				return notFound();
		}
	};
}

export function listenbrainzPopularity(mbid: string, listeners: number) {
	return json([
		{
			recording_mbid: mbid,
			total_listen_count: listeners * 10,
			total_user_count: listeners,
		},
	]);
}

const encoder = new TextEncoder();

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			controller.close();
		},
	});
}

export const OPENAI_USAGE = {
	prompt_tokens: 120,
	completion_tokens: 45,
	total_tokens: 165,
};

/**
 * OpenAI Chat Completions SSE stream, one token-ish delta per event, followed
 * by the usage-only chunk that stream_options.include_usage produces.
 */
export function openaiStream(
	text: string,
	{ chunkSize = 7, withUsage = true } = {},
): Response {
	const events: string[] = [];
	for (let i = 0; i < text.length; i += chunkSize) {
		const delta = text.slice(i, i + chunkSize);
		events.push(
			`data: ${JSON.stringify({
				id: "chatcmpl-1",
				object: "chat.completion.chunk",
				created: 0,
				model: "fake",
				system_fingerprint: null,
				choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
			})}\n\n`,
		);
	}
	if (withUsage) {
		events.push(
			`data: ${JSON.stringify({
				id: "chatcmpl-1",
				object: "chat.completion.chunk",
				created: 0,
				model: "fake",
				choices: [],
				usage: OPENAI_USAGE,
			})}\n\n`,
		);
	}
	events.push("data: [DONE]\n\n");
	return new Response(streamOf(events), {
		status: 200,
		headers: { "Content-Type": "text/event-stream" },
	});
}

export const GEMINI_USAGE = {
	promptTokenCount: 12,
	candidatesTokenCount: 34,
	thoughtsTokenCount: 5,
	totalTokenCount: 51,
};

/**
 * Gemini streamGenerateContent: a JSON array of candidate chunks. Like the
 * real stream, an early chunk already carries the usage counted so far.
 */
export function geminiStream(text: string, chunkSize = 11): Response {
	const parts: string[] = [];
	for (let i = 0; i < text.length; i += chunkSize) {
		parts.push(
			JSON.stringify({
				candidates: [
					{ content: { parts: [{ text: text.slice(i, i + chunkSize) }] } },
				],
				...(i === 0
					? {
							usageMetadata: {
								promptTokenCount: GEMINI_USAGE.promptTokenCount,
								candidatesTokenCount: 1,
								totalTokenCount: GEMINI_USAGE.promptTokenCount + 1,
							},
						}
					: {}),
			}),
		);
	}
	parts.push(
		JSON.stringify({
			candidates: [
				{ content: { parts: [{ text: "" }] }, finishReason: "STOP" },
			],
			usageMetadata: GEMINI_USAGE,
		}),
	);
	const raw = ["[", parts.join(","), "]"].map((s) => s);
	return new Response(streamOf(raw), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

export function spotifyNoMatch(): Response {
	return Response.json({ tracks: { items: [] } });
}

/** The artist the app asked for, from either query form the app sends. */
export function artistOf(query: string): string {
	const fielded = /^artist:(.*) track:/.exec(query);
	return fielded?.[1] ?? query.split(" ").slice(0, -1).join(" ");
}

/** The title the app asked for; plain-text queries end with a one-word title. */
export function titleOf(query: string): string {
	const fielded = /^artist:.* track:(.*)$/.exec(query);
	return fielded?.[1] ?? query.split(" ").at(-1) ?? "";
}

export interface FakeTrack {
	id: string;
	name: string;
	artist: string;
	/** Further credited artists after `artist`. */
	featuring?: string[];
	releaseDate?: string;
	isrc?: string | null;
	albumId?: string;
}

/** Several candidates for one query, in the subset of Spotify's shape the app reads. */
export function spotifyTracks(items: FakeTrack[]): Response {
	return Response.json({
		tracks: {
			items: items.map((item) => ({
				id: item.id,
				name: item.name,
				preview_url: null,
				artists: [item.artist, ...(item.featuring ?? [])].map((name) => ({
					name,
				})),
				external_ids:
					item.isrc === null ? {} : { isrc: item.isrc ?? `ISRC-${item.id}` },
				album: {
					id: item.albumId ?? `album-${item.id}`,
					name: "Album",
					release_date: item.releaseDate ?? "1999-01-01",
					images: [{ url: "https://i.scdn.co/image/x" }],
				},
			})),
		},
	});
}

/** A single track by `artist`, in the subset of Spotify's shape the app reads. */
export function spotifyMatch(
	query: string,
	artist: string = artistOf(query),
): Response {
	const id = `sp-${query.replace(/\W+/g, "-").toLowerCase()}`;
	return spotifyTracks([{ id, name: titleOf(query), artist }]);
}

/** Resolves only plain-text queries, simulating a fielded-search miss. */
export function spotifyMatchPlainOnly(query: string): Response {
	return query.startsWith("artist:") ? spotifyNoMatch() : spotifyMatch(query);
}

/** A track the listener already has, in the fields the known set reads. */
export interface KnownTrack {
	id: string;
	artist: string;
	isrc?: string;
}
const knownTrack = ({ id, artist, isrc }: KnownTrack) => ({
	id,
	artists: [{ name: artist }],
	external_ids: isrc ? { isrc } : {},
});

/** One page of saved tracks; `total` is the whole library's size. */
export function savedTracks(tracks: KnownTrack[], total = tracks.length) {
	return Response.json({
		items: tracks.map((track) => ({ track: knownTrack(track) })),
		total,
	});
}

export function topTracks(tracks: KnownTrack[]): Response {
	return Response.json({ items: tracks.map(knownTrack) });
}

export function recentlyPlayed(tracks: KnownTrack[]): Response {
	return Response.json({
		items: tracks.map((track) => ({ track: knownTrack(track) })),
	});
}

/** A failed Spotify call; a rate limit lifts at once so retries cost no time. */
export function spotifyError(status = 429): Response {
	return new Response("rate limited", {
		status,
		headers: status === 429 ? { "Retry-After": "0" } : {},
	});
}

/** A call that never answers, so only the caller's deadline ends it. */
export const hangs = (): Promise<Response> => new Promise(() => {});

const PLAN_TASK = '{"task":"plan-scene"';
export const EMPTY_SCENE = '{"tags":[],"area":null,"labels":[]}';

export function installFakeFetch(
	overrides: Partial<
		Omit<FakeProviders, "requests" | "intentReads" | "scenePlans">
	> = {},
): FakeProviders {
	const fake: FakeProviders = {
		requests: [],
		intentReads: [],
		scenePlans: [],
		openai: overrides.openai ?? (() => openaiStream("")),
		gemini: overrides.gemini ?? (() => geminiStream("")),
		intent: overrides.intent ?? (() => geminiStream("")),
		scene: overrides.scene ?? (() => EMPTY_SCENE),
		spotify: overrides.spotify ?? spotifyMatch,
		library: overrides.library ?? (() => savedTracks([])),
		topTracks: overrides.topTracks ?? (() => topTracks([])),
		recent: overrides.recent ?? (() => recentlyPlayed([])),
		musicbrainz: overrides.musicbrainz ?? notFound,
		musicbrainzSearch:
			overrides.musicbrainzSearch ??
			((entity) =>
				json(entity === "artist" ? { artists: [] } : { releases: [] })),
		lrclib: overrides.lrclib ?? notFound,
		deezer: overrides.deezer ?? notFound,
		lastfm: overrides.lastfm ?? notFound,
		listenbrainz: overrides.listenbrainz ?? notFound,
	};

	const respond = async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.toString();
		const headers = Object.fromEntries(new Headers(init?.headers).entries());
		const body = init?.body
			? (JSON.parse(String(init.body)) as Record<string, unknown>)
			: {};
		const host = new URL(url).hostname;
		if (host === "generativelanguage.googleapis.com") {
			const contents = body.contents as { parts: { text: string }[] }[];
			const prompt = contents[0]?.parts[0]?.text ?? "";
			if (prompt.startsWith('{"task":"read-brief"')) {
				fake.intentReads.push({ url, headers, body });
				return fake.intent(JSON.parse(prompt).brief as string);
			}
			if (prompt.startsWith(PLAN_TASK)) {
				fake.scenePlans.push({ url, headers, body });
				return geminiStream(fake.scene(JSON.parse(prompt).brief as string));
			}
			fake.requests.push({ url, headers, body });
			return fake.gemini(prompt);
		}
		if (host === "api.openai.com") {
			const messages = body.messages as { role: string; content: string }[];
			const prompt = messages.at(-1)?.content ?? "";
			if (prompt.startsWith(PLAN_TASK)) {
				fake.scenePlans.push({ url, headers, body });
				return openaiStream(fake.scene(JSON.parse(prompt).brief as string));
			}
			fake.requests.push({ url, headers, body });
			return fake.openai(prompt);
		}
		fake.requests.push({ url, headers, body });
		if (host === "api.spotify.com") {
			const { pathname, searchParams } = new URL(url);
			if (pathname === "/v1/me/tracks")
				return fake.library(Number(searchParams.get("offset") ?? 0));
			if (pathname === "/v1/me/top/tracks")
				return fake.topTracks(searchParams.get("time_range") ?? "");
			if (pathname === "/v1/me/player/recently-played") return fake.recent();
			return fake.spotify(searchParams.get("q") ?? "");
		}
		const { pathname, searchParams } = new URL(url);
		if (host === "musicbrainz.org") {
			const entity = pathname.split("/ws/2/")[1];
			if (entity === "artist" || entity === "release")
				return fake.musicbrainzSearch(entity, searchParams.get("query") ?? "");
			return fake.musicbrainz(pathname.split("/ws/2/isrc/")[1] ?? "");
		}
		if (host === "lrclib.net") return fake.lrclib(searchParams);
		if (host === "api.deezer.com")
			return fake.deezer(pathname.split("/track/isrc:")[1] ?? "");
		if (host === "ws.audioscrobbler.com") return fake.lastfm(searchParams);
		if (host === "api.listenbrainz.org")
			return fake.listenbrainz((body.recording_mbids as string[]) ?? []);
		throw new Error(`Unexpected fetch in test: ${url}`);
	};
	// Like real fetch, an aborted call rejects with the signal's reason.
	globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		const signal = init?.signal;
		if (!signal) return respond(input, init);
		return Promise.race([
			respond(input, init),
			new Promise<never>((_, reject) => {
				if (signal.aborted) reject(signal.reason);
				signal.addEventListener("abort", () => reject(signal.reason), {
					once: true,
				});
			}),
		]);
	}) as typeof fetch;

	return fake;
}

export async function readNdjson(
	response: Response,
): Promise<Record<string, unknown>[]> {
	const text = await response.text();
	return text
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

export function post(path: string, body: unknown): Request {
	return new Request(`http://localhost${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}
