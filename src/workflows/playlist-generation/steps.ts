import { getWorkflowMetadata } from "workflow";
import { readGeneration } from "~/lib/playlist-generation";
import { generatePlaylistStream } from "~/server/api/create-playlist";
import { generations } from "~/server/generation/store";
import { getSpotifyToken } from "~/server/spotify-token";

export async function generatePlaylistStep(id: string) {
	"use step";
	const owner = getWorkflowMetadata().workflowRunId;
	const row = await generations.claim(id, owner);
	if (!row) {
		// A redelivered paid step cannot safely replay a half-generated playlist.
		await generations.fail(
			id,
			owner,
			"The worker was interrupted. Your saved tracks are available; generate again to start a new playlist.",
		);
		return;
	}
	const cancellation = new AbortController();
	const signal = AbortSignal.any([
		cancellation.signal,
		AbortSignal.timeout(7 * 60_000),
	]);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	const checkCancellation = async () => {
		try {
			const current = await generations.workerRow(id);
			if (!current || current.finishedAt !== null || current.workerId !== owner)
				cancellation.abort();
		} catch {
			cancellation.abort();
		}
		if (!stopped && !signal.aborted)
			timer = setTimeout(() => {
				void checkCancellation();
			}, 2000);
	};
	void checkCancellation();
	try {
		if (!row.state.request) throw new Error("Missing generation request");
		const credentials = await getSpotifyToken(row.userId, 10 * 60_000);
		signal.throwIfAborted();
		const response = await generatePlaylistStream(row.state.request, {
			userId: row.userId,
			spotifyToken: credentials.accessToken,
			signal,
			playlistId: id,
		});
		await readGeneration(response, signal, async (line) => {
			await generations.append(id, owner, line);
		});
	} finally {
		stopped = true;
		clearTimeout(timer);
		cancellation.abort();
	}
}
// A transport/provider failure preserves progress; never repeat paid generation implicitly.
generatePlaylistStep.maxRetries = 0;

export async function failGenerationStep(id: string) {
	"use step";
	await generations.fail(
		id,
		getWorkflowMetadata().workflowRunId,
		"Generation could not finish. Your saved tracks are available; generate again to start a new playlist.",
	);
}
