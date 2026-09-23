import { z } from "zod";
import {
	type PlaylistFormInput,
	PlaylistFormSchema,
} from "~/app/dashboard/create-playlist/playlist-form-schema";
import type { Song, SourcedSong } from "~/contexts/playlist-provider";
import { artistKey, SlotCaps } from "~/lib/caps";
import { type Evidence, EvidenceSchema } from "~/lib/evidence";
import { applyOrder } from "~/lib/playlist-order";
import {
	type PlaylistLine,
	PlaylistLineSchema,
	type SongOrigin,
	SongSchema,
} from "~/lib/playlist-stream";
import { popularityBudget } from "~/lib/popularity";
import { enrichSongWithSpotify, intoSlot } from "~/server/api/create-playlist";
import { gatherEvidence } from "~/server/api/evidence";
import { familiarityOf } from "~/server/api/known";
import {
	budgetEvent,
	enforceNoveltyBudget,
	noveltyBudget,
} from "~/server/api/novelty";
import {
	enforcePopularityBudget,
	popularityEvent,
} from "~/server/api/popularity";
import { repairFromEvidence } from "~/server/api/repair";
import { suggestReplacement } from "~/server/api/replacement";
import { otherEngine, rerankPlaylist } from "~/server/api/rerank";
import { repairVocalTracks } from "~/server/api/vocal-repair";
import { annotateRecording } from "./provenance";
import { type Research, restoreKnown } from "./research";
import { type Resolved, ResolvedSchema } from "./resolution";

const CheckedSongSchema = SongSchema.extend({
	source: z.enum(["recall", "candidates"]),
	evidence: EvidenceSchema.optional(),
	reason: z.string().optional(),
});
export const CheckedSchema = ResolvedSchema.extend({
	songs: z.array(CheckedSongSchema),
	pool: z.array(CheckedSongSchema),
	evidence: z.array(z.tuple([z.string(), EvidenceSchema])),
	noveltySwaps: z.array(z.string()),
	popularitySwaps: z.array(z.string()),
});
export type Checked = z.infer<typeof CheckedSchema>;
type Publish = (line: PlaylistLine) => Promise<unknown>;

