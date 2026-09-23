/** Starts queued tasks at most once per interval, in call order. */
export class RateLimiter {
	private queue: Promise<unknown> = Promise.resolve();
	private nextStart = 0;

	constructor(private readonly intervalMs: number) {}

	/**
	 * Runs the task at its turn. Aborting the signal while the task waits
	 * rejects at once and gives its turn to the next task.
	 */
	run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
		const turn = this.queue.then(async () => {
			if (signal?.aborted) return false;
			const wait = this.nextStart - performance.now();
			if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
			if (signal?.aborted) return false;
			this.nextStart = performance.now() + this.intervalMs;
			return true;
		});
		this.queue = turn;
		if (!signal) return turn.then(task);
		return new Promise<T>((resolve, reject) => {
			const abort = () => reject(signal.reason);
			if (signal.aborted) return abort();
			signal.addEventListener("abort", abort, { once: true });
			turn.then((started) => {
				signal.removeEventListener("abort", abort);
				if (started) task().then(resolve, reject);
				else abort();
			});
		});
	}
}
