import { expect, test } from "bun:test";
import { RateLimiter } from "~/server/api/evidence/rate-limit";

test("a rate limiter spaces concurrent calls by its interval", async () => {
	const limiter = new RateLimiter(30);
	const stamps: number[] = [];
	await Promise.all(
		[1, 2, 3].map(() =>
			limiter.run(async () => {
				stamps.push(performance.now());
			}),
		),
	);
	expect((stamps[1] ?? 0) - (stamps[0] ?? 0)).toBeGreaterThanOrEqual(25);
	expect((stamps[2] ?? 0) - (stamps[1] ?? 0)).toBeGreaterThanOrEqual(25);
});

test("a call aborted while it waits rejects at once and gives its turn to the next", async () => {
	const limiter = new RateLimiter(50);
	const ran: string[] = [];
	const first = limiter.run(async () => {
		ran.push("first");
	});
	const controller = new AbortController();
	const aborted = limiter.run(async () => {
		ran.push("aborted");
	}, controller.signal);
	const started = performance.now();
	controller.abort(new Error("timed out"));
	await expect(aborted).rejects.toThrow("timed out");
	expect(performance.now() - started).toBeLessThan(25);
	await first;
	await limiter.run(async () => {
		ran.push("next");
	});
	expect(ran).toEqual(["first", "next"]);
});
