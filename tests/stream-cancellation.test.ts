import { expect, test } from "bun:test";
import { processEngineStream } from "~/server/api/stream-helpers";

test("server cancellation releases a stalled upstream reader", async () => {
	let cancelled = false;
	const input = new ReadableStream<Uint8Array>({
		cancel() {
			cancelled = true;
		},
	});
	const abort = new AbortController();
	let output: ReadableStreamDefaultController<Uint8Array> | undefined;
	new ReadableStream<Uint8Array>({
		start(controller) {
			output = controller;
		},
	});
	if (!output)
		throw new Error("Stream start must provide its controller synchronously");
	const running = processEngineStream(
		input,
		output,
		() => {},
		abort.signal,
	).then(
		() => "finished",
		() => "aborted",
	);
	abort.abort();
	const result = await Promise.race([
		running,
		new Promise((resolve) => setTimeout(() => resolve("stalled"), 30)),
	]);
	expect(result).toBe("aborted");
	expect(cancelled).toBe(true);
	expect(input.locked).toBe(false);
});
