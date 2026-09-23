import { describe, expect, test } from "bun:test";
import { asPurpose } from "~/lib/purpose";

describe("asPurpose", () => {
	test("keeps a known purpose and reads anything else as discovery", () => {
		expect(asPurpose("comfort")).toBe("comfort");
		expect(asPurpose("background")).toBe("discover");
		expect(asPurpose(undefined)).toBe("discover");
	});
});
