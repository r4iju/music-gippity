import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { OpenInSpotify } from "~/components/spotify/open-in-spotify";
import { SpotifyAttribution } from "~/components/spotify/spotify-attribution";
import { SpotifyLogo } from "~/components/spotify/spotify-logo";
import { spotifyUrl } from "~/lib/spotify-links";

describe("OpenInSpotify", () => {
	test("links to the item on open.spotify.com in a new tab with guideline wording", () => {
		const html = renderToStaticMarkup(
			<OpenInSpotify kind="track" id="4uLU6hMCjMI75M1A2tKUQC" subject="Song" />,
		);
		expect(html).toContain(
			'href="https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"',
		);
		expect(html).toContain('target="_blank"');
		expect(html).toContain('rel="noopener noreferrer"');
		expect(html).toContain('aria-label="Listen on Spotify: Song"');
		expect(html).toContain("Listen on Spotify");
	});

	test("escapes ids and wraps custom bodies such as artwork", () => {
		expect(spotifyUrl("playlist", "a/b")).toBe(
			"https://open.spotify.com/playlist/a%2Fb",
		);
		const html = renderToStaticMarkup(
			<OpenInSpotify kind="album" id="abc" label="Open Spotify">
				<span data-artwork>cover</span>
			</OpenInSpotify>,
		);
		expect(html).toContain('aria-label="Open Spotify"');
		expect(html).toContain("<span data-artwork");
	});
});

describe("SpotifyAttribution", () => {
	test("names Spotify in text and shows the full logo at the minimum size", () => {
		const html = renderToStaticMarkup(<SpotifyAttribution />);
		expect(html).toContain("Music data and artwork from Spotify");
		expect(html).toContain("/assets/spotify/full-logo-black.svg");
		expect(html).toContain("/assets/spotify/full-logo-white.svg");
	});

	test("the full logo never renders below the 70px guideline minimum", () => {
		const html = renderToStaticMarkup(<SpotifyLogo width={30} />);
		expect(html).toContain('width="70"');
	});
});
