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
	classics: null,
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

	test("a classics request shows its chip with the quote as tooltip and an undo", () => {
		const classics: Intent = {
			...INTENT,
			classics: { quote: "los grandes clásicos" },
		};
		expect(intentChips(classics).at(-1)).toMatchObject({
			key: "classics",
			label: "Classics request",
			quote: "los grandes clásicos",
		});
		const html = renderToStaticMarkup(
			<IntentChips intent={classics} onUndoClassics={() => {}} />,
		);
		expect(html).toMatch(
			/<li title="From your brief: “los grandes clásicos”"[^>]*>Classics request<button type="button"[^>]*>Undo<\/button><\/li>/,
		);
		expect(html).toContain(
			'aria-label="Undo classics request: generate again without it"',
		);
	});

	test("no classics chip or undo without a classics request or an intent", () => {
		const plain = renderToStaticMarkup(
			<IntentChips intent={INTENT} onUndoClassics={() => {}} />,
		);
		expect(plain).not.toContain("Classics request");
		expect(plain).not.toContain("<button");
		expect(
			renderToStaticMarkup(
				<IntentChips
					intent={null}
					purpose="discover"
					onUndoClassics={() => {}}
				/>,
			),
		).not.toContain("<button");
	});

	test("a failed read still shows the purpose", () => {
		const html = renderToStaticMarkup(
			<IntentChips intent={null} purpose="discover" />,
		);
		expect(html).toContain(">Discover<");
		expect(html).not.toContain("synthwave");
	});

	test("a widened lookup is the last chip, its tooltip saying why", () => {
		const html = renderToStaticMarkup(
			<IntentChips intent={INTENT} widened="Widened to Europe, electronic" />,
		);
		expect(html).toMatch(
			/<li title="Too few candidates matched your brief[^"]*"[^>]*>Widened to Europe, electronic<\/li><\/ul>$/,
		);
		expect(
			renderToStaticMarkup(
				<IntentChips intent={null} widened="Widened to Europe" />,
			),
		).toContain(">Widened to Europe<");
	});
});