/** Ephemeral helpers reconstructed from a validated checkpoint, never checkpointed themselves. */
class CheckingSession {
	readonly caps: SlotCaps;
	readonly settings;
	readonly known;
	readonly budget;
	private evidenceCache: Map<string, Promise<Evidence>>;
	private writes = Promise.resolve();
	private writeError: unknown;
	constructor(
		readonly state: Checked,
		readonly research: Research,
		input: PlaylistFormInput,
		readonly userId: string,
		readonly token: string,
		readonly signal: AbortSignal,
		private publish: Publish,
	) {
		this.settings = PlaylistFormSchema.parse(input);
		this.known = restoreKnown(research.known).set;
		this.budget = noveltyBudget(
			this.settings.purpose,
			this.settings.trackCount,
		);
		this.caps = new SlotCaps(research.intent);
		state.songs = state.songs.map((song) => annotateRecording(song, research));
		for (const song of state.songs) this.caps.claim(song);
		this.evidenceCache = new Map(
			state.evidence.map(([id, value]) => [id, Promise.resolve(value)]),
		);
	}
	emit = (input: PlaylistLine) => {
		this.signal.throwIfAborted();
		const line = PlaylistLineSchema.parse(
			input.kind === "song" ? annotateRecording(input, this.research) : input,
		);
		if (line.kind === "song") {
			const index = this.state.songs.findIndex((song) => song.id === line.id);
			const old = this.state.songs[index];
			if (this.known) line.familiarity = familiarityOf(this.known, line);
			const song = old?.songId === line.songId ? { ...old, ...line } : line;
			if (index < 0) this.state.songs.push(song);
			else this.state.songs[index] = song;
		} else if (line.kind === "evidence")
			this.state.songs = this.state.songs.map((song) =>
				song.id === line.id ? { ...song, evidence: line.evidence } : song,
			);
		else if (line.kind === "reason")
			this.state.songs = this.state.songs.map((song) =>
				song.id === line.id ? { ...song, reason: line.reason } : song,
			);
		else if (line.kind === "order")
			this.state.songs = applyOrder(this.state.songs, line.ids);
		this.writes = this.writes
			.then(async () => {
				if (!this.writeError) await this.publish(line);
			})
			.catch((error) => {
				this.writeError = error;
			});
	};
	evidenceFor = (song: Song & { songId: string }): Promise<Evidence> => {
		this.signal.throwIfAborted();
		let pending = this.evidenceCache.get(song.songId);
		if (!pending) {
			pending = gatherEvidence({
				isrc: song.resolution?.isrc ?? null,
				title: song.spotifyRecording?.title ?? song.title,
				artist: song.spotifyRecording?.artists[0] ?? song.artist,
				album: song.albumTitle ?? null,
				durationMs: song.spotifyRecording?.durationMs ?? null,
			});
			this.evidenceCache.set(song.songId, pending);
		}
		return pending;
	};
	async withEvidence(song: SourcedSong): Promise<SourcedSong> {
		if (!song.songId) return song;
		const evidence = await this.evidenceFor({ ...song, songId: song.songId });
		this.emit({ kind: "evidence", id: song.id, evidence });
		return { ...song, evidence };
	}
	accept(song: SourcedSong, origin: SongOrigin) {
		this.caps.claim(song);
		this.emit({ ...song, kind: "song", origin });
	}
	async replace(slot: { id: string; order: number }, kept: SourcedSong | null) {
		this.signal.throwIfAborted();
		const { engine, prompt, purpose, creativity } = this.settings;
		const suggestion = await suggestReplacement(
			engine,
			{
				prompt,
				playlistName: this.state.name,
				playlistDescription: this.state.description,
				currentSongs: this.state.songs
					.filter((song) => song.songId)
					.map((song) => ({ artist: song.artist, title: song.title })),
				avoidedSongs: this.state.rejected,
				purpose,
			},
			creativity,
			this.signal,
			this.userId,
			true,
		);
		const artist = suggestion && artistKey(suggestion.artist);
		if (!suggestion || !artist || this.caps.heldElsewhere(artist, slot.id)) {
			if (kept) {
				this.emit({ ...kept, kind: "song" });
				await this.withEvidence(kept);
			}
			return;
		}
		this.caps.hold(artist, slot.id);
		const replacement = {
			...suggestion,
			...slot,
			kind: "song" as const,
			source: "recall" as const,
		};
		this.emit({ ...replacement, origin: "replacement" });
		const enriched = await enrichSongWithSpotify(
			replacement,
			this.token,
			this.research.intent,
		);
		const song = intoSlot(enriched.song, slot);
		if (enriched.status === "found" && this.caps.conflicts(song)) {
			if (kept?.songId) this.caps.claim(kept);
			else this.caps.release(slot.id);
			if (kept) {
				this.emit({ ...kept, kind: "song" });
				await this.withEvidence(kept);
			}
			return;
		}
		this.accept(song, "replacement");
		await this.withEvidence(song);
	}
	async finish() {
		await this.writes;
		if (this.writeError) throw this.writeError;
		this.signal.throwIfAborted();
		this.state.evidence = await Promise.all(
			[...this.evidenceCache].map(
				async ([id, value]) => [id, await value] as [string, Evidence],
			),
		);
		return CheckedSchema.parse(this.state);
	}
}

export async function checkEvidence(
	resolved: Resolved,
	research: Research,
	input: PlaylistFormInput,
	userId: string,
	signal: AbortSignal,
	publish: Publish,
): Promise<Checked> {
	const state = CheckedSchema.parse({
		...resolved,
		evidence: [],
		noveltySwaps: [],
		popularitySwaps: [],
	});
	const session = new CheckingSession(
		state,
		research,
		input,
		userId,
		"",
		signal,
		publish,
	);
	// Evidence for pool recordings is reusable by hard-rule repairs and reranking.
	const songs = [...state.songs, ...state.pool];
	for (let index = 0; index < songs.length; index += 4)
		await Promise.all(
			songs.slice(index, index + 4).map((song) => session.withEvidence(song)),
		);
	return session.finish();
}

