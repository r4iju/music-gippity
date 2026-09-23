import { z } from "zod";
import {
	type PlaylistFormInput,
	PlaylistFormSchema,
} from "~/app/dashboard/create-playlist/playlist-form-schema";
import { artistKey } from "~/lib/caps";
import { type Intent, IntentSchema } from "~/lib/intent";
import {
	ArtistCandidateSchema,
	CandidatesEventSchema,
	NoveltyEventSchema,
	TrackCandidateSchema,
} from "~/lib/playlist-stream";
import { popularityBudget } from "~/lib/popularity";
import {
	type AvoidedArtists,
	searchForCandidates,
} from "~/server/api/candidates";
import { fetchKnown, type KnownSet } from "~/server/api/known";
import { spotifyListener } from "~/server/api/listener";
import { noveltyBudget } from "~/server/api/novelty";

/**
 * What a generation learnt before curating, checkpointed so a resumed run
 * need not pay for it again. The known set is the listener's Spotify
 * library: it is kept to flag songs and hold the novelty budget in the app,
 * and no stage may put it, or anything else read from Spotify, into an
 * engine request.
 */
export const ResearchSchema = z.object({
	intent: IntentSchema.nullable(),
	known: z.object({
		set: z
			.object({
				recordings: z.array(z.string()),
				artists: z.array(
					z.tuple([
						z.string(),
						z.object({ name: z.string(), recordings: z.number() }),
					]),
				),
			})
			.nullable(),
		event: NoveltyEventSchema,
	}),
	search: z.object({
		artists: z.array(ArtistCandidateSchema),
		tracks: z.array(TrackCandidateSchema),
		event: CandidatesEventSchema,
	}),
});
export type Research = z.infer<typeof ResearchSchema>;

export const restoreKnown = (known: Research["known"]) => ({
	...known,
	set: known.set
		? {
				recordings: new Set(known.set.recordings),
				artists: new Map(known.set.artists),
			}
		: null,
});

export function avoidedArtists(set: KnownSet | null): AvoidedArtists | null {
	if (!set) return null;
	return { has: (name: string) => set.artists.has(artistKey(name)) };
}

export async function retrieveCandidates(
	input: PlaylistFormInput,
	intent: Intent | null,
	userId: string,
	token: string,
	signal: AbortSignal,
): Promise<Research> {
	const settings = PlaylistFormSchema.parse(input);
	const known = await fetchKnown(spotifyListener(token), userId);
	signal.throwIfAborted();
	const search = await searchForCandidates({
		userId,
		signal,
		brief: settings.prompt,
		intent,
		engine: settings.engine,
		trackCount: settings.trackCount,
		creativity: settings.creativity,
		avoid: noveltyBudget(settings.purpose, settings.trackCount)
			? avoidedArtists(known.set)
			: null,
		popularity: popularityBudget(
			settings.creativity,
			settings.purpose,
			settings.trackCount,
		),
		strict: true,
	});
	return ResearchSchema.parse({
		intent,
		search,
		known: {
			event: known.event,
			set: known.set
				? {
						recordings: [...known.set.recordings],
						artists: [...known.set.artists],
					}
				: null,
		},
	});
}
