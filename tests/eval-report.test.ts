import { expect, test } from "bun:test";
import {
	type CaseRecord,
	renderReport,
	summaryRow,
	TABLE_HEADER,
} from "../evals/report";
import type { RunResult } from "../evals/runner";

const song = (order: number, tier: string, songId: string | null) => ({
	id: `slot-${order}`,
	order,
	artist: `Artist ${order}`,
	title: `Title ${order}`,
	songId,
	resolution: { tier, drift: false, isrc: songId && `ISRC-${songId}` },
	origin: "pick",
});

/** A run result as an eval saved it before attempts were recorded. */
const SAVED = {
	intent: null,
	vocalReviews: [],
	vocalRepairs: [],
	repairs: [],
	candidateUse: 0,
	case: {
		id: "saved",
		brief: "Nocturnal synthwave for a long drive",
		creativity: "balanced",
		purpose: "discover",
		trackCount: 5,
		trackCriteria: [],
		playlistCriteria: [],
	},
	brief: "Nocturnal synthwave for a long drive",
	engine: "gemini",
	generation: {
		model: "gemini-test",
		creativity: "balanced",
		purpose: "discover",
		temperature: 1,
		systemPrompt: "",
		userPrompt: "",
	},
	name: "Late Night Drive",
	description: "Synths for empty highways.",
	firstSongMs: 1200,
	totalMs: 9000,
	tracks: 5,
	uniqueArtists: 5,
	onSpotify: 4,
	resolution: { exact: 2, normalized: 1, fuzzy: 1, unresolved: 1 },
	drift: 0,
	replaced: 0,
	poolFills: 0,
	known: 0,
	knownArtist: 0,
	emissions: [],
	songs: [
		song(1, "exact", "a"),
		song(2, "exact", "b"),
		song(3, "normalized", "c"),
		song(4, "fuzzy", "d"),
		song(5, "unresolved", null),
	],
} as unknown as RunResult;

const record = (result: RunResult): CaseRecord => ({
	caseId: "saved",
	engine: "gemini",
	result,
	failures: [],
	overlap: "n/a",
});

const columns = (row: string) => {
	const header = (TABLE_HEADER.split("\n")[0] ?? "").split(" | ");
	const cells = row.split(" | ");
	expect(cells).toHaveLength(header.length);
	return (name: string) => {
		expect(header).toContain(name);
		return cells[header.indexOf(name)];
	};
};

test("the report shows exact or normalized resolutions apart from fuzzy ones, beside on Spotify", () => {
	const header = (TABLE_HEADER.split("\n")[0] ?? "").split(" | ");
	const onSpotify = header.indexOf("on Spotify");
	expect(header.slice(onSpotify, onSpotify + 3)).toEqual([
		"on Spotify",
		"exact or normalized",
		"fuzzy",
	]);
	const cell = columns(summaryRow(record(SAVED)));
	expect(cell("on Spotify")).toBe("4/5");
	expect(cell("exact or normalized")).toBe("3/5");
	expect(cell("fuzzy")).toBe("1/5");
});

test("an older result without attempts still renders, its first-try columns n/a", () => {
	const cell = columns(summaryRow(record(SAVED)));
	expect(cell("first try")).toBe("n/a");
	expect(cell("first / retry / replacement")).toBe("n/a");
	const report = renderReport({
		schemaVersion: 2,
		startedAt: "2026-09-13T00:00:00.000Z",
		source: { revision: "abc123", dirty: false },
		selectedCases: ["saved"],
		selectedEngines: ["gemini"],
		judgeEngine: "gemini",
		complete: true,
		records: [record(SAVED)],
	});
	expect(report).toContain("| Artist 4 — Title 4 |");
});

test("an older listener summary without Deezer still renders, its Deezer median n/a", () => {
	const cell = columns(
		summaryRow(
			record({
				...SAVED,
				popularity: {
					recordings: 5,
					median: { lastfm: 90000, listenbrainz: null },
					mainstream: 1,
					unknown: 0,
				},
			} as unknown as RunResult),
		),
	);
	expect(cell("median listeners (Last.fm / LB / Deezer)")).toBe(
		"90K / n/a / n/a",
	);
});

const withEvidence = (
	order: number,
	artist: string,
	country: string | null,
	year: number | null,
) => ({
	...song(order, "exact", `s${order}`),
	artist,
	evidence: {
		firstReleaseYear:
			year === null ? null : { value: year, source: "musicbrainz" },
		artistCountry:
			country === null ? null : { value: country, source: "musicbrainz" },
	},
});

/** A saved result whose songs carry evidence and whose summary counts Deezer. */
const COVERED = {
	...SAVED,
	songs: [
		withEvidence(1, "IAM", "FR", 1997),
		withEvidence(2, "NTM", "FR", 1995),
		withEvidence(3, "Stromae", "BE", 2013),
		withEvidence(4, "PNL", "FR", 2016),
		withEvidence(5, "Damso", null, null),
	],
	popularity: {
		recordings: 5,
		median: { lastfm: 300000, listenbrainz: null, deezer: 600000 },
		counted: { lastfm: 3, listenbrainz: 0, deezer: 1 },
		mainstream: 2,
		unknown: 1,
	},
} as unknown as RunResult;

test("the report shows artist country share, release-year spread, long tail and Deezer-counted recordings per case", () => {
	const cell = columns(summaryRow(record(COVERED)));
	expect(cell("artist country")).toBe("FR 3 · BE 1 · unknown 1");
	expect(cell("first release years")).toBe("1995–2016 (median 2005)");
	expect(cell("long tail")).toBe("3/5");
	expect(cell("Deezer counted")).toBe("1/5");
	expect(cell("unknown listeners")).toBe("1/5");
});

test("an older result without evidence or per-source counts renders its coverage columns n/a", () => {
	const cell = columns(
		summaryRow(
			record({
				...SAVED,
				popularity: {
					recordings: 5,
					median: { lastfm: 90000, listenbrainz: null },
					mainstream: 1,
					unknown: 0,
				},
			} as unknown as RunResult),
		),
	);
	expect(cell("artist country")).toBe("n/a");
	expect(cell("first release years")).toBe("n/a");
	expect(cell("long tail")).toBe("4/5");
	expect(cell("Deezer counted")).toBe("n/a");
	const bare = columns(summaryRow(record(SAVED)));
	expect(bare("long tail")).toBe("n/a");
});

test("the report shows distinct artists across all cases in the run", () => {
	const report = renderReport({
		schemaVersion: 2,
		startedAt: "2026-09-13T00:00:00.000Z",
		source: { revision: "abc123", dirty: false },
		selectedCases: ["saved", "covered"],
		selectedEngines: ["gemini", "chatgpt"],
		judgeEngine: "gemini",
		complete: true,
		records: [
			record(SAVED),
			record(COVERED),
			{
				...record({ ...COVERED, engine: "chatgpt" } as RunResult),
				engine: "chatgpt",
			},
			{
				caseId: "failed",
				engine: "chatgpt",
				failures: ["HTTP 500"],
				overlap: "n/a",
			},
		],
	});
	expect(report).toContain(
		"Distinct artists across all cases: 10 (gemini 10, chatgpt 5).",
	);
});
