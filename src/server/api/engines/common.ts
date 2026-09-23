import { CREATIVITY, type Creativity } from "~/lib/creativity";
import type { ArtistCandidate, TrackCandidate } from "~/lib/playlist-stream";
import { PURPOSE, type Purpose } from "~/lib/purpose";

// Every prompt built here carries the listener's brief and settings, the
// curator's own earlier picks and facts from open music databases
// (MusicBrainz, Last.fm). Nothing read from Spotify, neither the listener's
// account nor catalogue metadata, is ever part of an engine request: the
// Spotify Developer Policy forbids ingesting Spotify content into an AI
// model, and tests/spotify-content-boundary.test.ts holds the line.

/**
 * Persona and curation rules shared by every engine request. Output format is
 * left to each prompt because playlists stream NDJSON while replacement and
 * recommendation requests expect a single object or an array.
 */
export const curatorSystemPrompt = `You are an expert music curator and DJ with deep knowledge of scenes, labels, and discographies across every era and country. You build playlists that feel hand-picked by a knowledgeable friend, not generated from a top-10 list.

Curation rules:
- Interpret the brief as a music lover would: genre, mood, era, and place. If the brief is written in a language other than English, treat that as a hint to include artists from that language's scene where it fits (around a third of the tracks), without forcing it if the brief is clearly about something else.
- Never repeat an artist within a playlist.
- Spread across eras and subgenres where the brief allows, and sequence the tracks so the playlist flows from start to finish.
- Only real, released songs by real artists that exist on Spotify. Write the artist and title exactly as Spotify lists them. Prefer the original artist over covers, live versions, or remixes unless the brief asks for them.
- Respond with JSON only: no markdown, no code fences, no commentary before or after.`;

interface PlaylistPromptProps {
	prompt: string;
	trackCount: number;
	creativity: Creativity;
	purpose: Purpose;
	/** Artists MusicBrainz found for the brief's scene or label. */
	candidateArtists?: ArtistCandidate[];
	/** Tracks on Last.fm's charts for the intent's genres. */
	candidateTracks?: TrackCandidate[];
}

const artistList = (artists: ArtistCandidate[]): string =>
	artists
		.map((artist) => {
			const about = [
				artist.label ? `on ${artist.label}` : "",
				artist.area ?? "",
				artist.tags.join(", "),
			].filter(Boolean);
			return `- ${artist.name}${about.length ? ` (${about.join("; ")})` : ""}`;
		})
		.join("\n");

const trackList = (tracks: TrackCandidate[]): string =>
	tracks.map((track) => `- ${track.artist} - ${track.title}`).join("\n");

/**
 * Reserve picks requested beyond the playlist: enough to cover a few misses
 * and duplicates, without doubling the generation for long playlists.
 */
export const surplusFor = (trackCount: number): number =>
	Math.min(10, Math.max(3, Math.round(trackCount / 2)));

export const playlistPrompt = ({
	prompt,
	trackCount,
	creativity,
	purpose,
	candidateArtists = [],
	candidateTracks = [],
}: PlaylistPromptProps): string => {
	const surplus = surplusFor(trackCount);
	const artists = candidateArtists.length
		? `

Artists MusicBrainz lists for this brief's scene, place or label; for one of these, pick the song of theirs that fits the brief best:
${artistList(candidateArtists)}`
		: "";
	const tracks = candidateTracks.length
		? `

Tracks Last.fm's listeners play most under the brief's genres:
${trackList(candidateTracks)}`
		: "";
	const any = candidateArtists.length || candidateTracks.length;
	const offered = any
		? `

Candidates were gathered for this brief. Pick most of the playlist from them. Add a song from your own knowledge only where none of them fits, and mark each song with its source: "candidates" for a track below or a song by an artist below, "recall" for one from your own knowledge.${artists}${tracks}`
		: "";
	const source = any ? ',"source":"..."' : "";
	return `Build a ${trackCount}-track playlist for this brief: "${prompt}"

${PURPOSE[purpose].instruction}${offered}

${CREATIVITY[creativity].instruction}

Respond with newline-delimited JSON, one object per line. Emit the name first, then the description (under 300 characters, explaining the thread that ties the picks together), both in the same language as the brief, then the ${trackCount} songs in listening order, then ${surplus} reserve songs (order ${trackCount + 1} to ${trackCount + surplus}) that fit the brief equally well and would stand in for any pick that turns out not to exist on Spotify:
{"kind":"name","name":"..."}
{"kind":"description","description":"..."}
{"kind":"song","order":1,"artist":"...","title":"..."${source}}`;
};

