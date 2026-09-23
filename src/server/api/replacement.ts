import {
	CREATIVITY,
	type Creativity,
	DEFAULT_CREATIVITY,
} from "~/lib/creativity";
import { ENGINES, type EngineId } from "~/lib/engines";
import type { Purpose } from "~/lib/purpose";
import { collectEngineText, runEngine } from "~/server/api/engines";
import {
	curatorSystemPrompt,
	extractFirstJson,
	parseChatGPTResponse,
	parseGeminiResponse,
	replaceSongPrompt,
} from "~/server/api/engines/common";
import { logger } from "~/utils";

export interface ReplacementBrief {
	prompt?: string;
	playlistName: string;
	playlistDescription: string;
	currentSongs: { artist: string; title: string }[];
	avoidedSongs: string[];
	purpose: Purpose;
}

export type Suggestion = { artist: string; title: string };

/**
 * Ask an engine for one song that fits the playlist. Returns null when the
 * engine fails or produces no parseable song, so callers can decide whether
 * to surface an error or keep the original track.
 */
export async function suggestReplacement(
	engine: EngineId,
	brief: ReplacementBrief,
	creativity: Creativity = DEFAULT_CREATIVITY,
	signal?: AbortSignal,
	userId?: string,
	strict = false,
): Promise<Suggestion | null> {
	let raw: string;
	try {
		const result = await runEngine(engine, {
			requireCompletion: strict,
			userId,
			signal,
			system: curatorSystemPrompt,
			prompt: replaceSongPrompt({ ...brief, creativity }),
			temperature: CREATIVITY[creativity].temperature,
		});
		if (result instanceof Response) {
			if (strict) throw new Error("Replacement request did not complete");
			logger.error("suggestReplacement: engine error", result.status);
			return null;
		}
		raw = await collectEngineText(result);
	} catch (error) {
		if (strict) throw error;
		logger.error("suggestReplacement: engine unreachable", error as Error);
		return null;
	}
	const clean =
		ENGINES[engine].provider === "google"
			? parseGeminiResponse(raw)
			: parseChatGPTResponse(raw);
	const json = extractFirstJson(clean);
	if (!json) {
		logger.error("suggestReplacement: no JSON in engine output", clean);
		return null;
	}
	try {
		const parsed = JSON.parse(json) as Partial<Suggestion>;
		if (typeof parsed.artist === "string" && typeof parsed.title === "string") {
			return { artist: parsed.artist, title: parsed.title };
		}
	} catch (error) {
		logger.error("suggestReplacement: invalid JSON", error as Error);
	}
	return null;
}
