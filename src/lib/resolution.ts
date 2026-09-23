import { z } from "zod";
import type { Intent } from "./intent";

export const RESOLUTION_TIERS = [
	"exact",
	"normalized",
	"fuzzy",
	"unresolved",
] as const;
export type ResolutionTier = (typeof RESOLUTION_TIERS)[number];

/** How a pick was matched to a Spotify recording, kept on every song. */
export const ResolutionSchema = z.object({
	tier: z.enum(RESOLUTION_TIERS),
	// The recording is a version (live, remix, ...) the pick did not ask for.
	drift: z.boolean(),
	isrc: z.string().nullable(),
});
export type Resolution = z.infer<typeof ResolutionSchema>;

export const UNRESOLVED: Resolution = {
	tier: "unresolved",
	drift: false,
	isrc: null,
};

/** The subset of a Spotify search result that scoring reads. */
export interface SearchHit {
	id: string;
	title: string;
	artists: string[];
	releaseDate: string;
	isrc: string | null;
}

export interface Pick {
	artist: string;
	title: string;
}

// Keep letters and digits from any script so 宇多田ヒカル or Кино still compare.
export const normalize = (s: string) =>
	s
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "");

/** "Celebrate Life - El-B Vocal Mix" → "Celebrate Life". */
export const baseTitle = (title: string) =>
	title.replace(/\s+[-([].*$/, "").trim();

/** Loose artist match: "D.A.F." and "LeMatos" pass, another act does not. */
export function creditsArtist(artist: string, credited: string[]): boolean {
	const wanted = normalize(artist);
	return credited.some((name) => {
		const normalized = normalize(name);
		if (!normalized || !wanted) return normalized === wanted && name === artist;
		return (
			normalized === wanted ||
			normalized.includes(wanted) ||
			wanted.includes(normalized)
		);
	});
}

// Plurals count too, so an exclusion such as "no covers" names the word.
const VERSION_TOKENS: [RegExp, string][] = [
	[/\blive\b/, "live"],
	[/\bremix(?:es|ed)?\b|\brmx\b/, "remix"],
	[/\bremasters?(?:ed)?\b/, "remaster"],
	[/\bedits?\b/, "edit"],
	[/\bsped[- ]?up\b/, "sped up"],
	[/\bslowed\b/, "slowed"],
	[/\bkaraoke\b/, "karaoke"],
	[/\btributes?\b/, "tribute"],
	[/\bcovers?\b/, "cover"],
	[/\binstrumentals?\b/, "instrumental"],
	[/\bvocal(?:s|\s+mix)?\b/, "vocal"],
];

/**
 * How often each version word occurs in a title, e.g. {live: 1} for
 * "Nightcall - Live". Counting lets "Live Forever - Live at Knebworth"
 * still read as a live take of a song whose name contains "live".
 */
export function versionTokens(text: string): Map<string, number> {
	const lowered = text.toLowerCase();
	const counts = new Map<string, number>();
	for (const [pattern, token] of VERSION_TOKENS) {
		const hits = lowered.match(new RegExp(pattern.source, "g"))?.length ?? 0;
		if (hits) counts.set(token, hits);
	}
	return counts;
}

/** A recording is a version neither the pick nor the intent asked for. */
export function versionDrift(
	pickTitle: string,
	hitTitle: string,
	intent: Intent | null,
): boolean {
	const asked = versionTokens(pickTitle);
	if (intent?.vocalRule.rule === "no-vocals")
		asked.set("instrumental", Number.POSITIVE_INFINITY);
	for (const [token, count] of versionTokens(hitTitle))
		if (count > (asked.get(token) ?? 0)) return true;
	return false;
}

// Tier dominates: a drifted take of the requested title still beats a
// clean recording of some other song by the artist.
const TIER_SCORE: Record<Exclude<ResolutionTier, "unresolved">, number> = {
	exact: 30,
	normalized: 20,
	fuzzy: 10,
};
const DRIFT_PENALTY = 5;
const ERA_BONUS = 2;

/** The year in a Spotify release date, or null for "unknown" and the like. */
export const releaseYear = (releaseDate: string): number | null => {
	const year = Number.parseInt(releaseDate.slice(0, 4), 10);
	return Number.isNaN(year) ? null : year;
};

const insideEra = (year: number | null, era: Intent["era"]): boolean =>
	year !== null &&
	era !== null &&
	(era.start === null || year >= era.start) &&
	(era.end === null || year <= era.end);

export interface Scored {
	hit: SearchHit;
	resolution: Resolution;
	score: number;
}

/**
 * Score one hit for a pick, or null when another act performs it.
 * Version words are penalised unless the pick or intent asks for them; with
 * an era in the intent, releases inside it score higher and, among those,
 * earlier ones win ties. "fuzzy" means credited to the artist with a
 * different title, which plain-text search can return for deep cuts.
 */
export function scoreSearchHit(
	pick: Pick,
	hit: SearchHit,
	intent: Intent | null,
): Scored | null {
	if (!creditsArtist(pick.artist, hit.artists)) return null;
	const tier: ResolutionTier =
		normalize(hit.title) === normalize(pick.title)
			? "exact"
			: normalize(baseTitle(hit.title)) === normalize(baseTitle(pick.title))
				? "normalized"
				: "fuzzy";
	const drift = versionDrift(pick.title, hit.title, intent);
	const era = intent?.era ?? null;
	const score =
		TIER_SCORE[tier] -
		(drift ? DRIFT_PENALTY : 0) +
		(insideEra(releaseYear(hit.releaseDate), era) ? ERA_BONUS : 0);
	return {
		hit,
		resolution: { tier, drift, isrc: hit.isrc },
		score,
	};
}

/** The best-scoring hit for a pick, or null when none is by the artist. */
export function chooseSearchHit(
	pick: Pick,
	hits: SearchHit[],
	intent: Intent | null,
): Scored | null {
	const era = intent?.era ?? null;
	const scored = hits
		.map((hit, index) => ({
			scored: scoreSearchHit(pick, hit, intent),
			index,
		}))
		.filter(
			(entry): entry is { scored: Scored; index: number } =>
				entry.scored !== null,
		);
	scored.sort((a, b) => {
		if (b.scored.score !== a.scored.score)
			return b.scored.score - a.scored.score;
		const ya = releaseYear(a.scored.hit.releaseDate);
		const yb = releaseYear(b.scored.hit.releaseDate);
		if (insideEra(ya, era) && insideEra(yb, era) && ya !== yb)
			return (ya ?? 0) - (yb ?? 0);
		return a.index - b.index;
	});
	return scored[0]?.scored ?? null;
}
