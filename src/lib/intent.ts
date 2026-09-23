import { z } from "zod";

export const VOCAL_RULES = ["none", "no-vocals", "vocals-welcome"] as const;
export const EXCLUSION_KINDS = ["artist", "style", "version"] as const;

const label = z.string().trim().min(1).max(200);
const quote = z.string().trim().min(1).max(500);

/** What the reader model returns, before grounding. */
export const ReadIntentSchema = z.object({
	genres: z.array(label).max(20).default([]),
	era: z
		.object({
			start: z.number().int().nullable().default(null),
			end: z.number().int().nullable().default(null),
		})
		.nullable()
		.default(null),
	mood: label.nullable().default(null),
	energy: label.nullable().default(null),
	language: label.nullable().default(null),
	vocalRule: z
		.object({
			rule: z.enum(VOCAL_RULES),
			quote: quote.nullable().default(null),
		})
		.default({ rule: "none", quote: null }),
	exclusions: z
		.array(z.object({ kind: z.enum(EXCLUSION_KINDS), value: label, quote }))
		.max(20)
		.default([]),
	mustInclude: z
		.array(z.object({ artist: label, quote }))
		.max(20)
		.default([]),
	// The brief asks for an album (a record played through, a soundtrack),
	// which lifts the one-per-album cap.
	album: z.object({ quote }).nullable().default(null),
});
export type ReadIntent = z.infer<typeof ReadIntentSchema>;

export const IntentSchema = ReadIntentSchema.extend({
	difficulty: z.enum(["easy", "difficult"]),
});
export type Intent = z.infer<typeof IntentSchema>;

/** The brief's own spelling of `quote`, or null when the brief never says it. */
function locate(brief: string, quote: string | null): string | null {
	if (!quote) return null;
	const escaped = quote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(escaped, "iu").exec(brief)?.[0] ?? null;
}

/** The rule with its quote in the brief's spelling, or null if ungrounded. */
function ground<T extends { quote: string | null }>(
	brief: string,
	rule: T,
): T | null {
	const quote = locate(brief, rule.quote);
	return quote ? { ...rule, quote } : null;
}

/**
 * Hard rules (vocal rule, exclusions, must-includes) each keep the exact
 * brief substring that supports them, so later stages act on the listener's
 * words rather than a paraphrase. A rule the brief does not literally
 * support is dropped rather than trusted, as is an album request. Difficulty follows the spec: any
 * exclusion, language or scene, or a no-vocals rule.
 */
export function groundIntent(read: ReadIntent, brief: string): Intent {
	const vocalRule: Intent["vocalRule"] = ground(brief, read.vocalRule) ?? {
		rule: "none",
		quote: null,
	};
	const exclusions = read.exclusions.flatMap(
		(rule) => ground(brief, rule) ?? [],
	);
	const mustInclude = read.mustInclude.flatMap(
		(rule) => ground(brief, rule) ?? [],
	);
	const album = read.album && ground(brief, read.album);
	const era =
		read.era && read.era.start !== null && read.era.end !== null
			? {
					start: Math.min(read.era.start, read.era.end),
					end: Math.max(read.era.start, read.era.end),
				}
			: read.era;
	const difficult =
		exclusions.length > 0 ||
		read.language !== null ||
		vocalRule.rule === "no-vocals";
	return {
		...read,
		era,
		vocalRule,
		exclusions,
		mustInclude,
		album,
		difficulty: difficult ? "difficult" : "easy",
	};
}
