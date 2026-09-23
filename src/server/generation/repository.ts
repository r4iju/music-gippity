import { and, asc, desc, eq, isNull, lte, or } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
	type PlaylistFormInput,
	PlaylistFormSchema,
} from "~/app/dashboard/create-playlist/playlist-form-schema";
import {
	type GenerationSnapshot,
	GenerationSnapshotSchema,
	isGenerating,
} from "~/lib/generation-snapshot";
import {
	applyGenerationLine,
	DraftSchema,
	emptyDraft,
	type PlaylistDraft,
	startGeneration,
} from "~/lib/playlist-generation";
import type { PlaylistLine } from "~/lib/playlist-stream";
import * as schema from "~/server/schema";

const table = schema.playlistGenerations;
type Row = typeof table.$inferSelect;
export class GenerationConflictError extends Error {}
const snapshot = (row: Row): GenerationSnapshot =>
	GenerationSnapshotSchema.parse({
		playlist: row.state,
		revision: row.revision,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	});

/** One row is the atomic snapshot + revision. Worker ownership fences all progress writes. */
export class GenerationRepository {
	constructor(private db: LibSQLDatabase<typeof schema>) {}
	async create(userId: string, id: string, input: PlaylistFormInput) {
		const request = PlaylistFormSchema.parse(input);
		const now = Date.now();
		const draft = startGeneration(emptyDraft(), request, id);
		await this.db
			.insert(table)
			.values({
				id,
				userId,
				state: { ...draft, id, generation: { status: "queued", runId: id } },
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing();
		const existing = await this.read(userId, id);
		if (
			!existing ||
			JSON.stringify(existing.playlist.request) !== JSON.stringify(request)
		)
			throw new GenerationConflictError(
				"Request key already belongs to another generation",
			);
		return existing;
	}
	async read(userId: string, id: string) {
		const [row] = await this.db
			.select()
			.from(table)
			.where(and(eq(table.id, id), eq(table.userId, userId)));
		return row ? snapshot(row) : null;
	}
	async list(userId: string) {
		return (
			await this.db
				.select()
				.from(table)
				.where(eq(table.userId, userId))
				.orderBy(desc(table.createdAt))
				.limit(30)
		).map((row) => {
			const state = DraftSchema.parse(row.state);
			return {
				id: row.id,
				name: state.name,
				prompt: state.request?.prompt ?? "",
				status: state.generation.status,
				createdAt: row.createdAt,
			};
		});
	}
	async workerRow(id: string) {
		const [row] = await this.db.select().from(table).where(eq(table.id, id));
		return row ? { ...row, state: DraftSchema.parse(row.state) } : null;
	}
	/** The generation row is the outbox; no viewer is needed to recover dispatch. */
	async recoveryCandidates() {
		const now = Date.now();
		return this.db
			.select({
				id: table.id,
				userId: table.userId,
				workerId: table.workerId,
				startedAt: table.startedAt,
			})
			.from(table)
			.where(
				and(
					isNull(table.finishedAt),
					or(
						and(isNull(table.startedAt), lte(table.dispatchUntil, now)),
						lte(table.startedAt, now - 10 * 60_000),
					),
				),
			)
			.orderBy(asc(table.dispatchUntil), asc(table.createdAt))
			.limit(100);
	}
	async reserveDispatch(userId: string, id: string) {
		const rows = await this.db
			.update(table)
			.set({ dispatchUntil: Date.now() + 20_000 })
			.where(
				and(
					eq(table.id, id),
					eq(table.userId, userId),
					isNull(table.startedAt),
					isNull(table.finishedAt),
					lte(table.dispatchUntil, Date.now()),
				),
			)
			.returning({ id: table.id });
		return rows.length > 0;
	}
	async claim(id: string, workerId: string) {
		const row = await this.workerRow(id);
		if (!row || row.startedAt !== null || row.finishedAt !== null) return null;
		const [claimed] = await this.db
			.update(table)
			.set({
				workerId,
				startedAt: Date.now(),
				updatedAt: Date.now(),
				revision: row.revision + 1,
				state: { ...row.state, generation: { status: "running", runId: id } },
			})
			.where(
				and(
					eq(table.id, id),
					eq(table.revision, row.revision),
					isNull(table.startedAt),
					isNull(table.finishedAt),
				),
			)
			.returning();
		return claimed ?? null;
	}
	private async write(row: Row, state: PlaylistDraft, workerId: string | null) {
		const finishedAt = isGenerating(state.generation.status)
			? null
			: Date.now();
		const [updated] = await this.db
			.update(table)
			.set({
				state,
				revision: row.revision + 1,
				updatedAt: Date.now(),
				finishedAt,
			})
			.where(
				and(
					eq(table.id, row.id),
					eq(table.revision, row.revision),
					isNull(table.finishedAt),
					workerId === null
						? isNull(table.workerId)
						: eq(table.workerId, workerId),
				),
			)
			.returning();
		if (!updated) throw new Error("Generation no longer owns this update");
		return snapshot(updated);
	}
	async append(id: string, workerId: string, line: PlaylistLine) {
		const row = await this.workerRow(id);
		if (!row || row.workerId !== workerId || row.finishedAt !== null)
			throw new Error("Generation is no longer active");
		const state = applyGenerationLine(row.state, id, line);
		return state === row.state
			? snapshot(row)
			: this.write(row, state, workerId);
	}
	async fail(id: string, workerId: string, message: string) {
		const row = await this.workerRow(id);
		if (!row || row.workerId !== workerId || row.finishedAt !== null) return;
		await this.write(
			row,
			{ ...row.state, generation: { status: "interrupted", message } },
			workerId,
		);
	}
	async cancel(userId: string, id: string) {
		for (let attempt = 0; attempt < 5; attempt++) {
			const row = await this.workerRow(id);
			if (!row || row.userId !== userId) return null;
			if (row.finishedAt !== null) return snapshot(row);
			try {
				return await this.write(
					row,
					{
						...row.state,
						generation: {
							status: "interrupted",
							message:
								"Generation cancelled. Your saved tracks are still here.",
						},
					},
					row.workerId,
				);
			} catch {
				if (attempt === 4)
					throw new Error("Cancellation conflicted; please retry");
			}
		}
		return null;
	}
}
