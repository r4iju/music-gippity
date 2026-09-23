// biome-ignore lint/suspicious/noExplicitAny: Generic throttle function needs any
export type ThrottledFunction<T extends (...args: any[]) => any> = T & {
	cancel: () => void;
	flush: () => ReturnType<T> | undefined;
};

// biome-ignore lint/suspicious/noExplicitAny: Generic throttle function needs any
export function throttle<T extends (...args: any[]) => any>(
	func: T,
	wait: number,
): ThrottledFunction<T> {
	let timeout: ReturnType<typeof setTimeout> | null = null;
	// Initialize lastCallTime to 0 so that the first call will fire immediately.
	let lastCallTime = 0;
	let lastArgs: Parameters<T> | null = null;
	// biome-ignore lint/suspicious/noExplicitAny: This context can be anything
	let lastThis: any;
	let result: ReturnType<T>;

	const throttled = function (
		...args: Parameters<T>
	): ReturnType<T> | undefined {
		const now = Date.now();

		// If this is the first call, execute immediately.
		if (lastCallTime === 0) {
			lastCallTime = now;
			// @ts-expect-error - This is a valid method.
			result = func.apply(this, args);
			return result;
		}

		const remaining = wait - (now - lastCallTime);
		lastArgs = args;
		// @ts-expect-error - This is a valid method.
		lastThis = this;

		if (remaining <= 0) {
			if (timeout) {
				clearTimeout(timeout);
				timeout = null;
			}
			lastCallTime = now;
			result = func.apply(lastThis, lastArgs);
			return result;
		} else if (!timeout) {
			timeout = setTimeout(() => {
				lastCallTime = Date.now();
				timeout = null;
				// It's safe to use non-null assertion here because this callback
				// only fires when lastArgs was set.
				// biome-ignore lint/style/noNonNullAssertion: Guarded by logic above
				result = func.apply(lastThis, lastArgs!);
			}, remaining);
		}
		return result;
	};

	throttled.cancel = () => {
		if (timeout) {
			clearTimeout(timeout);
			timeout = null;
		}
		lastCallTime = 0;
	};

	// @ts-expect-error - This is a valid method.
	throttled.flush = () => {
		if (timeout) {
			clearTimeout(timeout);
			timeout = null;
			lastCallTime = Date.now();
			// biome-ignore lint/style/noNonNullAssertion: Guarded by logic above
			result = func.apply(lastThis, lastArgs!);
			return result;
		}
	};

	return throttled as ThrottledFunction<T>;
}
