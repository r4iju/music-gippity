import { describe, expect, test } from "bun:test";
import type { Evidence } from "~/lib/evidence";
import {
	MAINSTREAM_LISTENERS,
	mainstreamStatus,
	summarizePopularity,
} from "~/lib/popularity";

const counted = (listeners: Evidence["listeners"]) =>
	({ listeners }) as Evidence;

describe("popularity", () => {
	test("each source is judged by its own threshold, and an uncounted recording is unknown", () => {
		const lb = MAINSTREAM_LISTENERS.listenbrainz;
		expect(mainstreamStatus({ value: 5000, source: "listenbrainz" })).toBe(
			"mainstream",
		);
		expect(mainstreamStatus({ value: 5000, source: "lastfm" })).toBe(
			"not-mainstream",
		);
		expect(mainstreamStatus({ value: lb - 1, source: "listenbrainz" })).toBe(
			"not-mainstream",
		);
		expect(mainstreamStatus({ value: 250000, source: "lastfm" })).toBe(
			"mainstream",
		);
		expect(mainstreamStatus({ value: 249999, source: "lastfm" })).toBe(
			"not-mainstream",
		);
		expect(mainstreamStatus({ value: 0, source: "lastfm" })).toBe(
			"not-mainstream",
		);
		expect(mainstreamStatus(null)).toBe("unknown");
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
