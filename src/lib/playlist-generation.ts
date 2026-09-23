import { z } from "zod";
import {
	type PlaylistFormInput,
	PlaylistFormSchema,
} from "~/app/dashboard/create-playlist/playlist-form-schema";
import { EvidenceSchema } from "~/lib/evidence";
import { IntentSchema } from "~/lib/intent";
import { applyOrder } from "~/lib/playlist-order";
import {
	type PlaylistLine,
	PlaylistLineSchema,
	SongSchema,
} from "~/lib/playlist-stream";
import { PURPOSES } from "~/lib/purpose";

export const GenerationSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("idle") }),
	z.object({ status: z.literal("queued"), runId: z.string() }),
	z.object({ status: z.literal("running"), runId: z.string() }),
	z.object({ status: z.literal("interrupted"), message: z.string() }),
	z.object({ status: z.literal("complete") }),
	z.object({ status: z.literal("kept") }),
]);
export type Generation = z.infer<typeof GenerationSchema>;

const StoredDraft = z.object({
	name: z.string(),
	id: z.string(),
	description: z.string(),
	length: z.number().int().min(0).max(100),
	isExported: z.boolean(),
	// Set together with isExported; optional so drafts stored before it
	// existed still parse.
	spotifyPlaylistId: z.string().optional(),
	isSavedForLater: z.boolean(),
	isLoading: z.boolean().optional(),
	songs: z
		.array(
			SongSchema.extend({
				evidence: EvidenceSchema.optional(),
				reason: z.string().optional(),
			}),
		)
		.max(100),
	avoidedSongs: z.array(z.string()),
	brief: PlaylistFormSchema.pick({
		prompt: true,
		engine: true,
		creativity: true,
	}).optional(),
	intent: IntentSchema.nullable().optional(),
	purpose: z.enum(PURPOSES).optional(),
	request: PlaylistFormSchema.optional(),
	generation: GenerationSchema.optional(),
	remote: z
		.object({
			id: z.string().uuid(),
			revision: z.number().int().min(0),
			pending: z.boolean().optional(),
		})
		.optional(),
});

export const DraftSchema = StoredDraft.omit({ isLoading: true }).extend({
	generation: GenerationSchema,
});
export type PlaylistDraft = z.infer<typeof DraftSchema>;
type Draft = PlaylistDraft;

export function editSongs(
	draft: PlaylistDraft,
	songs: PlaylistDraft["songs"],
): PlaylistDraft {
	return {
		...draft,
		songs,
		remote: undefined,
		isExported: false,
		spotifyPlaylistId: undefined,
		isSavedForLater: false,
	};
}

export function emptyDraft(): Draft {
	return {
		name: "Just a moment...",
		id: "",
		description: "",
		length: 0,
		isExported: false,
		isSavedForLater: false,
		songs: [],
		avoidedSongs: [],
		generation: { status: "idle" },
	};
}

export function restoreDraft(
	serialized: string | null,
	onInvalid?: (message: string) => void,
): Draft {
	if (serialized === null) return emptyDraft();
	try {
		const parsed = StoredDraft.parse(JSON.parse(serialized ?? "null"));
		const generation: Generation =
			!parsed.remote &&
			(parsed.generation?.status === "running" || parsed.isLoading)
				? {
						status: "interrupted",
						message:
							"Generation was interrupted. Your received tracks are still here.",
					}
				: (parsed.generation ?? {
						status: parsed.songs.length ? "kept" : "idle",
					});
		const { isLoading: _legacyLoading, ...draft } = parsed;
		return { ...draft, generation };
	} catch {
		onInvalid?.(
			"The saved playlist could not be recovered because its data is invalid.",
		);
		return emptyDraft();
	}
}

export function startGeneration(
	_previous: Draft,
	input: PlaylistFormInput,
	runId: string,
): Draft {
	const request = PlaylistFormSchema.parse(input);
	return {
		...emptyDraft(),
		length: request.trackCount,
		request,
		brief: {
			prompt: request.prompt,
			engine: request.engine,
			creativity: request.creativity,
		},
		purpose: request.purpose,
		generation: { status: "running", runId },
	};
}

export function applyGenerationLine(
	draft: Draft,
	runId: string,
	line: PlaylistLine,
): Draft {
	if (draft.generation.status !== "running" || draft.generation.runId !== runId)
		return draft;
	switch (line.kind) {
		case "id":
			return { ...draft, id: line.id };
		case "name":
			return { ...draft, name: line.name };
		case "description":
			return { ...draft, description: line.description };
		case "intent":
			return { ...draft, intent: line.intent, purpose: line.purpose };
		case "song": {
			const index = draft.songs.findIndex((song) => song.id === line.id);
			const songs = [...draft.songs];
			const old = songs[index];
			if (index < 0) songs.push(line);
			else
				songs[index] =
					old && "songId" in old && old.songId === line.songId
						? { ...old, ...line }
						: line;
			return { ...draft, songs };
		}
		case "evidence":
			return {
				...draft,
				songs: draft.songs.map((song) =>
					song.id === line.id ? { ...song, evidence: line.evidence } : song,
				),
			};
		case "reason":
			return {
				...draft,
				songs: draft.songs.map((song) =>
					song.id === line.id ? { ...song, reason: line.reason } : song,
				),
			};
		case "order":
			return { ...draft, songs: applyOrder(draft.songs, line.ids) };
		case "complete": {
			const ids = new Set(line.songIds);
			const resolved = draft.songs.filter(
				(song) => "songId" in song && song.songId,
			).length;
			const confirmed =
				draft.id === line.id &&
				ids.size === line.songIds.length &&
				ids.size === draft.songs.length &&
				draft.songs.every((song) => ids.has(song.id));
			return {
				...draft,
				generation:
					confirmed && resolved === draft.length && ids.size === draft.length
						? { status: "complete" }
						: {
								status: "interrupted",
								message: confirmed
									? `Only ${resolved} of ${draft.length} requested tracks were resolved. You can keep them or generate again.`
									: "The final playlist could not be verified. Your received tracks are still here.",
							},
			};
		}
		default:
			return draft;
	}
}

/** EOF is not an acknowledgement. A complete line is the sole success signal. */
export async function readGeneration(
	response: Response,
	signal: AbortSignal,
	onLine: (line: PlaylistLine) => unknown,
): Promise<void> {
	if (!response.ok || !response.body)
		throw new Error(`Generation request failed (${response.status}).`);
	const reader = response.body.getReader();
	const abort = () => {
		void reader.cancel().catch(() => {});
	};
	signal.addEventListener("abort", abort, { once: true });
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let partial = "";
	const consume = async (text: string) => {
		if (!text.trim()) return false;
		const line = PlaylistLineSchema.parse(JSON.parse(text));
		await onLine(line);
		return line.kind === "complete";
	};
	try {
		while (true) {
			signal.throwIfAborted();
			const { value, done } = await reader.read();
			signal.throwIfAborted();
			partial += done
				? decoder.decode()
				: decoder.decode(value, { stream: true });
			if (partial.length > 2_000_000)
				throw new Error("Generation stream exceeded its line limit.");
			const lines = partial.split("\n");
			partial = lines.pop() ?? "";
			for (const line of lines) if (await consume(line)) return;
			if (done) {
				if (await consume(partial)) return;
				throw new Error("Connection ended before generation was confirmed.");
			}
		}
	} finally {
		signal.removeEventListener("abort", abort);
		void reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
