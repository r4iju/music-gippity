import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { PlaylistFormInput } from "~/app/dashboard/create-playlist/playlist-form-schema";
import type { GenerationNotification } from "~/lib/generation-notification";
import type * as schema from "~/server/schema";
import { generationEvent } from "./diagnostics";
import { recoverGenerations } from "./recovery";
import { GenerationRepository } from "./repository";
import { RunRepository } from "./run-repository";

/** Product interface: execution and transport recovery never belong to a screen. */
export class GenerationModule {
	private legacy: GenerationRepository;
	private runs: RunRepository;
	constructor(
		db: LibSQLDatabase<typeof schema>,
		private start: (id: string) => Promise<unknown>,
		private startLegacy?: (id: string) => Promise<unknown>,
		private stream?: (
			workerId: string,
			cursor: number,
		) => ReadableStream<GenerationNotification>,
	) {
		this.legacy = new GenerationRepository(db);
		this.runs = new RunRepository(db);
	}
	private dispatch = async (id: string) => {
		if (await this.runs.reserveDispatch(id)) {
			generationEvent("dispatch", { generationId: id });
			await this.start(id);
		}
	};
	private dispatchLegacy = async (userId: string, id: string) => {
		if (this.startLegacy && (await this.legacy.reserveDispatch(userId, id)))
			await this.startLegacy(id);
	};
	async create(userId: string, key: string, input: PlaylistFormInput) {
		const snapshot = await this.runs.create(userId, key, input);
		if (!snapshot.generation) throw new Error("Missing generation");
		generationEvent("create-acknowledged", {
			playlistId: snapshot.playlist.id,
			generationId: snapshot.generation.id,
		});
		try {
			await this.dispatch(snapshot.generation.id);
		} catch {
			generationEvent("dispatch-deferred", {
				generationId: snapshot.generation.id,
			});
			/* Durable dispatch is retried by cron, independently of the viewer. */
		}
		return snapshot;
	}
	async observe(userId: string, id: string) {
		const snapshot = await this.runs.read(userId, id);
		if (snapshot) return snapshot;
		const legacy = await this.legacy.read(userId, id);
		if (legacy?.playlist.generation.status === "queued") {
			try {
				await this.dispatchLegacy(userId, id);
			} catch {
				/* Legacy outbox remains recoverable by cron. */
			}
		}
		return legacy;
	}
	async cancel(userId: string, id: string) {
		generationEvent("cancel-requested", { playlistId: id });
		return (
			(await this.runs.cancel(userId, id)) ?? this.legacy.cancel(userId, id)
		);
	}
	async notifications(userId: string, id: string, cursor: number) {
		const snapshot = await this.runs.read(userId, id);
		if (!snapshot?.generation || !this.stream) return null;
		const row = await this.runs.worker(snapshot.generation.id);
		return row?.run.workerId ? this.stream(row.run.workerId, cursor) : null;
	}
	async history(userId: string) {
		const [current, legacy] = await Promise.all([
			this.runs.history(userId),
			this.legacy.list(userId),
		]);
		return [...current, ...legacy]
			.sort((a, b) => b.createdAt - a.createdAt)
			.slice(0, 30);
	}
	async recover() {
		const result = await recoverGenerations(this.legacy, this.dispatchLegacy);
		for (const row of await this.runs.due()) {
			try {
				if (row.startedAt === null) {
					await this.dispatch(row.id);
					result.dispatched++;
				} else if (row.workerId) {
					await this.runs.expire(row.id, row.workerId);
					result.interrupted++;
				}
			} catch {
				result.failed++;
			}
		}
		return result;
	}
}
