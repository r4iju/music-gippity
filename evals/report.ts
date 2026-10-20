import {
	type BudgetEvent,
	CANDIDATE_SOURCES,
	type CandidatesEvent,
	type PopularityEvent,
} from "~/lib/playlist-stream";
import { median, type PopularitySummary } from "~/lib/popularity";
import { DEFAULT_PURPOSE, type Purpose } from "~/lib/purpose";
import type { Judgment } from "./judge";
import type { RunResult } from "./runner";

export interface CaseRecord {
	caseId: string;
	engine: string;
	result?: RunResult;
	judgment?: Judgment;
	failures: string[];
	overlap: string;
}

export interface EvalRun {
	schemaVersion: 2;
	startedAt: string;
	source: { revision: string; dirty: boolean };
	selectedCases: string[];
	selectedEngines: string[];
	judgeEngine: string;
	complete: boolean;
	records: CaseRecord[];
}

interface PreviousResult {
	brief: string;
	engine: string;
	tracks: number;
	// Runs recorded before purpose existed were all built for discovery.
	generation?: Omit<RunResult["generation"], "purpose"> & {
		purpose?: Purpose;
	};
	songs: { artist: string; title: string }[];
}

export function overlap(
	result: RunResult,
	previous: { file: string; result: PreviousResult }[],
): string {
	const prior = previous.find(
		({ result: item }) =>
			item.brief === result.brief &&
			item.engine === result.engine &&
			item.tracks === result.case.trackCount &&
			(item.generation
				? item.generation.creativity === result.generation.creativity &&
					(item.generation.purpose ?? DEFAULT_PURPOSE) ===
						result.generation.purpose &&
					item.generation.model === result.generation.model
				: result.generation.creativity === "balanced"),
	);
	if (!prior) return "n/a";
	const key = (song: { artist: string; title: string }) =>
		`${song.artist} - ${song.title}`.normalize("NFKC").toLowerCase();
	const previousSongs = new Set(prior.result.songs.map(key));
	const shared = result.songs.filter((song) =>
		previousSongs.has(key(song)),
	).length;
	return `${shared}/${result.tracks} (${prior.file}${prior.result.generation ? "" : "; legacy model/config unverified"})`;
}

export function historicalResults(value: unknown): PreviousResult[] {
	const candidates = Array.isArray(value)
		? value
		: (value as EvalRun | null)?.schemaVersion === 2
			? (value as EvalRun).records.map((record) => record.result)
			: [];
	return candidates.filter(
		(item): item is PreviousResult =>
			!!item &&
			typeof item.brief === "string" &&
			typeof item.engine === "string" &&
			typeof item.tracks === "number" &&
			Array.isArray(item.songs),
	);
}

const cell = (value: unknown) =>
	String(value)
		.replace(/\|/g, "\\|")
		.replace(/[\r\n]+/g, " ")
		.replace(/</g, "&lt;");
const seconds = (ms: number | null | undefined) =>
	ms == null ? "n/a" : `${(ms / 1000).toFixed(1)}s`;

const compact = new Intl.NumberFormat("en", {
	notation: "compact",
	maximumFractionDigits: 1,
});
const count = (value: number | null) =>
	value === null ? "n/a" : compact.format(value);

const popularityCells = (p: PopularitySummary) => [
	// Older results have no Deezer median.
	`${count(p.median.lastfm)} / ${count(p.median.listenbrainz)} / ${count(p.median.deezer ?? null)}`,
	`${p.mainstream}/${p.recordings}`,
	`${p.unknown}/${p.recordings}`,
	// Older results have no per-source counts.
	p.counted ? `${p.counted.deezer ?? 0}/${p.recordings}` : "n/a",
	`${p.recordings - p.mainstream}/${p.recordings}`,
];

const budgetCell = (event: BudgetEvent | undefined) => {
	if (!event) return "n/a";
	if (event.status !== "held" && event.status !== "breached")
		return event.status;
	return `${event.status}${event.swapped.length ? `, ${event.swapped.length} swapped` : ""}`;
};

