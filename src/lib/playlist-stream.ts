import { z } from "zod";
import { ENGINE_IDS } from "./engines";
import { EvidenceSchema, HARD_RULES, VIOLATION_SOURCES } from "./evidence";
import { IntentSchema } from "./intent";
import { PURPOSES } from "./purpose";
import { ResolutionSchema } from "./resolution";

// The NDJSON contract between the create-playlist route and its consumers
// (wizard, evals). Every line the route emits validates against
// PlaylistLineSchema; anything else is dropped at the boundary that produced
// it, so one malformed object never reaches a client or ends the stream.

const nonEmpty = z.string().trim().min(1);

/**
 * A recording in the listener's known set, one by an artist in it, or
 * neither. Matching the recording outranks matching only its artist.
 */
export const FAMILIARITIES = ["known", "known-artist", "new"] as const;
export type Familiarity = (typeof FAMILIARITIES)[number];

export const SpotifyRecordingSchema = z.object({
	title: z.string(),
	artists: z.array(z.string()),
	albumId: z.string().optional(),
	durationMs: z.number().optional(),
});

/** Where a slot's song came from; a pick streams first, the rest fill later. */
export const SONG_ORIGINS = [
	"pick",
	"pool",
	"replacement",
	"repair",
	"novelty",
	"popularity",
] as const;
export type SongOrigin = (typeof SONG_ORIGINS)[number];

/**
 * Whether the curator took a song from the candidates a lookup round
 * offered or recalled it. Only curator picks can be candidates; every other
 * song is recall, as is every pick when nothing was offered.
 */
export const SONG_SOURCES = ["candidates", "recall"] as const;
export type SongSource = (typeof SONG_SOURCES)[number];

/**
 * Where a candidate came from: an artist MusicBrainz tags with the brief's
 * scene or credits on its label, or a track on Last.fm's chart for one of
 * the intent's genres. Candidates come from open music databases only:
 * nothing read from Spotify is ever offered to an engine.
 */
export const CANDIDATE_SOURCES = ["tag", "label", "chart"] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];
const ARTIST_SOURCES = ["tag", "label"] as const;
const LOOKUP_SOURCES = ["tag", "label", "chart"] as const;

/** A slot as the client stores it, before or after Spotify resolution. */
export const SongSchema = z.object({
	id: nonEmpty,
	order: z.number(),
	artist: nonEmpty,
	title: nonEmpty,
	songId: z.string().nullish(),
	previewUrl: z.string().nullish(),
	albumImage: z.string().nullish(),
	albumTitle: z.string().nullish(),
	albumYear: z.number().nullish(),
	spotifyRecording: SpotifyRecordingSchema.optional(),
	resolution: ResolutionSchema.optional(),
	origin: z.enum(SONG_ORIGINS).optional(),
	source: z.enum(SONG_SOURCES).optional(),
	// The offered candidate the song matches, by one of its credited artists.
	candidate: z.enum(CANDIDATE_SOURCES).optional(),
	// Whether the listener already knows it; absent when the known set was not read.
	familiarity: z.enum(FAMILIARITIES).optional(),
});

const NameLineSchema = z.object({ kind: z.literal("name"), name: z.string() });
const DescriptionLineSchema = z.object({
	kind: z.literal("description"),
	description: z.string(),
});

/** What the curator itself is allowed to say; the route assigns the slot id. */
export const CuratorLineSchema = z.discriminatedUnion("kind", [
	NameLineSchema,
	DescriptionLineSchema,
	z.object({
		kind: z.literal("song"),
		order: z.number(),
		artist: nonEmpty,
		title: nonEmpty,
		// A declaration the curator garbles must not cost the pick itself.
		source: z.enum(SONG_SOURCES).optional().catch(undefined),
	}),
]);
export type CuratorLine = z.infer<typeof CuratorLineSchema>;

const VocalVerdict = z.enum(["vocals", "instrumental", "uncertain"]);
const BriefFit = z.enum(["fit", "mismatch", "uncertain"]);

export const VocalAssessmentSchema = z.object({
	restriction: z.string().min(1).nullable(),
	tracks: z.array(
		z.object({
			id: nonEmpty,
			verdict: VocalVerdict,
			briefFit: BriefFit.optional(),
			reason: nonEmpty,
			replacement: z.object({ artist: nonEmpty, title: nonEmpty }).nullish(),
		}),
	),
});
export type VocalAssessment = z.infer<typeof VocalAssessmentSchema>;

export const VocalReviewEventSchema = z.object({
	kind: z.literal("vocal-review"),
	phase: z.enum(["initial", "replacement"]),
	engine: z.enum(ENGINE_IDS),
	model: z.string(),
	status: z.enum(["ok", "error"]),
	systemPrompt: z.string(),
	userPrompt: z.string(),
	raw: z.string(),
	totalMs: z.number(),
	assessment: VocalAssessmentSchema.optional(),
	error: z.string().optional(),
});

