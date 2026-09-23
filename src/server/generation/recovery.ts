import type { GenerationRepository } from "./repository";

/** Retry dispatch only; never replay a worker that may already have incurred model costs. */
export async function recoverGenerations(
	repository: GenerationRepository,
	dispatch: (userId: string, id: string) => Promise<void>,
) {
	const result = { dispatched: 0, interrupted: 0, failed: 0 };
	const candidates = await repository.recoveryCandidates();
	await Promise.all(
		candidates.map(async (row) => {
			try {
				if (row.startedAt === null) {
					await dispatch(row.userId, row.id);
					result.dispatched++;
				} else if (row.workerId) {
					await repository.fail(
						row.id,
						row.workerId,
						"The worker timed out. Your saved tracks are still available.",
					);
					result.interrupted++;
				}
			} catch {
				result.failed++;
			}
		}),
	);
	return result;
}
