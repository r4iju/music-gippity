import { expect, test } from "bun:test";
import {
	RateLimitGate,
	SpotifyApiError,
	SpotifyTimeout,
} from "~/server/api/spotify-gate";

const limited = (retryAfter?: string) =>
	new Response("rate limited", {
		status: 429,
		headers: retryAfter === undefined ? {} : { "Retry-After": retryAfter },
	});
const ok = () => Response.json({});

/** A call that answers from the script in order, recording when each attempt started. */
function scripted(answers: (() => Response | Promise<Response>)[]) {
	const starts: number[] = [];
	const call = async () => {
		starts.push(performance.now());
		const answer = answers[starts.length - 1];
		if (!answer)
			throw new Error(`no answer scripted for call ${starts.length}`);
		return answer();
	};
	return { call, starts };
}

test("a rate-limited call retries after Retry-After and returns the answer", async () => {
	const gate = new RateLimitGate();
	const { call, starts } = scripted([() => limited("0"), ok]);
	const response = await gate.run(call, 5000);
	expect(response.status).toBe(200);
	expect(starts).toHaveLength(2);
});

test("the wait honours Retry-After", async () => {
	const gate = new RateLimitGate();
	const { call, starts } = scripted([() => limited("1"), ok]);
	await gate.run(call, 5000);
	expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(990);
});

test("a call is retried at most twice, then its last answer is returned", async () => {
	const gate = new RateLimitGate();
	const { call, starts } = scripted([
		() => limited("0"),
		() => limited("0"),
		() => limited("0"),
		ok,
	]);
	const response = await gate.run(call, 5000);
	expect(response.status).toBe(429);
	expect(starts).toHaveLength(3);
});

test("a hold that lasts past the budget is not waited for", async () => {
	const gate = new RateLimitGate();
	const { call, starts } = scripted([() => limited("60"), ok]);
	const response = await gate.run(call, 5000);
	expect(response.status).toBe(429);
	expect(starts).toHaveLength(1);
});

for (const [header, retryAfter] of [
	["a missing", undefined],
	["an empty", " "],
	["an unreadable", "Wed, 21 Oct 2026 07:28:00 GMT"],
] as const)
	test(`${header} Retry-After holds for a second`, async () => {
		let now = 1_000_000;
		const gate = new RateLimitGate(() => now);
		await gate.run(scripted([() => limited(retryAfter)]).call, 500);
		const next = scripted([ok]);
		await expect(gate.run(next.call, 999)).rejects.toBeInstanceOf(
			SpotifyApiError,
		);
		expect(next.starts).toHaveLength(0);
		now += 1000;
		await gate.run(next.call, 1);
		expect(next.starts).toHaveLength(1);
	});

test("a hold lifts once its time passes", async () => {
	let now = 1_000_000;
	const gate = new RateLimitGate(() => now);
	await gate.run(scripted([() => limited("60")]).call, 500);
	now += 60_000;
	const next = scripted([ok]);
	expect((await gate.run(next.call, 500)).status).toBe(200);
});

test("a call that wakes into a longer hold sleeps again", async () => {
	const gate = new RateLimitGate();
	const first = scripted([() => limited("0.1"), ok]);
	const second = scripted([() => limited("1"), ok]);
	// The first wakes early, but by then the second has set a longer hold.
	const runs = [gate.run(first.call, 5000), gate.run(second.call, 5000)];
	await Promise.all(runs);
	expect(
		(first.starts[1] ?? 0) - (second.starts[0] ?? 0),
	).toBeGreaterThanOrEqual(990);
});

test("a hold one call receives stops other calls until it lifts", async () => {
	const gate = new RateLimitGate();
	await gate.run(scripted([() => limited("60")]).call, 5000);
	const next = scripted([ok]);
	const error = await gate.run(next.call, 5000).catch((e: unknown) => e);
	expect(error).toBeInstanceOf(SpotifyApiError);
	expect((error as SpotifyApiError).status).toBe(429);
	expect((error as SpotifyApiError).message).toContain("holds for another");
	expect(next.starts).toHaveLength(0);
});

test("a call past its budget is aborted with a timeout", async () => {
	const gate = new RateLimitGate();
	let reason: unknown;
	const call = (signal: AbortSignal) =>
		new Promise<Response>((_, reject) => {
			signal.addEventListener("abort", () => {
				reason = signal.reason;
				reject(signal.reason);
			});
		});
	const error = await gate.run(call, 20).catch((e: unknown) => e);
	expect(error).toBeInstanceOf(SpotifyTimeout);
	expect(reason).toBe(error);
	expect((error as Error).message).toBe("timed out after 20 ms");
});
