import { FatalError, getWorkflowMetadata, RetryableError } from "workflow";
import { type Intent, IntentSchema } from "~/lib/intent";
import { readIntent } from "~/server/api/intent";
import {
	type Checked,
	CheckedSchema,
	checkEvidence,
	repairChecked,
	rerankChecked,
} from "~/server/generation/checking";
import {
	type Curated,
	CuratedSchema,
	curatePicks,
} from "~/server/generation/curation";
import { withNotifications } from "~/server/generation/notifications";
import { annotateRecording } from "~/server/generation/provenance";
import {
	type Research,
	ResearchSchema,
	retrieveCandidates,
} from "~/server/generation/research";
import {
	type Resolved,
	ResolvedSchema,
	resolveRecordings,
} from "~/server/generation/resolution";
import {
	AmbiguousStageError,
	executeStage as executeCheckpoint,
	StageBusyError,
} from "~/server/generation/stage";
import { generationRuns } from "~/server/generation/store";
import { getSpotifyToken } from "~/server/spotify-token";

function executeStage<T>(...args: Parameters<typeof executeCheckpoint<T>>) {
	return withNotifications(() => executeCheckpoint<T>(...args));
}

async function active(id: string) {
	const owner = getWorkflowMetadata().workflowRunId;
	const row = await generationRuns.claim(id, owner);
	if (!row?.playlist.contents.request)
		throw new FatalError("Generation is no longer active");
	return { owner, row, request: row.playlist.contents.request };
}

function stageError(error: unknown): never {
	if (error instanceof StageBusyError)
		throw new RetryableError(error.message, { retryAfter: "3m" });
	if (error instanceof AmbiguousStageError) throw new FatalError(error.message);
	throw error;
}

export async function interpretIntentStep(id: string) {
	"use step";
	const { owner, row, request } = await active(id);
	try {
		return await executeStage(generationRuns, id, owner, {
			phase: "intent",
			paid: true,
			schema: IntentSchema.nullable(),
			progress: (intent) => [
				{ kind: "intent", intent, purpose: request.purpose },
			],
			operation: (signal) =>
				readIntent(request.prompt, signal, row.run.userId, true),
		});
	} catch (error) {
		stageError(error);
	}
}

export async function retrieveCandidatesStep(
	id: string,
	intent: Intent | null,
) {
	"use step";
	const { owner, row, request } = await active(id);
	let spotifyToken = "";
	try {
		return await executeStage(generationRuns, id, owner, {
			phase: "retrieval",
			paid: true,
			schema: ResearchSchema,
			prepare: async () => {
				spotifyToken = (await getSpotifyToken(row.run.userId, 10 * 60_000))
					.accessToken;
			},
			progress: (research) => [research.known.event, research.search.event],
			operation: (signal) =>
				retrieveCandidates(
					request,
					intent,
					row.run.userId,
					spotifyToken,
					signal,
				),
		});
	} catch (error) {
		stageError(error);
	}
}

export async function curatePicksStep(id: string, research: Research) {
	"use step";
	const { owner, row, request } = await active(id);
	try {
		return await executeStage(generationRuns, id, owner, {
			phase: "curation",
			paid: true,
			schema: CuratedSchema,
			operation: (signal) =>
				curatePicks(request, research, row.run.userId, signal),
			progress: (output) => [
				{ kind: "name", name: output.name },
				{ kind: "description", description: output.description },
				...output.picks.slice(0, request.trackCount).map((song) => ({
					...song,
					kind: "song" as const,
					origin: "pick" as const,
				})),
			],
		});
	} catch (error) {
		stageError(error);
	}
}

export async function resolveRecordingsStep(
	id: string,
	research: Research,
	curated: Curated,
) {
	"use step";
	const { owner, row, request } = await active(id);
	let token = "";
	try {
		return await executeStage(generationRuns, id, owner, {
			phase: "resolution",
			paid: false,
			schema: ResolvedSchema,
			prepare: async () => {
				token = (await getSpotifyToken(row.run.userId, 5 * 60_000)).accessToken;
			},
			operation: (signal, attempt) =>
				resolveRecordings(
					curated,
					research.intent,
					request.trackCount,
					token,
					signal,
					(line) =>
						generationRuns.append(
							id,
							owner,
							line.kind === "song" ? annotateRecording(line, research) : line,
							{
								phase: "resolution",
								attempt,
							},
						),
				),
		});
	} catch (error) {
		stageError(error);
	}
}

export async function checkEvidenceStep(
	id: string,
	research: Research,
	resolved: Resolved,
) {
	"use step";
	const { owner, row, request } = await active(id);
	try {
		return await executeStage(generationRuns, id, owner, {
			phase: "checking",
			paid: false,
			schema: CheckedSchema,
			operation: (signal, attempt) =>
				checkEvidence(
					resolved,
					research,
					request,
					row.run.userId,
					signal,
					(line) =>
						generationRuns.append(id, owner, line, {
							phase: "checking",
							attempt,
						}),
				),
		});
	} catch (error) {
		stageError(error);
	}
}

export async function repairRecordingsStep(
	id: string,
	research: Research,
	checked: Checked,
) {
	"use step";
	const { owner, row, request } = await active(id);
	let token = "";
	try {
		return await executeStage(generationRuns, id, owner, {
			phase: "repair",
			paid: true,
			schema: CheckedSchema,
			prepare: async () => {
				token = (await getSpotifyToken(row.run.userId, 10 * 60_000))
					.accessToken;
			},
			operation: (signal, attempt) =>
				repairChecked(
					checked,
					research,
					request,
					row.run.userId,
					token,
					signal,
					(line) =>
						generationRuns.append(id, owner, line, {
							phase: "repair",
							attempt,
						}),
				),
		});
	} catch (error) {
		stageError(error);
	}
}

export async function rerankRecordingsStep(
	id: string,
	research: Research,
	repaired: Checked,
) {
	"use step";
	const { owner, row, request } = await active(id);
	try {
		return await executeStage(generationRuns, id, owner, {
			phase: "rerank",
			paid: true,
			schema: CheckedSchema,
			operation: (signal, attempt) =>
				rerankChecked(
					repaired,
					research,
					request,
					row.run.userId,
					signal,
					(line) =>
						generationRuns.append(id, owner, line, {
							phase: "rerank",
							attempt,
						}),
				),
		});
	} catch (error) {
		stageError(error);
	}
}

export async function finalizePlaylistStep(id: string) {
	"use step";
	await withNotifications(
		() => generationRuns.finalize(id, getWorkflowMetadata().workflowRunId),
		true,
	);
}

export async function recordFailureStep(id: string) {
	"use step";
	await withNotifications(
		() =>
			generationRuns.fail(id, getWorkflowMetadata().workflowRunId, {
				code: "unavailable",
				message:
					"Generation could not finish. Your saved recordings are available; generate another playlist to try again.",
			}),
		true,
	);
}
