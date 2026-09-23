import { env } from "~/env.mjs";
import type { Evidence, EvidenceSource, SourceStatus } from "~/lib/evidence";
import { releaseYear } from "~/lib/resolution";
import { hasLastfmKey, type LastfmTrack, trackInfo } from "../lastfm";
import { musicbrainz, USER_AGENT } from "../musicbrainz";

/** What the sources are asked about: the resolved recording, not the pick. */
export interface RecordingRef {
	isrc: string | null;
	title: string;
	artist: string;
	album: string | null;
	durationMs: number | null;
}

// Each source answers within this deadline or counts as unknown, so a slow
// source can only delay the repair stage, never block the playlist.
const DEADLINE_MS = Number(env.EVIDENCE_DEADLINE_MS);
// Facts about a recording do not change; cache them across playlists.
const REVALIDATE_SECONDS = 60 * 60 * 24 * 30;

type Answer<T> =
	| { status: "ok"; value: T }
	| { status: Exclude<SourceStatus, "ok"> };

const unknown = { status: "unknown" } as const;

const request = (url: string, signal: AbortSignal, init: RequestInit = {}) =>
	fetch(url, {
		...init,
		signal,
		headers: {
			Accept: "application/json",
			"User-Agent": USER_AGENT,
			...init.headers,
		},
		next: { revalidate: REVALIDATE_SECONDS },
	} as RequestInit);

async function withDeadline<T>(
	lookup: (signal: AbortSignal) => Promise<Answer<T>>,
): Promise<Answer<T>> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), DEADLINE_MS);
	try {
		return await Promise.race([
			lookup(controller.signal),
			new Promise<Answer<T>>((resolve) =>
				controller.signal.addEventListener("abort", () =>
					resolve({ status: "timeout" }),
				),
			),
		]);
	} catch {
		return { status: controller.signal.aborted ? "timeout" : "error" };
	} finally {
		clearTimeout(timer);
	}
}

interface MusicBrainzRecording {
	id: string;
	"first-release-date"?: string;
	"artist-credit"?: {
		name?: string;
		artist?: { name?: string; country?: string | null };
	}[];
}

const musicbrainzLookup = (ref: RecordingRef) =>
	musicbrainz.run(() =>
		withDeadline<{
			mbid: string;
			firstReleaseYear: number | null;
			country: string | null;
			credits: string[];
		}>(async (signal) => {
			if (!ref.isrc) return unknown;
			const res = await request(
				`https://musicbrainz.org/ws/2/isrc/${encodeURIComponent(ref.isrc)}?inc=artist-credits+releases&fmt=json`,
				signal,
			);
			if (res.status === 404) return unknown;
			if (!res.ok) return { status: "error" };
			const body = (await res.json()) as {
				recordings?: MusicBrainzRecording[];
			};
			const recordings = body.recordings ?? [];
			const first = recordings[0];
			if (!first) return unknown;
			// Several recordings can share an ISRC; the earliest is the original.
			const years = recordings.flatMap((recording) => {
				const year = releaseYear(recording["first-release-date"] ?? "");
				return year === null ? [] : [year];
			});
			return {
				status: "ok",
				value: {
					mbid: first.id,
					firstReleaseYear: years.length ? Math.min(...years) : null,
					country: first["artist-credit"]?.[0]?.artist?.country ?? null,
					credits: (first["artist-credit"] ?? []).flatMap(
						(credit) => credit.artist?.name ?? credit.name ?? [],
					),
				},
			};
		}),
	);

const lrclibLookup = (ref: RecordingRef) =>
	withDeadline<boolean>(async (signal) => {
		const params = new URLSearchParams({
			artist_name: ref.artist,
			track_name: ref.title,
		});
		if (ref.durationMs)
			params.set("duration", `${Math.round(ref.durationMs / 1000)}`);
		// The album title narrows the match but Spotify's "(Deluxe)" style
		// suffixes often miss; the duration alone still guards the retry.
		let res: Response | null = null;
		for (const album of ref.album ? [ref.album, null] : [null]) {
			if (album) params.set("album_name", album);
			else params.delete("album_name");
			res = await request(`https://lrclib.net/api/get?${params}`, signal);
			if (res.status !== 404) break;
		}
		if (!res || res.status === 404) return unknown;
		if (!res.ok) return { status: "error" };
		const body = (await res.json()) as {
			instrumental?: boolean;
			plainLyrics?: string | null;
		};
		if (body.instrumental) return { status: "ok", value: true };
		if (body.plainLyrics?.trim()) return { status: "ok", value: false };
		return unknown;
	});