export const VocalRepairEventSchema = z.object({
	kind: z.literal("vocal-repair"),
	id: nonEmpty,
	suggestion: z.object({ artist: z.string(), title: z.string() }),
	resolved: SongSchema.optional(),
	outcome: z.enum([
		"accepted",
		"unresolved",
		"lookup-error",
		"duplicate-artist",
		"duplicate-recording",
		"duplicate-album",
		"not-instrumental",
		"brief-mismatch",
		"review-error",
	]),
});

/** What the providers said about the recording currently in a slot. */
export const EvidenceLineSchema = z.object({
	kind: z.literal("evidence"),
	id: nonEmpty,
	evidence: EvidenceSchema,
});

/**
 * A hard-rule breach found in evidence and what was done about the slot.
 * "no-substitute" means the pool had nothing; the curator is asked as today.
 */
export const RepairEventSchema = z.object({
	kind: z.literal("repair"),
	id: nonEmpty,
	rule: z.enum(HARD_RULES),
	source: z.enum(VIOLATION_SOURCES),
	detail: z.string(),
	outcome: z.enum(["replaced", "no-substitute"]),
	replacement: z.object({ artist: z.string(), title: z.string() }).optional(),
});
export type RepairEvent = z.infer<typeof RepairEventSchema>;

/**
 * The size of the listener's known set, emitted before any song resolves:
 * distinct recordings and artists across top tracks, saved tracks, recent
 * plays and earlier playlists in the app. How many picks are known is on
 * the songs themselves. On error no song is flagged, and `cause` says
 * whether signing in again would help.
 */
export const NoveltyEventSchema = z.discriminatedUnion("status", [
	z.object({
		kind: z.literal("novelty"),
		status: z.literal("ok"),
		knownRecordings: z.number().int(),
		knownArtists: z.number().int(),
	}),
	z.object({
		kind: z.literal("novelty"),
		status: z.literal("error"),
		cause: z.enum(["access", "unavailable"]),
		error: z.string(),
	}),
]);
export type NoveltyEvent = z.infer<typeof NoveltyEventSchema>;

/** The most known tracks, and songs by known artists, a playlist may hold. */
export const NoveltyBudgetSchema = z.object({
	knownTracks: z.number().int(),
	knownArtists: z.number().int(),
});
export type NoveltyBudget = z.infer<typeof NoveltyBudgetSchema>;

/**
 * How many final songs the listener knows, emitted once the playlist is
 * final. `byKnownArtist` includes the known tracks, since a known recording
 * is by a known artist. A capped purpose reports whether its budget held
 * and which slots were swapped for it; without a known set nothing can be
 * counted.
 */
export const BudgetEventSchema = z.discriminatedUnion("status", [
	z.object({
		kind: z.literal("budget"),
		status: z.enum(["held", "breached"]),
		budget: NoveltyBudgetSchema,
		known: z.number().int(),
		byKnownArtist: z.number().int(),
		swapped: z.array(z.string()),
	}),
	z.object({
		kind: z.literal("budget"),
		status: z.literal("uncapped"),
		known: z.number().int(),
		byKnownArtist: z.number().int(),
	}),
	z.object({ kind: z.literal("budget"), status: z.literal("unknown") }),
]);
export type BudgetEvent = z.infer<typeof BudgetEventSchema>;

/**
 * The most and the fewest mainstream recordings a playlist may hold; null
 * leaves that side open.
 */
export const PopularityBudgetSchema = z.object({
	maxMainstream: z.number().int().nullable(),
	minMainstream: z.number().int().nullable(),
});
export type PopularityBudget = z.infer<typeof PopularityBudgetSchema>;

const PopularityCountsSchema = z.object({
	recordings: z.number().int(),
	mainstream: z.number().int(),
	unknown: z.number().int(),
	median: z.object({
		lastfm: z.number().nullable(),
		listenbrainz: z.number().nullable(),
	}),
});

/**
 * How mainstream the final playlist is, emitted after rerank. A recording
 * no source counts is not mainstream. A budgeted playlist reports whether
 * its budget held and which slots were swapped for it.
 */
export const PopularityEventSchema = z.discriminatedUnion("status", [
	PopularityCountsSchema.extend({
		kind: z.literal("popularity"),
		status: z.enum(["held", "breached"]),
		budget: PopularityBudgetSchema,
		swapped: z.array(z.string()),
	}),
	PopularityCountsSchema.extend({
		kind: z.literal("popularity"),
		status: z.literal("uncapped"),
	}),
]);
export type PopularityEvent = z.infer<typeof PopularityEventSchema>;

/**
 * Last.fm listeners of a candidate, counted before it is offered; for an
 * artist, those of their most played track. Null when Last.fm had no
 * count in time, which counts as not mainstream.
 */
const listeners = z.number().int().nullable();

/**
 * An artist MusicBrainz found for the brief. It is offered as an artist,
 * not a recording: the curator picks one of their songs, which resolves
 * like any pick.
 */
export const ArtistCandidateSchema = z.object({
	name: nonEmpty,
	mbid: nonEmpty.nullable(),
	source: z.enum(ARTIST_SOURCES),
	area: z.string().nullable(),
	tags: z.array(z.string()),
	label: z.string().nullable(),
	listeners: listeners.optional(),
});
export type ArtistCandidate = z.infer<typeof ArtistCandidateSchema>;

