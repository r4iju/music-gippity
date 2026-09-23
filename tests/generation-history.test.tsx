import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { GenerationHistory } from "~/app/dashboard/create-playlist/generation-history";

test("history stays out of the first generation and appears when there is another playlist", () => {
	const render = (count: number) => {
		const client = new QueryClient();
		client.setQueryData(
			["playlist-generations"],
			Array.from({ length: count }, (_, i) => ({
				id: `playlist-${i}`,
				name: `Playlist ${i}`,
				prompt: "Fixture",
				status: "complete",
				createdAt: 1,
			})),
		);
		return renderToStaticMarkup(
			<QueryClientProvider client={client}>
				<GenerationHistory />
			</QueryClientProvider>,
		);
	};
	expect(render(0)).toBe("");
	expect(render(1)).toBe("");
	expect(render(2)).toContain('aria-expanded="false"');
	expect(render(2)).toContain("Previous playlists");
});
