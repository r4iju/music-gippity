import { z } from "zod";
import {
	type PlaylistFormInput,
	PlaylistFormSchema,
} from "~/app/dashboard/create-playlist/playlist-form-schema";
import {
	type GenerationSnapshot,
	GenerationSnapshotSchema,
	GenerationSummarySchema,
	isGenerating,
} from "~/lib/generation-snapshot";
import { NotificationEnvelopeSchema } from "./generation-notification";

export type Connection =
	| { status: "connecting" | "connected" | "reconnecting" | "offline" }
	| { status: "error"; message: string };
const pause = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		const abort = () => {
			clearTimeout(timer);
			reject(signal.reason);
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", abort);
			resolve();
		}, ms);
		if (signal.aborted) abort();
		else signal.addEventListener("abort", abort, { once: true });
	});
class AccessError extends Error {}
async function snapshotResponse(response: Response) {
	if ([400, 401, 403, 404, 409].includes(response.status))
		throw new AccessError(
			"This generation could not be opened. Check your sign-in or choose another playlist.",
		);
	if (!response.ok) throw new Error("Could not load generation");
	return GenerationSnapshotSchema.parse(await response.json());
}

/** Observation is disposable; revisions order snapshots, cursors only resume notifications. */
export async function observeGeneration(
	target: { id: string; request?: PlaylistFormInput },
	signal: AbortSignal,
	onSnapshot: (snapshot: GenerationSnapshot) => unknown,
	onConnection: (connection: Connection) => void,
	transport: {
		fetch: (input: string, init?: RequestInit) => Promise<Response>;
		pause: (ms: number, signal: AbortSignal) => Promise<void>;
	} = { fetch: (input, init) => fetch(input, init), pause },
) {
	let pending = target.request;
	let playlistId = target.id;
	let failures = 0;
	let cursor = 0;
	let snapshot: GenerationSnapshot | undefined;
	const accept = (next: GenerationSnapshot) => {
		if (next.playlist.id !== playlistId)
			throw new Error("Wrong playlist snapshot");
		signal.throwIfAborted();
		if (!snapshot || next.revision > snapshot.revision) {
			snapshot = next;
			onSnapshot(next);
		}
	};
	const terminal = () =>
		snapshot && !isGenerating(snapshot.playlist.generation.status);
	let wake = () => {};
	const restored = () => {
		if (
			typeof document === "undefined" ||
			document.visibilityState !== "hidden"
		)
			wake();
	};
	if (typeof window !== "undefined") {
		window.addEventListener("online", restored);
		window.addEventListener("focus", restored);
	}
	if (typeof document !== "undefined")
		document.addEventListener("visibilitychange", restored);
	try {
		while (!signal.aborted) {
			const cycle = new AbortController();
			let awakened = false;
			wake = () => {
				awakened = true;
				cycle.abort();
			};
			const active = AbortSignal.any([signal, cycle.signal]);
			try {
				onConnection({ status: failures ? "reconnecting" : "connecting" });
				const response = await transport.fetch(
					pending
						? "/api/playlist-generations"
						: `/api/playlist-generations/${playlistId}`,
					{
						...(pending
							? {
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify({
										id: target.id,
										request: PlaylistFormSchema.parse(pending),
									}),
								}
							: {}),
						signal: AbortSignal.any([active, AbortSignal.timeout(15_000)]),
						cache: "no-store",
					},
				);
				const initial = await snapshotResponse(response);
				if (pending) playlistId = initial.playlist.id;
				pending = undefined;
				accept(initial);
				onConnection({ status: "connected" });
				if (terminal()) return;
				const stream = await transport.fetch(
					`/api/playlist-generations/${playlistId}/stream?cursor=${cursor}`,
					{
						signal: AbortSignal.any([active, AbortSignal.timeout(55_000)]),
						cache: "no-store",
					},
				);
				if (!stream.ok || stream.status === 204 || !stream.body)
					throw new Error("Stream unavailable");
				const reader = stream.body.getReader();
				const abort = () => {
					void reader.cancel().catch(() => {});
				};
				active.addEventListener("abort", abort, { once: true });
				let refreshing: Promise<void> | undefined;
				const refresh = () => {
					if (!refreshing)
						refreshing = (async () => {
							const next = await snapshotResponse(
								await transport.fetch(
									`/api/playlist-generations/${playlistId}`,
									{
										signal: AbortSignal.any([
											active,
											AbortSignal.timeout(15_000),
										]),
										cache: "no-store",
									},
								),
							);
							active.throwIfAborted();
							accept(next);
						})().finally(() => {
							refreshing = undefined;
						});
					return refreshing;
				};
				const receive = async () => {
					const decoder = new TextDecoder();
					let partial = "";
					while (!active.aborted && !terminal()) {
						const { done, value } = await reader.read();
						if (done) return;
						partial += decoder.decode(value, { stream: true });
						if (partial.length > 64_000)
							throw new Error("Oversized notification");
						const lines = partial.split("\n");
						partial = lines.pop() ?? "";
						for (const line of lines) {
							if (!line.trim()) continue;
							const event = NotificationEnvelopeSchema.parse(JSON.parse(line));
							if (event.notification.playlistId !== playlistId)
								throw new Error("Wrong playlist notification");
							cursor = Math.max(cursor, event.cursor);
							if (event.notification.revision > (snapshot?.revision ?? -1))
								await refresh();
							if (terminal()) return;
						}
					}
				};
				const reconcile = async () => {
					while (!active.aborted && !terminal()) {
						await transport.pause(10_000, active);
						active.throwIfAborted();
						await refresh();
					}
				};
				try {
					await Promise.race([receive(), reconcile()]);
					if (terminal()) return;
				} finally {
					cycle.abort();
					active.removeEventListener("abort", abort);
					await reader.cancel().catch(() => {});
					reader.releaseLock();
				}
				failures = 0;
			} catch (error) {
				if (signal.aborted) return;
				if (error instanceof AccessError) {
					onConnection({ status: "error", message: error.message });
					return;
				}
				failures++;
				console.info(
					JSON.stringify({
						component: "playlist-observer",
						event: "reconnect",
						playlistId,
						revision: snapshot?.revision,
						cursor,
					}),
				);
				// Replay is harmless; a stale/unavailable cursor must not prevent recovery.
				cursor = 0;
				onConnection({
					status:
						typeof navigator !== "undefined" && navigator.onLine === false
							? "offline"
							: "reconnecting",
				});
			} finally {
				cycle.abort();
			}
			if (awakened) continue;
			const backoff = new AbortController();
			wake = () => {
				awakened = true;
				backoff.abort();
			};
			try {
				await transport.pause(
					Math.min(1000 * 2 ** failures, 10_000),
					AbortSignal.any([signal, backoff.signal]),
				);
			} catch {
				if (awakened && !signal.aborted) continue;
				return;
			}
		}
	} finally {
		if (typeof window !== "undefined") {
			window.removeEventListener("online", restored);
			window.removeEventListener("focus", restored);
		}
		if (typeof document !== "undefined")
			document.removeEventListener("visibilitychange", restored);
	}
}

export async function cancelRemoteGeneration(id: string) {
	return snapshotResponse(
		await fetch(`/api/playlist-generations/${id}`, {
			method: "DELETE",
			signal: AbortSignal.timeout(15_000),
		}),
	);
}
export async function listGenerations() {
	const response = await fetch("/api/playlist-generations", {
		signal: AbortSignal.timeout(15_000),
		cache: "no-store",
	});
	if (!response.ok) throw new Error("Could not load generation history");
	return z.array(GenerationSummarySchema).parse(await response.json());
}
