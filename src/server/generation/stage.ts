import type { z } from "zod";
import type { RunState } from "~/lib/generation-run";
import type { PlaylistLine } from "~/lib/playlist-stream";
import { generationEvent } from "./diagnostics";
import type { RunRepository } from "./run-repository";

export class StageBusyError extends Error {}
export class AmbiguousStageError extends Error {}

/** The database reservation, not SDK delivery count, decides whether work may run. */
export async function executeStage<T>(
	repository: RunRepository,
	id: string,
	owner: string,
	stage: {
		phase: Exclude<RunState["phase"], "queued">;
		paid: boolean;
		schema: z.ZodType<T>;
		prepare?: (signal: AbortSignal) => Promise<void>;
		operation: (signal: AbortSignal, attempt: string) => Promise<T>;
		progress?: (output: T) => PlaylistLine[];
	},
): Promise<T> {
	const reservation = await repository.beginStage(
		id,
		owner,
		stage.phase,
		stage.paid && !stage.prepare,
	);
	generationEvent("stage-reservation", {
		generationId: id,
		workerId: owner,
		phase: stage.phase,
		status: reservation.status,
		...(reservation.status === "acquired"
			? { attempt: reservation.attempt }
			: {}),
	});
	if (reservation.status === "completed")
		return stage.schema.parse(reservation.output);
	if (reservation.status === "busy")
		throw new StageBusyError("Stage is already running");
	const ambiguous = async () => {
		generationEvent("paid-outcome-ambiguous", {
			generationId: id,
			workerId: owner,
			phase: stage.phase,
		});
		await repository.fail(id, owner, {
			code: "ambiguous",
			message:
				"A paid request has an uncertain outcome. Saved progress is retained; it will not be charged again automatically.",
		});
		return new AmbiguousStageError("Paid stage outcome is uncertain");
	};
	if (reservation.status === "ambiguous") throw await ambiguous();
	const cancellation = new AbortController();
	const signal = AbortSignal.any([
		cancellation.signal,
		AbortSignal.timeout(Math.max(1, reservation.deadline - Date.now())),
	]);
	const timer = setInterval(() => {
		void repository
			.worker(id)
			.then((row) => {
				if (!row || row.run.finishedAt !== null || row.run.workerId !== owner)
					cancellation.abort();
			})
			.catch(() => cancellation.abort());
	}, 2000);
	let paidStarted = stage.paid && !stage.prepare;
	try {
		await stage.prepare?.(signal);
		signal.throwIfAborted();
		if (stage.paid && !paidStarted) {
			await repository.markStagePaid(
				id,
				owner,
				stage.phase,
				reservation.attempt,
			);
			paidStarted = true;
		}
		const output = stage.schema.parse(
			await stage.operation(signal, reservation.attempt),
		);
		signal.throwIfAborted();
		await repository.completeStage(
			id,
			owner,
			stage.phase,
			reservation.attempt,
			output,
			stage.progress?.(output),
		);
		return output;
	} catch (error) {
		// The transaction may have committed even when its acknowledgement was lost.
		const confirmed = await repository.confirmedStage(id, owner, stage.phase);
		if (confirmed) {
			generationEvent("checkpoint-reused-after-ack-loss", {
				generationId: id,
				workerId: owner,
				phase: stage.phase,
			});
			return stage.schema.parse(confirmed.output);
		}
		if (paidStarted) throw await ambiguous();
		await repository.releaseStage(id, stage.phase, reservation.attempt);
		throw error;
	} finally {
		clearInterval(timer);
		cancellation.abort();
	}
}