/** "held ≤3", "breached ≥5, 2 swapped", or "uncapped". */
const popularityBudgetCell = (event: PopularityEvent | undefined) => {
	if (!event) return "n/a";
	if (event.status === "uncapped") return event.status;
	const { maxMainstream, minMainstream } = event.budget;
	const limit = [
		maxMainstream === null ? "" : `≤${maxMainstream}`,
		minMainstream === null ? "" : `≥${minMainstream}`,
	]
		.filter(Boolean)
		.join(" ");
	return `${event.status} ${limit}${event.swapped.length ? `, ${event.swapped.length} swapped` : ""}`;
};

/**
 * Final songs matching a candidate, of those offered, and what was held
 * back, so an empty offer reads as filtered rather than unfound.
 */
/** Artists and chart tracks offered. */
const offeredCount = (event: CandidatesEvent) =>
	(event.artists?.length ?? 0) + (event.tracks?.length ?? 0);

const candidatesCell = (event: CandidatesEvent, used: number) => {
	const held = [
		event.excluded ? `${event.excluded} excluded` : "",
		event.known ? `${event.known} known` : "",
	].filter(Boolean);
	return `${used}/${offeredCount(event)}${held.length ? ` (${held.join(", ")})` : ""}`;
};

/** Each source's pool size and the final songs matching it, e.g. `search 15→8`. */
const candidateSourcesCell = (result: RunResult) => {
	const pool = result.candidates?.pool;
	const used = result.candidateUseBySource;
	if (!pool || !used) return "n/a";
	return CANDIDATE_SOURCES.map(
		(source) => `${source} ${pool[source] ?? 0}→${used[source] ?? 0}`,
	).join(" · ");
};

/** The share of the playlist the curator declared it took from candidates. */
const fromCandidatesCell = (result: RunResult) =>
	!result.candidates ||
	!offeredCount(result.candidates) ||
	result.fromCandidates === undefined
		? "skipped"
		: `${result.fromCandidates}/${result.tracks} (${result.tracks ? Math.round((100 * result.fromCandidates) / result.tracks) : 0}%)`;

/** Resolved final songs found by the first search, of all final songs. */
const firstTryCell = (result: RunResult) =>
	result.attempts
		? `${result.attempts.first}/${result.tracks} (${result.tracks ? Math.round((100 * result.attempts.first) / result.tracks) : 0}%)`
		: "n/a";

const attemptsCell = (result: RunResult) =>
	result.attempts
		? [
				result.attempts.first,
				result.attempts.retry,
				result.attempts.replacement,
			].join(" / ")
		: "n/a";

/** Final songs' evidence; absent in results saved before evidence existed. */
const evidenceOf = (result: RunResult) => {
	const evidence = result.songs.flatMap((song) =>
		song.evidence ? [{ artist: song.artist, evidence: song.evidence }] : [],
	);
	return evidence.length ? evidence : null;
};

/** Distinct artists by MusicBrainz country, e.g. `FR 3 · BE 1 · unknown 1`. */
const artistCountryCell = (result: RunResult) => {
	if (!evidenceOf(result)) return "n/a";
	// Every final artist counts; one without evidence is unknown.
	const countries = new Map<string, string | null>();
	for (const { artist, evidence } of result.songs) {
		const key = artist.toLowerCase();
		countries.set(
			key,
			countries.get(key) ?? evidence?.artistCountry?.value ?? null,
		);
	}
	const tally = new Map<string, number>();
	for (const country of countries.values())
		tally.set(country ?? "unknown", (tally.get(country ?? "unknown") ?? 0) + 1);
	return [...tally]
		.sort(
			([a, x], [b, y]) =>
				Number(a === "unknown") - Number(b === "unknown") ||
				y - x ||
				a.localeCompare(b),
		)
		.map(([country, artists]) => `${country} ${artists}`)
		.join(" · ");
};

/** The first-release years MusicBrainz knows, e.g. `1995–2016 (median 2005)`. */
const releaseYearsCell = (result: RunResult) => {
	const years = (evidenceOf(result) ?? []).flatMap(({ evidence }) =>
		evidence.firstReleaseYear ? [evidence.firstReleaseYear.value] : [],
	);
	const middle = median(years);
	if (middle === null) return "n/a";
	return `${Math.min(...years)}–${Math.max(...years)} (median ${Math.round(middle)})`;
};

