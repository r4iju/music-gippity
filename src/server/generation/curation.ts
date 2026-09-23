import { z } from "zod";
import {
	type PlaylistFormInput,
	PlaylistFormSchema,
} from "~/app/dashboard/create-playlist/playlist-form-schema";
import { CREATIVITY } from "~/lib/creativity";
import { CuratorLineSchema, SongSchema } from "~/lib/playlist-stream";
import { runEngine } from "~/server/api/engines";
import {
	curatorSystemPrompt,
	playlistPrompt,
} from "~/server/api/engines/common";
import { processEngineStream } from "~/server/api/stream-helpers";
import type { Research } from "./research";

export const CuratedSchema = z.object({
	name: z.string(),
	description: z.string(),
	picks: z
		.array(SongSchema.extend({ source: z.enum(["recall", "candidates"]) }))
		.max(200),
	emptySlots: z.array(z.object({ id: z.string().uuid(), order: z.number() })),
});
export type Curated = z.infer<typeof CuratedSchema>;

export async function curatePicks(
	input: PlaylistFormInput,
	research: Research,
	userId: string,
	signal: AbortSignal,
): Promise<Curated> {
	const settings = PlaylistFormSchema.parse(input);
	const { prompt, trackCount, creativity, purpose, engine } = settings;
	const { search } = research;
	const response = await runEngine(engine, {
		requireCompletion: true,
		userId,
		signal,
		system: curatorSystemPrompt,
		prompt: playlistPrompt({
			prompt,
			trackCount,
			creativity,
			purpose,
			candidateArtists: search.artists,
			candidateTracks: search.tracks,
		}),
		temperature: CREATIVITY[creativity].temperature,
	});
	if (response instanceof Response)
		throw new Error("Curator request did not complete");
	const result: Curated = {
		name: "",
		description: "",
		picks: [],
		emptySlots: [],
	};
	const offered = Boolean(search.artists.length || search.tracks.length);
	await processEngineStream<Record<string, unknown>>(
		response,
		undefined,
		(obj) => {
			const parsed = CuratorLineSchema.safeParse(obj);
			if (!parsed.success) return;
			const line = parsed.data;
			if (line.kind === "name") result.name = line.name;
			else if (line.kind === "description")
				result.description = line.description;
			else if (result.picks.length < 200)
				result.picks.push({
					...line,
					id: crypto.randomUUID(),
					order: result.picks.length + 1,
					source:
						offered && line.source === "candidates" ? "candidates" : "recall",
				});
		},
		signal,
		true,
	);
	signal.throwIfAborted();
	for (let order = result.picks.length + 1; order <= trackCount; order++)
		result.emptySlots.push({ id: crypto.randomUUID(), order });
	return CuratedSchema.parse(result);
}
