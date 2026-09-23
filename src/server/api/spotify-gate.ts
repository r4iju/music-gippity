/** A non-2xx answer from Spotify, keeping the status for callers that branch on it. */
export class SpotifyApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

/** A call that ran out of its budget before Spotify answered. */
export class SpotifyTimeout extends Error {}

// Spotify sends Retry-After in whole seconds; a limit without one lifts
// within a second in practice.
const DEFAULT_RETRY_MS = 1000;
const MAX_RETRIES = 2;

const retryAfterMs = (response: Response): number => {
	const header = response.headers.get("Retry-After")?.trim();
	const seconds = header ? Number(header) : Number.NaN;
	return Number.isFinite(seconds) && seconds >= 0
		? seconds * 1000
		: DEFAULT_RETRY_MS;
};

const aborted = (signal: AbortSignal) =>
	new Promise<never>((_, reject) => {
		signal.addEventListener("abort", () => reject(signal.reason), {
			once: true,
		});
	});

const sleep = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", abort);
			resolve();
		}, ms);
		const abort = () => {
			clearTimeout(timer);
			reject(signal.reason);
		};
		signal.addEventListener("abort", abort, { once: true });
	});

/**
 * Runs Spotify calls under one shared rate limit. A rate-limited call
 * retries after Retry-After while the wait ends within its budget, and the
 * hold applies to every call through the gate, so a burst that hits the
 * limit stops sending into it. Calls limited together retry together once
 * the hold lifts, as Retry-After allows; the retry cap bounds a second
 * limit. A call past its budget is aborted.
 */
export class RateLimitGate {
	private holdUntil = 0;

	constructor(private readonly now: () => number = Date.now) {}

	async run(
		call: (signal: AbortSignal) => Promise<Response>,
		budgetMs: number,
	): Promise<Response> {
		const deadline = this.now() + budgetMs;
		const controller = new AbortController();
		const timer = setTimeout(
			() =>
				controller.abort(new SpotifyTimeout(`timed out after ${budgetMs} ms`)),
			budgetMs,
		);
		try {
			for (let attempt = 0; ; attempt++) {
				// Re-read after each sleep: another call may have lengthened the hold.
				while (this.holdUntil > this.now()) {
					const wait = this.holdUntil - this.now();
					if (this.holdUntil > deadline)
						throw new SpotifyApiError(
							429,
							`Spotify rate limit holds for another ${Math.ceil(wait / 1000)} s, past the ${budgetMs} ms budget`,
						);
					await sleep(wait, controller.signal);
				}
				// Raced against the abort as well, so a body read that ignores the
				// signal still ends with the budget.
				const response = await Promise.race([
					call(controller.signal),
					aborted(controller.signal),
				]);
				if (response.status !== 429) return response;
				this.holdUntil = Math.max(
					this.holdUntil,
					this.now() + retryAfterMs(response),
				);
				if (attempt === MAX_RETRIES || this.holdUntil > deadline)
					return response;
			}
		} finally {
			clearTimeout(timer);
		}
	}
}