/**
 * A track on Last.fm's chart for one of the intent's genres. It is offered
 * by artist and title, not verified on Spotify, and resolves like any pick.
 */
export const TrackCandidateSchema = z.object({
	artist: nonEmpty,
	title: nonEmpty,
	source: z.literal("chart"),
	tag: z.string(),
	listeners,
});
export type TrackCandidate = z.infer<typeof TrackCandidateSchema>;

/** One MusicBrainz or Last.fm lookup as sent, and how it went. */
export const ArtistSearchSchema = z.object({
	source: z.enum(LOOKUP_SOURCES),
	query: z.string(),
	status: z.enum(["ok", "error"]),
	hits: z.number().int(),
	error: z.string().optional(),
});
export type ArtistSearch = z.infer<typeof ArtistSearchSchema>;

const SourceCountsSchema = z.object(
	Object.fromEntries(
		CANDIDATE_SOURCES.map((source) => [source, z.number().int()]),
	) as Record<CandidateSource, z.ZodNumber>,
);

/**
 * The scene plan the curator wrote for the brief and what MusicBrainz and
 * Last.fm returned for it. `excluded` counts the hits by an artist the
 * intent rules out and `known` those by an artist a budgeted playlist
 * keeps off, duplicates included in both. `pool` counts each source's
 * candidates after filtering, capped at five a track; `artists` and
 * `tracks` are the sample offered to the curator, drawn from the sources in
 * turn under the popularity budget.
 */
export const CandidatesEventSchema = z.object({
	kind: z.literal("candidates"),
	engine: z.enum(ENGINE_IDS),
	model: z.string(),
	status: z.enum(["ok", "error"]),
	systemPrompt: z.string(),
	userPrompt: z.string(),
	raw: z.string(),
	totalMs: z.number(),
	musicbrainz: z.array(ArtistSearchSchema),
	lastfm: z.array(ArtistSearchSchema),
	excluded: z.number().int(),
	known: z.number().int(),
	pool: SourceCountsSchema,
	artists: z.array(ArtistCandidateSchema),
	tracks: z.array(TrackCandidateSchema),
	/**
	 * The popularity budget the offer was drawn under, how many pooled
	 * candidates Last.fm counted in time, and how many offered are
	 * mainstream.
	 */
	popularity: z.object({
		budget: PopularityBudgetSchema.nullable(),
		counted: z.number().int(),
		mainstream: z.number().int(),
	}),
	error: z.string().optional(),
});
export type CandidatesEvent = z.infer<typeof CandidatesEventSchema>;

/** What the rerank engine returns: ids are track ids or pool ids. */
export const RerankOutputSchema = z.object({
	order: z.array(nonEmpty).min(1),
	prune: z.array(nonEmpty).default([]),
	reasons: z.record(z.string(), nonEmpty),
});

/**
 * The rerank call and what it settled on, all by slot id: `order` is the
 * listening order with pool ids mapped onto the slots they fill, `pruned`
 * the slots the rerank wanted out, `restored` those of them that kept
 * their recording because no pool recording could take the slot.
 */
export const RerankEventSchema = z.object({
	kind: z.literal("rerank"),
	engine: z.enum(ENGINE_IDS),
	model: z.string(),
	status: z.enum(["ok", "error"]),
	systemPrompt: z.string(),
	userPrompt: z.string(),
	raw: z.string(),
	totalMs: z.number(),
	order: z.array(nonEmpty).optional(),
	pruned: z.array(nonEmpty).optional(),
	restored: z.array(nonEmpty).optional(),
	error: z.string().optional(),
});
export type RerankEvent = z.infer<typeof RerankEventSchema>;

/** The listening order by slot id; slots keep their numbers on the wire. */
export const OrderLineSchema = z.object({
	kind: z.literal("order"),
	ids: z.array(nonEmpty),
});

/** Why the recording in a slot belongs in the playlist. */
export const ReasonLineSchema = z.object({
	kind: z.literal("reason"),
	id: nonEmpty,
	reason: nonEmpty,
});

export const PlaylistLineSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("complete"),
		id: nonEmpty,
		songIds: z.array(nonEmpty),
	}),
	z.object({ kind: z.literal("id"), id: nonEmpty }),
	// The purpose is the listener's choice, so it travels beside what was read
	// from the brief and survives a failed read.
	z.object({
		kind: z.literal("intent"),
		intent: IntentSchema.nullable(),
		purpose: z.enum(PURPOSES),
	}),
	NameLineSchema,
	DescriptionLineSchema,
	// A stored song may predate sources; a streamed one always says.
	SongSchema.extend({
		kind: z.literal("song"),
		source: z.enum(SONG_SOURCES),
	}),
	VocalReviewEventSchema,
	VocalRepairEventSchema,
	EvidenceLineSchema,
	RepairEventSchema,
	NoveltyEventSchema,
	BudgetEventSchema,
	PopularityEventSchema,
	CandidatesEventSchema,
	RerankEventSchema,
	OrderLineSchema,
	ReasonLineSchema,
]);
export type PlaylistLine = z.infer<typeof PlaylistLineSchema>;
