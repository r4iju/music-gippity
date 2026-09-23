import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
	type PlaylistFormInput,
	PlaylistFormSchema,
} from "~/app/dashboard/create-playlist/playlist-form-schema";
import type { GenerationNotification } from "~/lib/generation-notification";
import {
	ActivePhaseSchema,
	activeRun,
	PlaylistContentsSchema,
	presentGeneration,
	type RunState,
	RunStateSchema,
} from "~/lib/generation-run";
import { GenerationSnapshotSchema } from "~/lib/generation-snapshot";
import {
	applyGenerationLine,
	emptyDraft,
	startGeneration,
} from "~/lib/playlist-generation";
import { type PlaylistLine, PlaylistLineSchema } from "~/lib/playlist-stream";
import * as schema from "~/server/schema";
import { generationEvent } from "./diagnostics";
import { GenerationConflictError } from "./repository";

const runs = schema.generationRuns;
const playlists = schema.playlistDrafts;
const checkpoints = schema.generationCheckpoints;
// External-call deadlines are shorter; these bounds include persistence and retry handoff.
const STAGE_BOUNDS_MS: Record<Exclude<RunState["phase"], "queued">, number> = {
	intent: 30_000,
	retrieval: 120_000,
	curation: 420_000,
	resolution: 180_000,
	checking: 180_000,
	repair: 420_000,
	rerank: 60_000,
	finalization: 30_000,
};
type Database = LibSQLDatabase<typeof schema>;
type Joined = {
	run: typeof runs.$inferSelect;
	playlist: typeof playlists.$inferSelect;
};
const toSnapshot = ({ run, playlist }: Joined) =>
	GenerationSnapshotSchema.parse({
		playlist: {
			...PlaylistContentsSchema.parse(playlist.contents),
			generation: presentGeneration(run.id, RunStateSchema.parse(run.state)),
		},
		generation: { id: run.id, state: run.state },
		revision: playlist.revision,
		createdAt: playlist.createdAt,
		updatedAt: playlist.updatedAt,
	});

