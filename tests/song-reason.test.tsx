import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SongReason } from "~/app/dashboard/create-playlist/song-reason";

describe("SongReason", () => {
	test("shows the reason in the row and nothing before one arrives", () => {
		expect(renderToStaticMarkup(<SongReason reason={undefined} />)).toBe("");
		const html = renderToStaticMarkup(
			<SongReason reason="Opens the drive with a slow-burning pulse" />,
		);
		expect(html).toContain("Opens the drive with a slow-burning pulse");
		expect(html).toContain('title="Opens the drive with a slow-burning pulse"');
	});

	test("labels the line as the AI curator's, not Spotify metadata", () => {
		const html = renderToStaticMarkup(
			<SongReason reason="Opens the drive with a slow-burning pulse" />,
		);
		expect(html).toContain("AI curator");
		expect(html).toContain(
			'aria-label="AI curator&#x27;s note: Opens the drive with a slow-burning pulse"',
		);
	});
});
