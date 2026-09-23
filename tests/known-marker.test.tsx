import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { KnownMarker } from "~/app/dashboard/create-playlist/known-marker";

describe("KnownMarker", () => {
	test("marks only a recording the listener already knows", () => {
		expect(renderToStaticMarkup(<KnownMarker familiarity="known" />)).toContain(
			"You know this",
		);
		for (const familiarity of ["known-artist", "new", undefined] as const)
			expect(
				renderToStaticMarkup(<KnownMarker familiarity={familiarity} />),
			).toBe("");
	});
});
