import { describe, expect, test } from "bun:test";
import { type Evidence, hardRuleViolation } from "~/lib/evidence";
import { groundIntent, ReadIntentSchema } from "~/lib/intent";

const BRIEF = "Synthwave, nada de Daft Punk, no Air, no trap, no remixes";

const intent = groundIntent(
	ReadIntentSchema.parse({
		exclusions: [
			{ kind: "artist", value: "Daft Punk", quote: "nada de Daft Punk" },
			{ kind: "artist", value: "Air", quote: "no Air" },
			{ kind: "style", value: "trap", quote: "no trap" },
			{ kind: "version", value: "remixes", quote: "no remixes" },
		],
	}),
	BRIEF,
);

const excluding = (kind: "version", value: string, quote: string) =>
	groundIntent(
		ReadIntentSchema.parse({ exclusions: [{ kind, value, quote }] }),
		quote,
	);

const facts = (overrides: Partial<Evidence> = {}): Evidence => ({
	firstReleaseYear: null,
	artistCountry: null,
	credits: null,
	instrumental: null,
	tempo: null,
	gain: null,
	version: null,
	tags: null,
	listeners: null,
	sources: {
		musicbrainz: "unknown",
		lrclib: "unknown",
		deezer: "unknown",
		lastfm: "unknown",
		listenbrainz: "unknown",
	},
	...overrides,
});

const recording = (artists: string[], title = "Nightcall") => ({
	spotifyRecording: { title, artists },
});

describe("exclusions in evidence", () => {
	test("an artist exclusion reads Spotify's credits first, then MusicBrainz's", () => {
		expect(
			hardRuleViolation(intent, facts(), recording(["Kavinsky", "Daft Punk"])),
		).toEqual({
			rule: "exclusion",
			source: "spotify",
			detail: 'credited to Daft Punk, excluded by "nada de Daft Punk"',
		});
		expect(
			hardRuleViolation(
				intent,
				facts({ credits: { value: ["Daft Punk"], source: "musicbrainz" } }),
				recording(["Kavinsky"]),
			),
		).toMatchObject({
			rule: "exclusion",
			source: "musicbrainz",
			detail: 'credited to Daft Punk, excluded by "nada de Daft Punk"',
		});
	});

	test("an artist exclusion names the act, not every act containing the name", () => {
		expect(
			hardRuleViolation(intent, facts(), recording(["Air Supply", "Blair"])),
		).toBeNull();
		expect(
			hardRuleViolation(intent, facts(), recording(["Kavinsky", "AIR"])),
		).toMatchObject({ detail: 'credited to AIR, excluded by "no Air"' });
	});

	test("a style exclusion reads the tags", () => {
		expect(
			hardRuleViolation(
				intent,
				facts({ tags: { value: ["synthwave", "Trap"], source: "lastfm" } }),
				recording(["Kavinsky"]),
			),
		).toEqual({
			rule: "exclusion",
			source: "lastfm",
			detail: 'tagged Trap, excluded by "no trap"',
		});
	});

	test("a version exclusion reads the title, then Deezer's version", () => {
		expect(
			hardRuleViolation(
				intent,
				facts(),
				recording(["Kavinsky"], "Nightcall - Breakbot Remix"),
			),
		).toEqual({
			rule: "exclusion",
			source: "spotify",
			detail:
				'a remix version, "Nightcall - Breakbot Remix", excluded by "no remixes"',
		});
		expect(
			hardRuleViolation(
				intent,
				facts({ version: { value: "(Remixed)", source: "deezer" } }),
				recording(["Kavinsky"]),
			),
		).toMatchObject({ rule: "exclusion", source: "deezer" });
		// A live take is not what "no remixes" excludes.
		expect(
			hardRuleViolation(
				intent,
				facts({ version: { value: "(Live)", source: "deezer" } }),
				recording(["Kavinsky"], "Nightcall - Live"),
			),
		).toBeNull();
	});

	test("a version word in the song's own name is not a version", () => {
		const noLive = excluding("version", "live", "no live");
		expect(
			hardRuleViolation(noLive, facts(), recording(["Oasis"], "Live Forever")),
		).toBeNull();
		expect(
			hardRuleViolation(
				noLive,
				facts(),
				recording(["Oasis"], "Live Forever - Live at Knebworth"),
			),
		).toMatchObject({
			source: "spotify",
			detail: expect.stringContaining("a live version"),
		});
	});

	test("plural exclusions name the version word", () => {
		const noCovers = excluding("version", "covers", "no covers");
		expect(
			hardRuleViolation(
				noCovers,
				facts(),
				recording(["Kavinsky"], "Nightcall - Cover"),
			),
		).toMatchObject({ source: "spotify" });
		expect(
			hardRuleViolation(
				noCovers,
				facts({ version: { value: "(Cover)", source: "deezer" } }),
				recording(["Kavinsky"]),
			),
		).toMatchObject({ source: "deezer" });
	});

	test("without a Spotify recording only the evidence is read", () => {
		expect(
			hardRuleViolation(intent, facts(), { spotifyRecording: undefined }),
		).toBeNull();
		expect(
			hardRuleViolation(
				intent,
				facts({ credits: { value: ["Daft Punk"], source: "musicbrainz" } }),
				{ spotifyRecording: undefined },
			),
		).toMatchObject({ source: "musicbrainz" });
	});

	test("unknown evidence and a clean recording never count as a breach", () => {
		expect(
			hardRuleViolation(intent, facts(), recording(["Kavinsky"])),
		).toBeNull();
		expect(
			hardRuleViolation(
				intent,
				facts({
					credits: { value: ["Kavinsky"], source: "musicbrainz" },
					tags: { value: ["synthwave"], source: "lastfm" },
					version: { value: "(Original Mix)", source: "deezer" },
				}),
				recording(["Kavinsky"]),
			),
		).toBeNull();
	});
});