/** Separate durable content and execution records, committed in the same transaction. */
export class RunRepository {
	constructor(
		private db: Database,
		private onCommit?: (notification: GenerationNotification) => void,
	) {}
	private notify(notification: GenerationNotification | undefined) {
		try {
			if (notification) generationEvent("committed", notification);
			if (notification) this.onCommit?.(notification);
		} catch {
			/* Notifications never own execution. */
		}
	}
	private async joined(db: Pick<Database, "select">, id: string) {
		const [row] = await db
			.select({ run: runs, playlist: playlists })
			.from(runs)
			.innerJoin(playlists, eq(runs.playlistId, playlists.id))
			.where(eq(runs.id, id));
		if (!row) return null;
		return {
			run: { ...row.run, state: RunStateSchema.parse(row.run.state) },
			playlist: {
				...row.playlist,
				contents: PlaylistContentsSchema.parse(row.playlist.contents),
			},
		};
	}
	async create(userId: string, requestKey: string, input: PlaylistFormInput) {
		const request = PlaylistFormSchema.parse(input);
		return this.db.transaction(
			async (tx) => {
				const [existing] = await tx
					.select()
					.from(runs)
					.where(and(eq(runs.userId, userId), eq(runs.requestKey, requestKey)));
				if (existing) {
					const row = await this.joined(tx, existing.id);
					if (
						!row ||
						JSON.stringify(row.playlist.contents.request) !==
							JSON.stringify(request)
					)
						throw new GenerationConflictError(
							"Request key belongs to different settings",
						);
					return toSnapshot(row);
				}
				const id = crypto.randomUUID();
				const playlistId = crypto.randomUUID();
				const now = Date.now();
				const contents = PlaylistContentsSchema.parse({
					...startGeneration(emptyDraft(), request, id),
					id: playlistId,
				});
				await tx.insert(playlists).values({
					id: playlistId,
					userId,
					contents,
					createdAt: now,
					updatedAt: now,
				});
				await tx.insert(runs).values({
					id,
					playlistId,
					userId,
					requestKey,
					state: { status: "queued", phase: "queued" },
					createdAt: now,
					updatedAt: now,
				});
				const row = await this.joined(tx, id);
				if (!row) throw new Error("Generation was not created");
				return toSnapshot(row);
			},
			{ behavior: "immediate" },
		);
	}
	async read(userId: string, playlistId: string) {
		const [run] = await this.db
			.select({ id: runs.id })
			.from(runs)
			.where(and(eq(runs.userId, userId), eq(runs.playlistId, playlistId)));
		const row = run ? await this.joined(this.db, run.id) : null;
		return row ? toSnapshot(row) : null;
	}
	async worker(id: string) {
		return this.joined(this.db, id);
	}
	async history(userId: string) {
		const rows = await this.db
			.select({ run: runs, playlist: playlists })
			.from(runs)
			.innerJoin(playlists, eq(runs.playlistId, playlists.id))
			.where(eq(runs.userId, userId))
			.orderBy(desc(playlists.createdAt))
			.limit(30);
		return rows.map((row) => {
			const s = toSnapshot(row);
			return {
				id: s.playlist.id,
				name: s.playlist.name,
				prompt: s.playlist.request?.prompt ?? "",
				status: s.playlist.generation.status,
				createdAt: s.createdAt,
			};
		});
	}
	async reserveDispatch(id: string) {
		const rows = await this.db
			.update(runs)
			.set({ dispatchUntil: Date.now() + 20_000 })
			.where(
				and(
					eq(runs.id, id),
					isNull(runs.startedAt),
					isNull(runs.finishedAt),
					lte(runs.dispatchUntil, Date.now()),
				),
			)
			.returning({ id: runs.id });
		return rows.length > 0;
	}
	async claim(id: string, owner: string) {
		return this.db.transaction(
			async (tx) => {
				const row = await this.joined(tx, id);
				if (row?.run.workerId === owner && row.run.finishedAt === null)
					return row;
				if (!row || row.run.startedAt !== null || row.run.finishedAt !== null)
					return null;
				await tx
					.update(runs)
					.set({
						workerId: owner,
						startedAt: Date.now(),
						deadline: Date.now() + 10 * 60_000,
						state: { status: "running", phase: "intent" },
						updatedAt: Date.now(),
					})
					.where(eq(runs.id, id));
				await tx
					.update(playlists)
					.set({ revision: row.playlist.revision + 1, updatedAt: Date.now() })
					.where(eq(playlists.id, row.playlist.id));
				return this.joined(tx, id);
			},
			{ behavior: "immediate" },
		);
	}
	/** Reserve a phase before any external work. A paid reservation is never stolen. */
	async beginStage(
		id: string,
		owner: string,
		phase: Exclude<RunState["phase"], "queued">,
		paid: boolean,
	) {
		let notification: GenerationNotification | undefined;
		const result = await this.db.transaction(
			async (tx) => {
				const row = await this.joined(tx, id);
				if (!row || row.run.workerId !== owner || row.run.finishedAt !== null)
					throw new Error("Generation is no longer active");
				const key = `${id}:${phase}`;
				const [saved] = await tx
					.select()
					.from(checkpoints)
					.where(eq(checkpoints.id, key));
				if (saved?.version !== undefined && saved.version !== 1)
					throw new Error("Unsupported checkpoint version");
				if (saved?.completedAt !== null && saved?.completedAt !== undefined)
					return { status: "completed" as const, output: saved.output };
				if (saved && saved.deadline > Date.now())
					return { status: "busy" as const };
				if (saved?.paid) return { status: "ambiguous" as const };
				const attempt = crypto.randomUUID();
				const deadline = Date.now() + STAGE_BOUNDS_MS[phase];
				await tx
					.insert(checkpoints)
					.values({ id: key, runId: id, phase, attempt, paid, deadline })
					.onConflictDoUpdate({
						target: checkpoints.id,
						set: { attempt, paid, deadline },
					});
				await tx
					.update(runs)
					.set({
						state: { status: "running", phase },
						deadline: deadline + 60_000,
						updatedAt: Date.now(),
					})
					.where(eq(runs.id, id));
				await tx
					.update(playlists)
					.set({ revision: row.playlist.revision + 1, updatedAt: Date.now() })
					.where(eq(playlists.id, row.playlist.id));
				notification = {
					playlistId: row.playlist.id,
					revision: row.playlist.revision + 1,
					phase,
				};
				return { status: "acquired" as const, attempt, deadline };
			},
			{ behavior: "immediate" },
		);
		this.notify(notification);
		return result;
	}
	async completeStage(
		id: string,
		owner: string,
		phase: string,
		attempt: string,
		output: unknown,
		progress: PlaylistLine[] = [],
	) {
		let notification: GenerationNotification | undefined;
		await this.db.transaction(
			async (tx) => {
				const row = await this.joined(tx, id);
				if (!row || row.run.workerId !== owner || row.run.finishedAt !== null)
					throw new Error("Generation is no longer active");
				const updated = await tx
					.update(checkpoints)
					.set({ output, completedAt: Date.now() })
					.where(
						and(
							eq(checkpoints.id, `${id}:${phase}`),
							eq(checkpoints.attempt, attempt),
							isNull(checkpoints.completedAt),
						),
					)
					.returning({ id: checkpoints.id });
				if (!updated.length)
					throw new Error("Stage no longer owns this update");
				let draft = toSnapshot(row).playlist;
				for (const line of progress)
					draft = applyGenerationLine(
						draft,
						id,
						PlaylistLineSchema.parse(line),
					);
				await tx
					.update(playlists)
					.set({
						contents: PlaylistContentsSchema.parse(draft),
						revision: row.playlist.revision + 1,
						updatedAt: Date.now(),
					})
					.where(eq(playlists.id, row.playlist.id));
				notification = {
					playlistId: row.playlist.id,
					revision: row.playlist.revision + 1,
					phase: row.run.state.phase,
				};
			},
			{ behavior: "immediate" },
		);
		this.notify(notification);
	}
	async markStagePaid(
		id: string,
		owner: string,
		phase: string,
		attempt: string,
	) {
		await this.db.transaction(
			async (tx) => {
				const row = await this.joined(tx, id);
				if (!row || row.run.workerId !== owner || row.run.finishedAt !== null)
					throw new Error("Generation is no longer active");
				const changed = await tx
					.update(checkpoints)
					.set({ paid: true })
					.where(
						and(
							eq(checkpoints.id, `${id}:${phase}`),
							eq(checkpoints.attempt, attempt),
							isNull(checkpoints.completedAt),
						),
					)
					.returning({ id: checkpoints.id });
				if (!changed.length)
					throw new Error("Stage no longer owns this update");
			},
			{ behavior: "immediate" },
		);
	}
	async confirmedStage(id: string, owner: string, phase: string) {
		const row = await this.worker(id);
		if (!row || row.run.workerId !== owner || row.run.finishedAt !== null)
			return null;
		const [saved] = await this.db
			.select()
			.from(checkpoints)
			.where(eq(checkpoints.id, `${id}:${phase}`));
		return saved?.version === 1 && saved.completedAt !== null
			? { output: saved.output }
			: null;
	}
	async releaseStage(id: string, phase: string, attempt: string) {
		await this.db
			.update(checkpoints)
			.set({ deadline: 0 })
			.where(
				and(
					eq(checkpoints.id, `${id}:${phase}`),
					eq(checkpoints.attempt, attempt),
					eq(checkpoints.paid, false),
					isNull(checkpoints.completedAt),
				),
			);
	}
	private async mutate(
		id: string,
		owner: string | null,
		change: (
			row: Joined,
			tx: Pick<Database, "select">,
		) =>
			| {
					contents: Joined["playlist"]["contents"];
					state: RunState;
			  }
			| Promise<{ contents: Joined["playlist"]["contents"]; state: RunState }>,
		stage?: { phase: string; attempt: string },
	) {
		const snapshot = await this.db.transaction(
			async (tx) => {
				const row = await this.joined(tx, id);
				if (!row || row.run.workerId !== owner || row.run.finishedAt !== null)
					throw new Error("Generation no longer owns this update");
				if (stage) {
					const [checkpoint] = await tx
						.select()
						.from(checkpoints)
						.where(eq(checkpoints.id, `${id}:${stage.phase}`));
					if (
						row.run.state.phase !== stage.phase ||
						checkpoint?.attempt !== stage.attempt ||
						checkpoint.completedAt !== null ||
						checkpoint.deadline <= Date.now()
					)
						throw new Error("Stage no longer owns this progress");
				}
				const next = await change(row, tx);
				const state = RunStateSchema.parse(next.state);
				await tx
					.update(playlists)
					.set({
						contents: PlaylistContentsSchema.parse(next.contents),
						revision: row.playlist.revision + 1,
						updatedAt: Date.now(),
					})
					.where(eq(playlists.id, row.playlist.id));
				await tx
					.update(runs)
					.set({
						state,
						finishedAt: activeRun(state) ? null : Date.now(),
						updatedAt: Date.now(),
					})
					.where(eq(runs.id, id));
				const updated = await this.joined(tx, id);
				if (!updated) throw new Error("Generation disappeared");
				return toSnapshot(updated);
			},
			{ behavior: "immediate" },
		);
		if (snapshot.generation)
			this.notify({
				playlistId: snapshot.playlist.id,
				revision: snapshot.revision,
				phase: snapshot.generation.state.phase,
			});
		return snapshot;
	}
	async append(
		id: string,
		owner: string,
		input: PlaylistLine,
		stage?: { phase: string; attempt: string },
	) {
		const line = PlaylistLineSchema.parse(input);
		return this.mutate(
			id,
			owner,
			(row) => {
				if (line.kind === "id" && line.id !== row.playlist.id)
					throw new Error("Wrong playlist identity");
				const draft = applyGenerationLine(toSnapshot(row).playlist, id, line);
				const state: RunState =
					draft.generation.status === "complete"
						? { status: "completed", phase: "finalization" }
						: draft.generation.status === "interrupted"
							? {
									status: "failed",
									phase: ActivePhaseSchema.parse(row.run.state.phase),
									failure: {
										code: "invalid",
										message: draft.generation.message,
									},
								}
							: row.run.state;
				return { contents: PlaylistContentsSchema.parse(draft), state };
			},
			stage,
		);
	}
	async fail(
		id: string,
		owner: string,
		failure: Extract<RunState, { status: "failed" }>["failure"],
	) {
		const row = await this.worker(id);
		if (!row || row.run.workerId !== owner || row.run.finishedAt !== null)
			return;
		return this.mutate(id, owner, (current) => ({
			contents: current.playlist.contents,
			state: {
				status: "failed",
				phase: ActivePhaseSchema.parse(current.run.state.phase),
				failure,
			},
		}));
	}
	async cancel(userId: string, playlistId: string) {
		const snapshot = await this.read(userId, playlistId);
		if (!snapshot?.generation) return null;
		for (let attempt = 0; attempt < 5; attempt++) {
			const row = await this.worker(snapshot.generation.id);
			if (!row) return null;
			if (row.run.finishedAt !== null) return toSnapshot(row);
			try {
				return await this.mutate(row.run.id, row.run.workerId, (current) => ({
					contents: current.playlist.contents,
					state: { status: "cancelled", phase: current.run.state.phase },
				}));
			} catch (error) {
				if (attempt === 4) throw error;
			}
		}
		return null;
	}
	async expire(id: string, owner: string) {
		return this.mutate(id, owner, async (row, tx) => {
			if (row.run.deadline === null || row.run.deadline > Date.now())
				throw new Error("Generation is still within its stage deadline");
			const [checkpoint] = await tx
				.select()
				.from(checkpoints)
				.where(
					and(
						eq(checkpoints.id, `${id}:${row.run.state.phase}`),
						isNull(checkpoints.completedAt),
					),
				);
			const ambiguous =
				checkpoint?.paid && checkpoint.phase === row.run.state.phase;
			return {
				contents: row.playlist.contents,
				state: {
					status: "failed",
					phase: ActivePhaseSchema.parse(row.run.state.phase),
					failure: {
						code: ambiguous ? "ambiguous" : "timeout",
						message: ambiguous
							? "A paid request has an uncertain outcome. Saved progress is retained; it will not be charged again automatically."
							: "The stage timed out. Saved recordings are retained; generate another playlist to try again.",
					},
				},
			};
		});
	}
	async finalize(id: string, owner: string) {
		const snapshot = await this.db.transaction(
			async (tx) => {
				const row = await this.joined(tx, id);
				if (!row || row.run.workerId !== owner)
					throw new Error("Generation no longer owns finalization");
				if (row.run.finishedAt !== null) return toSnapshot(row);
				const savedCheckpoints = await tx
					.select()
					.from(checkpoints)
					.where(eq(checkpoints.runId, id));
				const required = [
					"intent",
					"retrieval",
					"curation",
					"resolution",
					"checking",
					"repair",
					"rerank",
				];
				if (
					row.run.state.phase !== "rerank" ||
					required.some(
						(phase) =>
							!savedCheckpoints.some(
								(checkpoint) =>
									checkpoint.phase === phase &&
									checkpoint.version === 1 &&
									checkpoint.completedAt !== null,
							),
					)
				)
					throw new Error("Validation checkpoints are incomplete");
				const draft = applyGenerationLine(toSnapshot(row).playlist, id, {
					kind: "complete",
					id: row.playlist.id,
					songIds: row.playlist.contents.songs.map((song) => song.id),
				});
				const state: RunState =
					draft.generation.status === "complete"
						? { status: "completed", phase: "finalization" }
						: {
								status: "failed",
								phase: "finalization",
								failure: {
									code: "invalid",
									message:
										draft.generation.status === "interrupted"
											? draft.generation.message
											: "Final recordings could not be verified.",
								},
							};
				const now = Date.now();
				await tx.insert(checkpoints).values({
					id: `${id}:finalization`,
					runId: id,
					phase: "finalization",
					attempt: crypto.randomUUID(),
					paid: false,
					deadline: now,
					completedAt: now,
					output: { songIds: draft.songs.map((song) => song.id) },
				});
				await tx
					.update(playlists)
					.set({
						contents: PlaylistContentsSchema.parse(draft),
						revision: row.playlist.revision + 1,
						updatedAt: now,
					})
					.where(eq(playlists.id, row.playlist.id));
				await tx
					.update(runs)
					.set({ state, finishedAt: now, updatedAt: now })
					.where(eq(runs.id, id));
				const saved = await this.joined(tx, id);
				if (!saved) throw new Error("Generation disappeared");
				return toSnapshot(saved);
			},
			{ behavior: "immediate" },
		);
		if (snapshot.generation)
			this.notify({
				playlistId: snapshot.playlist.id,
				revision: snapshot.revision,
				phase: snapshot.generation.state.phase,
			});
		return snapshot;
	}
	async due() {
		return this.db
			.select()
			.from(runs)
			.where(
				and(
					isNull(runs.finishedAt),
					or(
						and(isNull(runs.startedAt), lte(runs.dispatchUntil, Date.now())),
						lte(runs.deadline, Date.now()),
					),
				),
			)
			.limit(100);
	}
}
