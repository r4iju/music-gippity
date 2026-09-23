import { expect, test } from "bun:test";
import { observeGeneration } from "~/lib/generation-client";
import { emptyDraft } from "~/lib/playlist-generation";

test("returning online reconciles immediately without waiting for the healthy-stream timer", async () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
	const events = new EventTarget();
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: events,
	});
	const id = crypto.randomUUID();
	const stop = new AbortController();
	let reads = 0;
	let completed = false;
	const timeout = setTimeout(() => stop.abort(), 80);
	try {
		await observeGeneration(
			{ id },
			stop.signal,
			(value) => {
				completed = value.playlist.generation.status === "complete";
			},
			() => {},
			{
				fetch: async (url) => {
					if (url.includes("/stream")) {
						setTimeout(() => events.dispatchEvent(new Event("online")), 1);
						return new Response(new ReadableStream());
					}
					reads++;
					return Response.json({
						playlist: {
							...emptyDraft(),
							id,
							generation:
								reads === 1
									? { status: "running", runId: id }
									: { status: "complete" },
						},
						revision: reads,
						createdAt: 1,
						updatedAt: 1,
					});
				},
				pause: async (_ms, signal) => {
					await new Promise<void>((_resolve, reject) => {
						if (signal.aborted) reject(signal.reason);
						else
							signal.addEventListener("abort", () => reject(signal.reason), {
								once: true,
							});
					});
				},
			},
		);
		expect(completed).toBe(true);
	} finally {
		clearTimeout(timeout);
		if (previous) Object.defineProperty(globalThis, "window", previous);
		else Reflect.deleteProperty(globalThis, "window");
	}
});

test("offline transport has a distinct connection state without changing generation", async () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: { onLine: false },
	});
	const states: string[] = [];
	try {
		await observeGeneration(
			{ id: crypto.randomUUID() },
			new AbortController().signal,
			() => {
				throw new Error("unexpected snapshot");
			},
			(state) => states.push(state.status),
			{
				fetch: async () => {
					throw new Error("offline");
				},
				pause: async () => {
					throw new Error("end fixture");
				},
			},
		);
		expect(states).toContain("offline");
	} finally {
		if (previous) Object.defineProperty(globalThis, "navigator", previous);
		else Reflect.deleteProperty(globalThis, "navigator");
	}
});

test("creation follows the returned playlist identity rather than its request key", async () => {
	const key = crypto.randomUUID();
	const id = crypto.randomUUID();
	const snapshot = {
		playlist: { ...emptyDraft(), id, generation: { status: "complete" } },
		revision: 2,
		createdAt: 1,
		updatedAt: 1,
	};
	const seen: string[] = [];
	await observeGeneration(
		{
			id: key,
			request: {
				prompt: "Workout pop playlist",
				trackCount: 2,
				engine: "chatgpt",
			},
		},
		new AbortController().signal,
		(value) => seen.push(value.playlist.id),
		() => {},
		{
			fetch: async () => Response.json(snapshot),
			pause: async () => {
				throw new Error("unexpected retry");
			},
		},
	);
	expect(seen).toEqual([id]);
});

test("stream loss reloads authoritative snapshot instead of regenerating", async () => {
	const id = crypto.randomUUID();
	const running = {
		playlist: {
			...emptyDraft(),
			id,
			generation: { status: "running", runId: id },
		},
		revision: 1,
		createdAt: 1,
		updatedAt: 1,
	};
	const complete = {
		...running,
		playlist: { ...running.playlist, generation: { status: "complete" } },
		revision: 2,
	};
	const urls: string[] = [];
	const transport = async (url: string) => {
		urls.push(String(url));
		if (String(url).includes("/stream")) throw new Error("offline");
		return Response.json(urls.length === 1 ? running : complete);
	};
	const revisions: number[] = [];
	await observeGeneration(
		{ id },
		new AbortController().signal,
		(snapshot) => revisions.push(snapshot.revision),
		() => {},
		{ fetch: transport, pause: async () => {} },
	);
	expect(revisions).toEqual([1, 2]);
	expect(urls).toHaveLength(3);
	expect(urls.every((url) => url.includes(id))).toBe(true);
});

test("a healthy stream missing completion is reconciled from saved state without another create", async () => {
	const id = crypto.randomUUID();
	const base = {
		playlist: {
			...emptyDraft(),
			id,
			generation: { status: "running", runId: id },
		},
		revision: 40,
		createdAt: 1,
		updatedAt: 1,
	};
	let reads = 0;
	let streamClosed = false;
	let recoveredWhileOpen = false;
	const urls: string[] = [];
	await observeGeneration(
		{ id },
		new AbortController().signal,
		(snapshot) => {
			if (snapshot.playlist.generation.status === "complete")
				recoveredWhileOpen = !streamClosed;
		},
		() => {},
		{
			fetch: async (url) => {
				urls.push(url);
				if (url.includes("/stream")) {
					let timer: ReturnType<typeof setTimeout>;
					return new Response(
						new ReadableStream({
							start(controller) {
								timer = setTimeout(() => {
									streamClosed = true;
									controller.close();
								}, 50);
							},
							cancel() {
								clearTimeout(timer);
							},
						}),
					);
				}
				reads++;
				return Response.json(
					reads === 1
						? base
						: {
								...base,
								playlist: {
									...base.playlist,
									generation: { status: "complete" },
								},
								revision: 42,
							},
				);
			},
			pause: async () => {
				await new Promise((resolve) => setTimeout(resolve, 1));
			},
		},
	);
	expect(recoveredWhileOpen).toBe(true);
	expect(reads).toBe(2);
	expect(urls.every((url) => url.includes(id))).toBe(true);
});
