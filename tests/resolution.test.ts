import { describe, expect, test } from "bun:test";
import { groundIntent, ReadIntentSchema } from "~/lib/intent";
import {
	chooseSearchHit,
	type SearchHit,
	versionDrift,
} from "~/lib/resolution";

const hit = (
	id: string,
	title: string,
	releaseDate = "2010-01-01",
): SearchHit => ({
	id,
	title,
	artists: ["Kavinsky"],
	releaseDate,
	isrc: `ISRC-${id}`,
});

describe("versionDrift", () => {
	test("a version word in the song's own name is not drift, an extra one is", () => {
		expect(versionDrift("Live Forever", "Live Forever", null)).toBe(false);
		expect(
			versionDrift("Live Forever", "Live Forever - Live at Knebworth", null),
		).toBe(true);
		expect(versionDrift("Cover Me", "Cover Me", null)).toBe(false);
		expect(versionDrift("Cover Me", "Cover Me (Live)", null)).toBe(true);
	});

	test("a no-vocals intent asks for instrumentals", () => {
		const intent = groundIntent(
			ReadIntentSchema.parse({
				vocalRule: { rule: "no-vocals", quote: "no vocals" },
			}),
			"Deep focus, no vocals",
		);
		expect(versionDrift("Nightcall", "Nightcall - Instrumental", intent)).toBe(
			false,
		);
		expect(versionDrift("Nightcall", "Nightcall - Instrumental", null)).toBe(
			true,
		);
	});
});

describe("chooseSearchHit", () => {
	const pick = { artist: "Kavinsky", title: "Nightcall" };

	test("a drifted take of the requested title beats another song by the artist", () => {
		const best = chooseSearchHit(
			pick,
			[hit("other", "Roadgame"), hit("live", "Nightcall - Live")],
			null,
		);
		expect(best?.hit.id).toBe("live");
		expect(best?.resolution).toEqual({
			tier: "normalized",
			drift: true,
			isrc: "ISRC-live",
		});
	});

	test("the era only orders releases inside it", () => {
		const intent = groundIntent(
			ReadIntentSchema.parse({ era: { start: 2008, end: 2012 } }),
			"2010s synthwave",
		);
		const inside = chooseSearchHit(
			pick,
			[
				hit("later", "Nightcall", "2012-01-01"),
				hit("first", "Nightcall", "2010-01-01"),
			],
			intent,
		);
		expect(inside?.hit.id).toBe("first");
		const outside = chooseSearchHit(
			pick,
			[
				hit("a", "Nightcall", "1999-01-01"),
				hit("b", "Nightcall", "1990-01-01"),
			],
			intent,
		);
		expect(outside?.hit.id).toBe("a");
	});
});
