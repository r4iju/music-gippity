import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { IntentChips } from "~/app/dashboard/create-playlist/intent-chips";
import type { Intent } from "~/lib/intent";
import { intentChips } from "~/lib/intent-chips";

const INTENT: Intent = {
	genres: ["synthwave", "italo disco"],
	era: { start: 2010, end: 2020 },
	mood: "late night drive",
	energy: "steady",
	language: "Spanish",
	vocalRule: { rule: "no-vocals", quote: "sin cantantes" },
	exclusions: [
		{ kind: "artist", value: "Daft Punk", quote: "nada de Daft Punk" },
	],
	mustInclude: [{ artist: "Kavinsky", quote: "con Kavinsky" }],
	album: { quote: "el álbum entero" },
	difficulty: "difficult",
};

describe("IntentChips", () => {
	test("lists the intent in brief order with the supporting quote as a tooltip", () => {
		expect(intentChips(INTENT).map((chip) => chip.label)).toEqual([
			"synthwave",
			"italo disco",
			"2010–2020",
			"late night drive",
			"steady",
			"Spanish",
			"No vocals",
			"No Daft Punk",
			"Include Kavinsky",
			"Whole album",
		]);
		const html = renderToStaticMarkup(<IntentChips intent={INTENT} />);
		expect(html).toContain(
			'aria-label="What this playlist is for and what we read from your brief"',
		);
		expect(html).toContain("From your brief: “sin cantantes”");
		expect(html).not.toContain("<input");
		expect(html).not.toContain("<button");
	});

	test("labels open-ended eras and renders nothing without an intent", () => {
		expect(
			intentChips({ ...INTENT, era: { start: 1980, end: null } }).map(
				(chip) => chip.label,
			)[2],
		).toBe("From 1980");
		expect(renderToStaticMarkup(<IntentChips intent={null} />)).toBe("");
		expect(renderToStaticMarkup(<IntentChips intent={undefined} />)).toBe("");
	});

	test("the purpose leads the chips and is marked as the listener's choice", () => {
		const html = renderToStaticMarkup(
			<IntentChips intent={INTENT} purpose="room" />,
		);
		expect(html).toMatch(
			/<li title="You picked this purpose"[^>]*>For a room</,
		);
		expect(html.indexOf("For a room")).toBeLessThan(html.indexOf("synthwave"));
	});

	test("a failed read still shows the purpose", () => {
		const html = renderToStaticMarkup(
			<IntentChips intent={null} purpose="discover" />,
		);
		expect(html).toContain(">Discover<");
		expect(html).not.toContain("synthwave");
	});
});
