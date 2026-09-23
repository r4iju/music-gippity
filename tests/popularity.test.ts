import { describe, expect, test } from "bun:test";
import type { Evidence } from "~/lib/evidence";
import {
	isMainstream,
	MAINSTREAM_LISTENERS,
	summarizePopularity,
} from "~/lib/popularity";

const counted = (listeners: Evidence["listeners"]) =>
	({ listeners }) as Evidence;

describe("popularity", () => {
	test("each source is judged by its own threshold", () => {
		const lb = MAINSTREAM_LISTENERS.listenbrainz;
		expect(isMainstream({ value: lb, source: "listenbrainz" })).toBe(true);
		expect(isMainstream({ value: lb, source: "lastfm" })).toBe(
			lb >= MAINSTREAM_LISTENERS.lastfm,
		);
		const lastfm = MAINSTREAM_LISTENERS.lastfm;
		expect(isMainstream({ value: lastfm, source: "lastfm" })).toBe(true);
		expect(isMainstream({ value: lastfm - 1, source: "lastfm" })).toBe(false);
		expect(isMainstream(null)).toBe(false);
	});

	test("medians are per source and a missing evidence line is unknown", () => {
		expect(
			summarizePopularity([
				counted({ value: 30, source: "listenbrainz" }),
				counted({ value: 10, source: "listenbrainz" }),
				counted({ value: 20, source: "listenbrainz" }),
				counted({ value: 7, source: "lastfm" }),
				counted(null),
				undefined,
			]),
		).toEqual({
			recordings: 6,
			median: { listenbrainz: 20, lastfm: 7 },
			mainstream: 0,
			unknown: 2,
		});
	});
});
