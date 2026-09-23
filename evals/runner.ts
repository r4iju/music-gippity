import type { Song } from "~/contexts/playlist-provider";
import { CREATIVITY } from "~/lib/creativity";
import { ENGINES, type EngineId } from "~/lib/engines";
import type { Intent } from "~/lib/intent";
import { applyOrder } from "~/lib/playlist-order";
import type {
	BudgetEvent,
	CandidatesEvent,
	NoveltyEvent,
	RepairEvent,
	RerankEvent,
} from "~/lib/playlist-stream";
import {
	CANDIDATE_SOURCES,
	type CandidateSource,
	PlaylistLineSchema,
	type PopularityEvent,
} from "~/lib/playlist-stream";
import { type PopularitySummary, summarizePopularity } from "~/lib/popularity";
import type { Purpose } from "~/lib/purpose";
import type { ResolutionTier } from "~/lib/resolution";
import {
	curatorSystemPrompt,
	playlistPrompt,
} from "~/server/api/engines/common";
import type { Listener } from "~/server/api/listener";
import type {
	VocalRepairEvent,
	VocalReviewEvent,
} from "~/server/api/vocal-repair";
import type { EvalCase } from "./cases";

const { createPlaylist } = await import("~/server/api/create-playlist");

export interface RunResult {
	intent: Intent | null;
	vocalReviews: VocalReviewEvent[];
	vocalRepairs: VocalRepairEvent[];
	/** Hard-rule breaches found in evidence and what was done about them. */
	repairs: RepairEvent[];
	/** The lookup round; absent when the brief did not call for one. */
	candidates?: CandidatesEvent;
	/** Final songs matching an offered candidate. */
	candidateUse: number;
	/** Final songs matching an offered candidate, by its source; absent in older results. */
	candidateUseBySource?: Record<CandidateSource, number>;
	/** Final songs the curator declared it took from the candidates; absent in older results. */
	fromCandidates?: number;
	/** The rerank call; absent when fewer than two recordings resolved. */
	rerank?: RerankEvent;
	beforeVocalRepair?: Song[];
	beforeVocalRepairMs?: number;
	case: EvalCase;
	brief: string;
	engine: EngineId;
	generation: {
		model: string;
		creativity: EvalCase["creativity"];
		purpose: Purpose;
		temperature: number;
		systemPrompt: string;
		userPrompt: string;
	};
	name: string;
	description: string;
	firstSongMs: number | null;
	totalMs: number;
	tracks: number;
	uniqueArtists: number;
	onSpotify: number;
	/** How many final songs resolved at each tier. */
	resolution: Record<ResolutionTier, number>;
	/** Final songs whose recording is a version the pick did not ask for. */
	drift: number;
	replaced: number;
	/** Final songs that came from the reserve pool rather than the curator. */
	poolFills: number;
	novelty?: NoveltyEvent;
	/** Whether the novelty budget held on the final playlist. */
	budget?: BudgetEvent;
	/** Final songs the listener already knows, and those only by a known artist. */
	known: number;
	knownArtist: number;
	/** How mainstream the resolved recordings are; absent in older results. */
	popularity?: PopularitySummary;
	/** Whether the popularity budget held; absent in older results. */
	popularityBudget?: PopularityEvent;
	emissions: Song[];
	songs: Song[];
}

/** One stream line, rejected when it breaks the contract. */
export const readPlaylistLine = (line: string) => {
	const parsed = PlaylistLineSchema.safeParse(JSON.parse(line));
	if (!parsed.success) throw new Error(`Invalid playlist line: ${line}`);
	return parsed.data;
};

/**
 * Runs one case through the playlist handler. A live eval passes the fixture
 * listener, since its token cannot read an account; a test leaves the
 * session's fakes in place.
 */
