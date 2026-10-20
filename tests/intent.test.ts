import { describe, expect, test } from "bun:test";
import { groundIntent, ReadIntentSchema } from "~/lib/intent";

const BRIEF = "Synthwave nocturno, Sin Cantantes, nada de Daft Punk";

describe("groundIntent", () => {
	test("keeps hard rules the brief supports, in the brief's own spelling", () => {
		const intent = groundIntent(
			ReadIntentSchema.parse({
				genres: ["synthwave"],
				vocalRule: { rule: "no-vocals", quote: "sin cantantes" },
				exclusions: [
					{ kind: "artist", value: "Daft Punk", quote: "nada de daft punk" },
					{ kind: "style", value: "trap", quote: "never said this" },
				],
				mustInclude: [{ artist: "Kavinsky", quote: "not here either" }],
			}),
			BRIEF,
		);
		expect(intent.vocalRule).toEqual({
			rule: "no-vocals",
			quote: "Sin Cantantes",
		});
		expect(intent.exclusions).toEqual([
			{ kind: "artist", value: "Daft Punk", quote: "nada de Daft Punk" },
		]);
		expect(intent.mustInclude).toEqual([]);
		expect(intent.difficulty).toBe("difficult");
	});

	test("an unsupported vocal rule falls back to none and an open brief is easy", () => {
		const intent = groundIntent(
			ReadIntentSchema.parse({
				genres: ["synthwave"],
				mood: "night drive",
				vocalRule: { rule: "no-vocals", quote: "no singing" },
			}),
			BRIEF,
		);
		expect(intent.vocalRule).toEqual({ rule: "none", quote: null });
		expect(intent.difficulty).toBe("easy");
		expect(intent.era).toBeNull();
	});

	test("an album request is kept only when the brief says so", () => {
		const asked = groundIntent(
			ReadIntentSchema.parse({ album: { quote: "nocturno" } }),
			BRIEF,
		);
		expect(asked.album).toEqual({ quote: "nocturno" });
		const invented = groundIntent(
			ReadIntentSchema.parse({ album: { quote: "the whole record" } }),
			BRIEF,
		);
		expect(invented.album).toBeNull();
	});

	test("a classics request keeps its quote in the brief's spelling and is dropped when the brief never says it", () => {
		const brief = "The Best 80s Disco Hits for a kitchen party";
		const asked = groundIntent(
			ReadIntentSchema.parse({ classics: { quote: "best 80s disco hits" } }),
			brief,
		);
		expect(asked.classics).toEqual({ quote: "Best 80s Disco Hits" });
		const invented = groundIntent(
			ReadIntentSchema.parse({ classics: { quote: "greatest anthems" } }),
			brief,
		);
		expect(invented.classics).toBeNull();
		expect(groundIntent(ReadIntentSchema.parse({}), brief).classics).toBeNull();
	});

	test("a classics quote that only names a genre or era is dropped even though the brief says it", () => {
		const read = (quote: string, brief: string) =>
			groundIntent(ReadIntentSchema.parse({ classics: { quote } }), brief)
				.classics;
		expect(read("80s disco", "80s disco for a party")).toBeNull();
		expect(read("chill house", "Some chill house for Sunday")).toBeNull();
		for (const [quote, brief] of [
			["greatest hits", "Disco greatest hits for a party"],
			["the classics", "Give me the classics of Italo"],
			["essential", "Essential Detroit techno"],
			["Anthems", "Big room Anthems"],
			["best of", "A best of britpop"],
			["all-time", "All-time soul favourites"],
			["timeless", "Timeless jazz standards"],
			["canonical", "The canonical post-punk records"],
			["los grandes clásicos", "Los grandes clásicos de la salsa"],
			["éxitos", "Éxitos de los 90 en español"],
			["grands classiques", "Les grands classiques de la chanson"],
			["tubes", "Les tubes des années 80"],
		] as const)
			expect(read(quote, brief)).not.toBeNull();
	});

	test("a reversed era is put in order", () => {
		const intent = groundIntent(
			ReadIntentSchema.parse({ era: { start: 1999, end: 1990 } }),
			BRIEF,
		);
		expect(intent.era).toEqual({ start: 1990, end: 1999 });
	});
});
