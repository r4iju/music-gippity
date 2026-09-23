import { AsyncLocalStorage } from "node:async_hooks";
import { getWritable } from "workflow";
import type { GenerationNotification } from "~/lib/generation-notification";

const publishers = new AsyncLocalStorage<
	(value: GenerationNotification) => void
>();
export const notifyCommitted = (value: GenerationNotification) =>
	publishers.getStore()?.(value);

/** A bounded, coalescing side effect. Neither a slow reader nor a failed writer can fail paid work. */
export async function withNotifications<T>(
	operation: () => Promise<T>,
	terminal = false,
): Promise<T> {
	let writer: WritableStreamDefaultWriter<GenerationNotification>;
	try {
		writer = getWritable<GenerationNotification>().getWriter();
	} catch {
		return operation();
	}
	let latest: GenerationNotification | undefined;
	let stopped = false;
	let writing: Promise<void> | undefined;
	const enqueue = (value: GenerationNotification) => {
		if (stopped) return;
		latest = value;
		if (!writing)
			writing = (async () => {
				while (latest && !stopped) {
					const next = latest;
					latest = undefined;
					await writer.write(next);
				}
			})()
				.catch(() => {
					stopped = true;
				})
				.finally(() => {
					writing = undefined;
				});
	};
	let succeeded = false;
	try {
		const result = await publishers.run(enqueue, operation);
		succeeded = true;
		return result;
	} finally {
		let timer: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([
			(async () => {
				await writing;
				if (terminal && succeeded && !stopped) await writer.close();
			})().catch(() => {}),
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, 250);
			}),
		]);
		clearTimeout(timer);
		stopped = true;
		latest = undefined;
		writer.releaseLock();
	}
}