export async function runCase(
	evalCase: EvalCase,
	engine: EngineId,
	listener?: Listener,
): Promise<RunResult> {
	const started = performance.now();
	const res = await createPlaylist(
		new Request("http://localhost/api/edge/create-playlist", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				prompt: evalCase.brief,
				trackCount: evalCase.trackCount,
				creativity: evalCase.creativity,
				engine,
				purpose: evalCase.purpose,
			}),
		}),
		listener,
	);
	if (!res.ok || !res.body)
		throw new Error(`${engine} generation HTTP ${res.status}`);
	let name = "";
	let description = "";
	let intent: Intent | null = null;
	let firstSongMs: number | null = null;
	const slots = new Map<string, Song>();
	const replaced = new Set<string>();
	const emissions: Song[] = [];
	const vocalReviews: VocalReviewEvent[] = [];
	const vocalRepairs: VocalRepairEvent[] = [];
	const repairs: RepairEvent[] = [];
	let novelty: NoveltyEvent | undefined;
	let budget: BudgetEvent | undefined;
	let popularityBudget: PopularityEvent | undefined;
	let candidates: CandidatesEvent | undefined;
	let rerank: RerankEvent | undefined;
	let order: string[] | undefined;
	let beforeVocalRepair: Song[] | undefined;
	let beforeVocalRepairMs: number | undefined;
	const consume = (line: string) => {
		if (!line.trim()) return;
		const obj = readPlaylistLine(line);
		if (obj.kind === "intent") intent = obj.intent;
		if (obj.kind === "name") name = obj.name;
		if (obj.kind === "description") description = obj.description;
		if (obj.kind === "vocal-repair") vocalRepairs.push(obj);
		if (obj.kind === "repair") repairs.push(obj);
		if (obj.kind === "novelty") novelty = obj;
		if (obj.kind === "budget") budget = obj;
		if (obj.kind === "popularity") popularityBudget = obj;
		if (obj.kind === "candidates") candidates = obj;
		if (obj.kind === "rerank") rerank = obj;
		if (obj.kind === "order") order = obj.ids;
		if (obj.kind === "reason") {
			const slot = slots.get(obj.id);
			if (slot) slots.set(obj.id, { ...slot, reason: obj.reason });
		}
		if (obj.kind === "evidence") {
			const slot = slots.get(obj.id);
			if (slot) slots.set(obj.id, { ...slot, evidence: obj.evidence });
		}
		if (obj.kind === "vocal-review") {
			if (!beforeVocalRepair) {
				beforeVocalRepair = [...slots.values()].sort(
					(a, b) => a.order - b.order,
				);
				beforeVocalRepairMs = Math.round(
					performance.now() - started - obj.totalMs,
				);
			}
			vocalReviews.push(obj);
		}
		if (obj.kind !== "song") return;
		const song = obj;
		firstSongMs ??= Math.round(performance.now() - started);
		const prior = slots.get(song.id);
		if (prior && (prior.artist !== song.artist || prior.title !== song.title))
			replaced.add(song.id);
		emissions.push(song);
		slots.set(song.id, song);
	};
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) consume(line);
	}
	consume(buffer + decoder.decode());
	const songs = applyOrder(
		[...slots.values()].sort((a, b) => a.order - b.order),
		order ?? [],
	);
	return {
		intent,
		vocalReviews,
		vocalRepairs,
		repairs,
		candidates,
		candidateUse: songs.filter((s) => s.candidate).length,
		candidateUseBySource: Object.fromEntries(
			CANDIDATE_SOURCES.map((source) => [
				source,
				songs.filter((s) => s.candidate === source).length,
			]),
		) as Record<CandidateSource, number>,
		fromCandidates: songs.filter((s) => s.source === "candidates").length,
		rerank,
		beforeVocalRepair,
		beforeVocalRepairMs,
		case: evalCase,
		brief: evalCase.brief,
		engine,
		generation: {
			model: ENGINES[engine].model,
			creativity: evalCase.creativity,
			purpose: evalCase.purpose,
			temperature: CREATIVITY[evalCase.creativity].temperature,
			systemPrompt: curatorSystemPrompt,
			userPrompt: playlistPrompt({
				prompt: evalCase.brief,
				trackCount: evalCase.trackCount,
				creativity: evalCase.creativity,
				purpose: evalCase.purpose,
				candidateArtists: candidates?.artists,
				candidateTracks: candidates?.tracks,
			}),
		},
		name,
		description,
		firstSongMs,
		totalMs: Math.round(performance.now() - started),
		tracks: songs.length,
		uniqueArtists: new Set(songs.map((s) => s.artist.toLowerCase())).size,
		onSpotify: songs.filter((s) => s.songId).length,
		resolution: songs.reduce(
			(funnel, song) => {
				funnel[song.resolution?.tier ?? "unresolved"] += 1;
				return funnel;
			},
			{ exact: 0, normalized: 0, fuzzy: 0, unresolved: 0 },
		),
		drift: songs.filter((s) => s.resolution?.drift).length,
		replaced: replaced.size,
		poolFills: songs.filter((s) => s.origin === "pool").length,
		novelty,
		budget,
		known: songs.filter((s) => s.familiarity === "known").length,
		knownArtist: songs.filter((s) => s.familiarity === "known-artist").length,
		popularity: summarizePopularity(
			songs.filter((s) => s.songId).map((s) => s.evidence),
		),
		popularityBudget,
		emissions,
		songs,
	};
}