export async function repairChecked(
	checked: Checked,
	research: Research,
	input: PlaylistFormInput,
	userId: string,
	token: string,
	signal: AbortSignal,
	publish: Publish,
): Promise<Checked> {
	const state = CheckedSchema.parse(checked);
	const session = new CheckingSession(
		state,
		research,
		input,
		userId,
		token,
		signal,
		publish,
	);
	for (let index = 0; index < state.unfilled.length; index += 4)
		await Promise.all(
			state.unfilled
				.slice(index, index + 4)
				.map((entry) => session.replace(entry.slot, entry.kept)),
		);
	state.unfilled = [];
	const grounded = await repairFromEvidence({
		intent: research.intent,
		songs: [...state.songs],
		pool: state.pool,
		caps: session.caps,
		evidenceFor: session.evidenceFor,
		emit: session.emit,
	});
	for (const song of grounded.replacements) {
		session.accept(song, "repair");
		await session.withEvidence(song);
	}
	for (let index = 0; index < grounded.unfilled.length; index += 4)
		await Promise.all(
			grounded.unfilled
				.slice(index, index + 4)
				.map((song) => session.replace(song, song)),
		);
	const repairs = await repairVocalTracks({
		strict: true,
		userId,
		signal,
		brief: session.settings.prompt,
		intent: research.intent,
		songs: [...state.songs],
		reviewable: state.songs.filter(
			(song) => song.evidence?.instrumental?.value !== true,
		),
		caps: session.caps,
		token,
		emit: session.emit,
	});
	for (const repair of repairs) {
		const song: SourcedSong = { ...repair, source: "recall" };
		session.emit({ ...song, kind: "song", origin: "repair" });
		await session.withEvidence(song);
	}
	const swaps =
		session.budget && session.known
			? await enforceNoveltyBudget({
					budget: session.budget,
					set: session.known,
					intent: research.intent,
					songs: [...state.songs],
					pool: state.pool,
					caps: session.caps,
					evidenceFor: session.evidenceFor,
				})
			: [];
	for (const song of swaps) {
		session.accept(song, "novelty");
		await session.withEvidence(song);
	}
	state.noveltySwaps = swaps.map((song) => song.id);
	const popularity = popularityBudget(
		session.settings.creativity,
		session.settings.purpose,
		state.songs.filter((song) => song.songId).length,
	);
	const popularSwaps = popularity
		? await enforcePopularityBudget({
				budget: popularity,
				intent: research.intent,
				songs: [...state.songs],
				pool: state.pool,
				caps: session.caps,
				evidenceFor: session.evidenceFor,
				accepts: (song) =>
					!session.budget ||
					!session.known ||
					familiarityOf(session.known, song) === "new",
			})
		: [];
	for (const song of popularSwaps) {
		session.accept(song, "popularity");
		await session.withEvidence(song);
	}
	state.popularitySwaps = popularSwaps.map((song) => song.id);
	return session.finish();
}

export async function rerankChecked(
	checked: Checked,
	research: Research,
	input: PlaylistFormInput,
	userId: string,
	signal: AbortSignal,
	publish: Publish,
): Promise<Checked> {
	const state = CheckedSchema.parse(checked);
	const session = new CheckingSession(
		state,
		research,
		input,
		userId,
		"",
		signal,
		publish,
	);
	const { purpose, creativity, prompt, engine } = session.settings;
	const popularity = popularityBudget(
		creativity,
		purpose,
		state.songs.filter((song) => song.songId).length,
	);
	const familiar = (song: SourcedSong) =>
		session.known
			? { ...song, familiarity: familiarityOf(session.known, song) }
			: song;
	await rerankPlaylist({
		strict: true,
		userId,
		signal,
		brief: prompt,
		intent: research.intent,
		purpose,
		popularity,
		engine: otherEngine(engine),
		songs: state.songs.map(familiar),
		pool: state.pool
			.map(familiar)
			.filter(
				(song) =>
					!session.budget || !session.known || song.familiarity === "new",
			),
		caps: session.caps,
		evidenceFor: session.evidenceFor,
		emit: session.emit,
	});
	session.emit(
		budgetEvent({
			budget: session.budget,
			set: session.known,
			songs: state.songs,
			swapped: state.noveltySwaps,
		}),
	);
	session.emit(
		popularityEvent({
			budget: popularity,
			evidence: await Promise.all(
				state.songs.flatMap((song) =>
					song.songId
						? [session.evidenceFor({ ...song, songId: song.songId })]
						: [],
				),
			),
			swapped: state.popularitySwaps,
		}),
	);
	return session.finish();
}