/** Distinct artists across every case, in total and per engine. */
export function distinctArtists(records: CaseRecord[]): string {
	const artists = (engine?: string) =>
		new Set(
			records.flatMap((record) =>
				!record.result || (engine && record.engine !== engine)
					? []
					: record.result.songs.map((song) => song.artist.toLowerCase()),
			),
		).size;
	const engines = [...new Set(records.map((record) => record.engine))];
	return `Distinct artists across all cases: ${artists()}${engines.length > 1 ? ` (${engines.map((engine) => `${engine} ${artists(engine)}`).join(", ")})` : ""}.`;
}

export function summaryRow(record: CaseRecord): string {
	const result = record.result;
	const assessment =
		record.judgment?.status === "ok" ? record.judgment.assessment : undefined;
	const counts = assessment
		? ["fit", "mismatch", "uncertain"]
				.map(
					(verdict) =>
						assessment.tracks.filter((track) => track.verdict === verdict)
							.length,
				)
				.join(" / ")
		: "n/a";
	return `| ${[record.caseId, record.engine, result?.generation.purpose ?? "n/a", seconds(result?.firstSongMs), seconds(result?.totalMs), result ? `${result.tracks}/${result.case.trackCount}` : "n/a", result?.uniqueArtists ?? "n/a", result ? `${result.onSpotify}/${result.tracks}` : "n/a", result ? `${result.resolution.exact + result.resolution.normalized}/${result.tracks}` : "n/a", result ? `${result.resolution.fuzzy}/${result.tracks}` : "n/a", result ? [result.resolution.exact, result.resolution.normalized, result.resolution.fuzzy, result.resolution.unresolved].join(" / ") : "n/a", result ? firstTryCell(result) : "n/a", result ? attemptsCell(result) : "n/a", result?.drift ?? "n/a", result?.replaced ?? "n/a", result?.poolFills ?? "n/a", result ? (result.novelty?.status === "ok" ? `${result.known} / ${result.knownArtist}` : result.novelty ? "error" : "n/a") : "n/a", budgetCell(result?.budget), ...(result?.popularity ? popularityCells(result.popularity) : ["n/a", "n/a", "n/a", "n/a", "n/a"]), popularityBudgetCell(result?.popularityBudget), result ? artistCountryCell(result) : "n/a", result ? releaseYearsCell(result) : "n/a", result ? (result.candidates ? (result.candidates.status === "ok" ? candidatesCell(result.candidates, result.candidateUse) : "error") : "skipped") : "n/a", result ? fromCandidatesCell(result) : "n/a", result ? candidateSourcesCell(result) : "n/a", result ? result.repairs.filter((r) => r.outcome === "replaced").length : "n/a", result ? (result.rerank ? (result.rerank.status === "ok" ? `${(result.rerank.pruned?.length ?? 0) - (result.rerank.restored?.length ?? 0)}/${result.rerank.pruned?.length ?? 0}` : "error") : "skipped") : "n/a", counts, seconds(record.judgment?.totalMs), record.failures.length ? "ERROR" : record.judgment ? "complete" : "pending", record.overlap].map(cell).join(" | ")} |`;
}

export const TABLE_HEADER =
	"| case | engine | purpose | first song | generation | tracks | artists | on Spotify | exact or normalized | fuzzy | exact / normalized / fuzzy / unresolved | first try | first / retry / replacement | drift | replaced | pool | known / artist | budget | median listeners (Last.fm / LB / Deezer) | mainstream | unknown listeners | Deezer counted | long tail | popularity budget | artist country | first release years | candidates | from candidates | candidate sources (pool → used) | repaired | filled / pruned | fit / mismatch / uncertain (advisory) | judge | eval | same as last run |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|";

