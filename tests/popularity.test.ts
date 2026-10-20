import { describe, expect, test } from "bun:test";
import type { Evidence } from "~/lib/evidence";
import { PlaylistLineSchema } from "~/lib/playlist-stream";
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
		const deezer = MAINSTREAM_LISTENERS.deezer;
		expect(mainstreamStatus({ value: deezer, source: "deezer" })).toBe(
			"mainstream",
		);
		expect(mainstreamStatus({ value: deezer - 1, source: "deezer" })).toBe(
			"not-mainstream",
		);
		expect(mainstreamStatus(null)).toBe("unknown");
	});

	test("medians and counts are per source and a missing evidence line is unknown", () => {
		expect(
			summarizePopularity([
				counted({ value: 30, source: "listenbrainz" }),
				counted({ value: 10, source: "listenbrainz" }),
				counted({ value: 20, source: "listenbrainz" }),
				counted({ value: 7, source: "lastfm" }),
				counted({ value: 12, source: "deezer" }),
				counted(null),
				undefined,
			]),
		).toEqual({
			recordings: 7,
			median: { lastfm: 7, listenbrainz: 20, deezer: 12 },
			counted: { lastfm: 1, listenbrainz: 3, deezer: 1 },
			mainstream: 0,
			unknown: 2,
		});
	});

	test("a popularity line saved before Deezer counted still parses", () => {
		const line = {
			kind: "popularity",
			status: "uncapped",
			recordings: 6,
			mainstream: 2,
			unknown: 1,
			median: { lastfm: 90000, listenbrainz: null },
		};
		expect(PlaylistLineSchema.safeParse(line).success).toBe(true);
	});
});
