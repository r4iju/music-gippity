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

	test("a reversed era is put in order", () => {
		const intent = groundIntent(
			ReadIntentSchema.parse({ era: { start: 1999, end: 1990 } }),
			BRIEF,
		);
		expect(intent.era).toEqual({ start: 1990, end: 1999 });
	});
});