const deezerLookup = (ref: RecordingRef) =>
	withDeadline<{
		bpm: number | null;
		gain: number | null;
		version: string | null;
	}>(async (signal) => {
		if (!ref.isrc) return unknown;
		const res = await request(
			`https://api.deezer.com/track/isrc:${encodeURIComponent(ref.isrc)}`,
			signal,
		);
		if (!res.ok) return { status: "error" };
		const body = (await res.json()) as {
			error?: unknown;
			bpm?: number;
			gain?: number;
			title_version?: string;
		};
		if (body.error) return unknown;
		return {
			status: "ok",
			value: {
				bpm: body.bpm || null,
				gain: typeof body.gain === "number" ? body.gain : null,
				version: body.title_version?.trim() || null,
			},
		};
	});

const lastfmLookup = (ref: RecordingRef) =>
	withDeadline<LastfmTrack>(async (signal) => {
		if (!hasLastfmKey()) return { status: "off" };
		const track = await trackInfo(ref.artist, ref.title, { signal });
		return track ? { status: "ok", value: track } : unknown;
	});

const listenbrainzLookup = (mbid: string) =>
	withDeadline<number>(async (signal) => {
		const res = await request(
			"https://api.listenbrainz.org/1/popularity/recording",
			signal,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ recording_mbids: [mbid] }),
			},
		);
		if (!res.ok) return res.status === 404 ? unknown : { status: "error" };
		const body = (await res.json()) as { total_user_count?: number | null }[];
		const listeners = body[0]?.total_user_count;
		return typeof listeners === "number"
			? { status: "ok", value: listeners }
			: unknown;
	});

const factFrom = <T, V, S extends EvidenceSource>(
	answer: Answer<T>,
	source: S,
	pick: (value: T) => V | null,
): { value: V; source: S } | null => {
	if (answer.status !== "ok") return null;
	const value = pick(answer.value);
	return value === null ? null : { value, source };
};

/** Every source asked concurrently; unknown is a valid answer from each. */
export async function gatherEvidence(ref: RecordingRef): Promise<Evidence> {
	const [mb, lyrics, deezer, lastfm] = await Promise.all([
		musicbrainzLookup(ref),
		lrclibLookup(ref),
		deezerLookup(ref),
		lastfmLookup(ref),
	]);
	const listeners =
		mb.status === "ok" ? await listenbrainzLookup(mb.value.mbid) : unknown;
	return {
		firstReleaseYear: factFrom(mb, "musicbrainz", (v) => v.firstReleaseYear),
		artistCountry: factFrom(mb, "musicbrainz", (v) => v.country),
		credits: factFrom(mb, "musicbrainz", (v) =>
			v.credits.length ? v.credits : null,
		),
		instrumental: factFrom(lyrics, "lrclib", (v) => v),
		tempo: factFrom(deezer, "deezer", (v) => v.bpm),
		gain: factFrom(deezer, "deezer", (v) => v.gain),
		version: factFrom(deezer, "deezer", (v) => v.version),
		tags: factFrom(lastfm, "lastfm", (v) => (v.tags.length ? v.tags : null)),
		// Last.fm counts a large general audience across a song's versions, and
		// counted all but one of 209 eval picks where ListenBrainz, per
		// MusicBrainz recording and leaning indie, missed 63% (#51).
		listeners:
			factFrom(lastfm, "lastfm", (v) => v.listeners) ??
			factFrom(listeners, "listenbrainz", (v) => v),
		sources: {
			musicbrainz: mb.status,
			lrclib: lyrics.status,
			deezer: deezer.status,
			lastfm: lastfm.status,
			listenbrainz: listeners.status,
		},
	};
}