export function renderReport(run: EvalRun): string {
	const lines = [
		"# Curator quality evaluation",
		"",
		`Started: ${run.startedAt}. Source: ${run.source.revision}${run.source.dirty ? " (dirty working tree; prompts captured in JSON)" : ""}. Complete: ${run.complete}.`,
		"",
		"Musical judgments are advisory and uncalibrated. They use model knowledge and supplied metadata, not listening, audio measurements, or verified research. Unknowns are not passes. The on Spotify count is resolver hits, not verified recording identity; exact or normalized counts title matches, fuzzy counts other recordings credited to the artist. Generator identity is hidden from the judge, but a fixed judge can still have provider/style biases.",
		"",
		TABLE_HEADER,
		...run.records.map(summaryRow),
		"",
		`${distinctArtists(run.records)} Coverage columns describe whose music the run serves and never fail it: artist country counts distinct artists by MusicBrainz country, first release years spans the years MusicBrainz knows, long tail counts recordings not mainstream or of unknown popularity, and Deezer counted counts recordings only Deezer's rank counted.`,
		"",
	];
	for (const record of run.records) {
		lines.push(`## ${cell(record.caseId)} — ${cell(record.engine)}`, "");
		if (record.failures.length)
			lines.push(
				...record.failures.map(
					(failure) => `- Evaluation error: ${cell(failure)}`,
				),
				"",
			);
		const result = record.result;
		if (!result) continue;
		lines.push(
			`Brief: ${cell(result.brief)}`,
			"",
			`Creativity: ${result.generation.creativity}. Purpose: ${result.generation.purpose}. Model: ${result.generation.model}. Temperature: ${result.generation.temperature}.`,
			"",
			`Name: ${cell(result.name)}`,
			"",
			`Description: ${cell(result.description)}`,
			"",
			"Track rubric:",
			"",
			...result.case.trackCriteria.map(
				(criterion) =>
					`- ${cell(criterion.id)}: ${cell(criterion.requirement)}`,
			),
			"",
		);
		for (const review of result.vocalReviews ?? []) {
			lines.push(
				`Vocal review (${review.phase}): ${review.status}${review.error ? ` — ${cell(review.error)}` : ""}.`,
				"",
			);
			for (const track of review.assessment?.tracks ?? []) {
				const input = JSON.parse(review.userPrompt).tracks.find(
					(song: { id: string }) => song.id === track.id,
				);
				lines.push(
					`- ${cell(input?.artist ?? track.id)} — ${cell(input?.title ?? "")}: **${track.verdict}**. ${cell(track.reason)}`,
				);
			}
			lines.push("");
		}
		for (const repair of result.vocalRepairs ?? []) {
			lines.push(
				`- Replacement ${cell(repair.suggestion.artist)} — ${cell(repair.suggestion.title)}: **${repair.outcome}**${repair.resolved?.spotifyRecording ? ` (resolved: ${cell(repair.resolved.spotifyRecording.title)})` : ""}.`,
			);
		}
		if (result.vocalRepairs?.length) lines.push("");
		const judgment = record.judgment;
		if (judgment)
			lines.push(
				`Judge: ${judgment.model}, temperature ${judgment.temperature}. Full rubric, inputs, and raw response are in the JSON artifact.`,
				"",
			);
		lines.push(
			"| # | artist — track | on Spotify | verdict | reason |",
			"|---|---|---|---|---|",
		);
		for (const [index, song] of result.songs.entries()) {
			const track =
				judgment?.status === "ok"
					? judgment.assessment.tracks.find(
							(item) => item.position === index + 1,
						)
					: undefined;
			lines.push(
				`| ${index + 1} | ${cell(song.artist)} — ${cell(song.title)} | ${song.songId ? `[open](https://open.spotify.com/track/${encodeURIComponent(song.songId)})` : "unresolved"} | ${track?.verdict ?? "not assessed"} | ${cell(track?.reason ?? "Judge incomplete or failed")} |`,
			);
		}
		lines.push("");
		if (judgment?.status === "ok") {
			for (const criterion of judgment.assessment.playlist)
				lines.push(
					`- **${cell(criterion.criterionId)} — ${criterion.verdict}:** ${cell(criterion.reason)}`,
				);
			lines.push("");
		}
	}
	return `${lines.join("\n")}\n`;
}
