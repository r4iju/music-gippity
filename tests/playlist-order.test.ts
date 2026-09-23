import { describe, expect, test } from "bun:test";
import { applyOrder } from "~/lib/playlist-order";

describe("applyOrder", () => {
	test("named songs lead in the named order, the rest follow, numbering restarts", () => {
		const songs = [
			{ id: "a", order: 1 },
			{ id: "b", order: 2 },
			{ id: "c", order: 3 },
			{ id: "d", order: 4 },
		];
		expect(applyOrder(songs, ["c", "a", "ghost"])).toEqual([
			{ id: "c", order: 1 },
			{ id: "a", order: 2 },
			{ id: "b", order: 3 },
			{ id: "d", order: 4 },
		]);
		expect(applyOrder(songs, [])).toEqual(songs);
	});
});