interface ReplaceSongPromptProps {
	prompt?: string;
	playlistName: string;
	playlistDescription: string;
	currentSongs: { artist: string; title: string }[];
	avoidedSongs: string[];
	creativity: Creativity;
	purpose: Purpose;
}

export const replaceSongPrompt = ({
	prompt,
	playlistName,
	playlistDescription,
	currentSongs,
	avoidedSongs,
	creativity,
	purpose,
}: ReplaceSongPromptProps): string => {
	const currentSongsStr = currentSongs
		.map((s) => `"${s.artist} - ${s.title}"`)
		.join(", ");
	const avoidedSongsStr = avoidedSongs.map((s) => `"${s}"`).join(", ");

	return `${
		prompt
			? `The original brief for this playlist was: "${prompt}".
`
			: ""
	}The playlist is named "${playlistName}" and described as: "${playlistDescription}".
Current songs: ${currentSongsStr || "none yet"}.

${PURPOSE[purpose].instruction}

${CREATIVITY[creativity].instruction}

Suggest ONE new song that fits this playlist and its brief. Do not suggest any of the current songs, and do not suggest any of these, which were already rejected or could not be found: ${avoidedSongsStr || "none"}. Avoid artists already in the playlist.

Respond with a single JSON object and nothing else:
{"kind":"song","order":-1,"artist":"Artist Name","title":"Song Title"}`;
};

// Helper to extract the first valid JSON object from a string
export function extractFirstJson(text: string): string | null {
	const startIndex = text.indexOf("{");
	if (startIndex === -1) return null;

	let balance = 0;
	let endIndex = -1;
	let insideString = false;
	let isEscaped = false;

	for (let i = startIndex; i < text.length; i++) {
		const char = text[i];

		if (isEscaped) {
			isEscaped = false;
			continue;
		}

		if (char === "\\") {
			isEscaped = true;
			continue;
		}

		if (char === '"') {
			insideString = !insideString;
			continue;
		}

		if (!insideString) {
			if (char === "{") {
				balance++;
			} else if (char === "}") {
				balance--;
				if (balance === 0) {
					endIndex = i;
					break;
				}
			}
		}
	}

	if (endIndex !== -1) {
		return text.substring(startIndex, endIndex + 1);
	}

	return null;
}

export const parseGeminiResponse = (responseText: string): string => {
	try {
		interface GeminiCandidate {
			content?: {
				parts?: Array<{ text?: string }>;
			};
		}

		interface GeminiResponse {
			candidates?: GeminiCandidate[];
		}

		const responseParsed = JSON.parse(responseText) as
			| GeminiResponse[]
			| GeminiResponse;

		if (Array.isArray(responseParsed)) {
			return responseParsed
				.map((chunk) => chunk.candidates?.[0]?.content?.parts?.[0]?.text || "")
				.join("");
		}
		// Fallback if not an array (though Gemini stream usually is)
		// or if it's a single object (non-stream)
		const singleResponse = responseParsed as GeminiResponse;
		return singleResponse.candidates?.[0]?.content?.parts?.[0]?.text || "";
	} catch (e) {
		console.error("Failed to parse Gemini response:", e);
		return responseText;
	}
};

export const parseChatGPTResponse = (responseText: string): string => {
	let cleanText = "";
	const lines = responseText.split("\n");
	for (const line of lines) {
		if (!line.trim()) continue;
		try {
			const json = JSON.parse(line);
			if (json.content) {
				cleanText += json.content;
			}
		} catch (_e) {
			// Ignore invalid lines
		}
	}
	if (!cleanText) return responseText;
	return cleanText;
};
