import { z } from "zod";
import type { Song } from "~/contexts/playlist-provider";
import type { Intent } from "./intent";
import { baseTitle, normalize, versionTokens } from "./resolution";

export const EVIDENCE_SOURCES = [
	"musicbrainz",
	"lrclib",
	"deezer",
	"lastfm",
	"listenbrainz",
] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

/** Sources that count listeners, in the order they are asked. */
export const LISTENER_SOURCES = ["lastfm", "listenbrainz"] as const;
export type ListenerSource = (typeof LISTENER_SOURCES)[number];

/** Why a source gave no fact: no record, a failure, a deadline, or no key. */
export const SOURCE_STATUSES = [
	"ok",
	"unknown",
	"error",
	"timeout",
	"off",
] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

/** A fact with its source; null means no source could tell. */
const fact = <T extends z.ZodType, S extends EvidenceSource>(
	value: T,
	sources: readonly [S, ...S[]] = EVIDENCE_SOURCES as unknown as [S, ...S[]],
) => z.object({ value, source: z.enum(sources) }).nullable();

export const EvidenceSchema = z.object({
	firstReleaseYear: fact(z.number().int()),
	artistCountry: fact(z.string()),
	credits: fact(z.array(z.string())),
	instrumental: fact(z.boolean()),
	tempo: fact(z.number()),
	gain: fact(z.number()),
	version: fact(z.string()),
	tags: fact(z.array(z.string())),
	listeners: fact(z.number(), LISTENER_SOURCES),
	sources: z.record(z.enum(EVIDENCE_SOURCES), z.enum(SOURCE_STATUSES)),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const HARD_RULES = ["no-vocals", "era", "exclusion"] as const;
export type HardRule = (typeof HARD_RULES)[number];

/** Where a breach was seen: an evidence source, or the resolved recording. */
export const VIOLATION_SOURCES = [...EVIDENCE_SOURCES, "spotify"] as const;
export type ViolationSource = (typeof VIOLATION_SOURCES)[number];

export interface Violation {
	rule: HardRule;
	source: ViolationSource;
	detail: string;
}

/** The recording a slot resolved to, which the exclusions are read against. */
export type Recording = Pick<Song, "spotifyRecording">;

type Exclusion = Intent["exclusions"][number];

const eraLabel = (era: NonNullable<Intent["era"]>) =>
	`${era.start ?? "…"}–${era.end ?? "…"}`;

/**
 * The credit that is the excluded act. Credits come one act per entry, so
 * exact names suffice; the loose match that confirms a search hit would
 * evict Air Supply under "no Air".
 */
const excludedCredit = (exclusion: Exclusion, credits: string[]) =>
	credits.find((name) => normalize(name) === normalize(exclusion.value));

/**
 * The excluded version word a title carries beyond its base, so "Live
 * Forever - Live at Knebworth" counts under "no live" and "Live Forever"
 * does not. An exclusion naming no version word, such as a language or a
 * label, cannot be read from a title and never matches.
 */
function excludedVersion(
	exclusion: Exclusion,
	title: string,
	base = baseTitle(title),
) {
	const inTitle = versionTokens(title);
	const inBase = versionTokens(base);
	return [...versionTokens(exclusion.value).keys()].find(
		(word) => (inTitle.get(word) ?? 0) > (inBase.get(word) ?? 0),
	);
}

/**
 * A source-backed breach of an exclusion, or null when neither the
 * recording nor the evidence shows one. Spotify's credits and title are
 * read first, since they describe the recording the slot actually holds.
 */
function exclusionViolation(
	exclusion: Exclusion,
	evidence: Evidence,
	recording: Recording,
): Violation | null {
	const breach = (source: ViolationSource, detail: string): Violation => ({
		rule: "exclusion",
		source,
		detail: `${detail}, excluded by "${exclusion.quote}"`,
	});
	const spotify = recording.spotifyRecording;
	switch (exclusion.kind) {
		case "artist": {
			const credit = spotify && excludedCredit(exclusion, spotify.artists);
			if (credit) return breach("spotify", `credited to ${credit}`);
			const credits = evidence.credits;
			const named = credits && excludedCredit(exclusion, credits.value);
			return credits && named
				? breach(credits.source, `credited to ${named}`)
				: null;
		}
		case "style": {
			// A tag is the style itself, not a tag that contains it: "no trap"
			// leaves "trap music" and "ballads" leaves "ballad".
			const tags = evidence.tags;
			const tag = tags?.value.find(
				(candidate) => normalize(candidate) === normalize(exclusion.value),
			);
			return tags && tag ? breach(tags.source, `tagged ${tag}`) : null;
		}
		case "version": {
			const inTitle = spotify && excludedVersion(exclusion, spotify.title);
			if (spotify && inTitle)
				return breach("spotify", `a ${inTitle} version, "${spotify.title}"`);
			const version = evidence.version;
			// Deezer's version string is a suffix on its own, so all of it counts.
			const named = version && excludedVersion(exclusion, version.value, "");
			return version && named
				? breach(version.source, `a ${named} version, "${version.value}"`)
				: null;
		}
	}
}

/**
 * A source-backed breach of a hard rule, or null when the evidence allows
 * the recording or cannot tell. Unknown never counts as a violation.
 */
export function hardRuleViolation(
	intent: Intent | null,
	evidence: Evidence,
	recording: Recording,
): Violation | null {
	if (!intent) return null;
	const sung = evidence.instrumental;
	if (intent.vocalRule.rule === "no-vocals" && sung && sung.value === false)
		return {
			rule: "no-vocals",
			source: sung.source,
			detail: `${sung.source} lists lyrics for this recording`,
		};
	const era = intent.era;
	const year = evidence.firstReleaseYear;
	if (
		era &&
		year &&
		((era.start !== null && year.value < era.start) ||
			(era.end !== null && year.value > era.end))
	)
		return {
			rule: "era",
			source: year.source,
			detail: `first released ${year.value}, outside ${eraLabel(era)}`,
		};
	for (const exclusion of intent.exclusions) {
		const violation = exclusionViolation(exclusion, evidence, recording);
		if (violation) return violation;
	}
	return null;
}
