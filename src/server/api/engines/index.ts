import { ENGINES, type EngineId } from "~/lib/engines";
import { parseChatGPTResponse, parseGeminiResponse } from "./common";
import { geminiEngine } from "./engine-gemini";
import { chatgptEngine } from "./engine-openai";

export interface EngineRequest {
	requireCompletion?: boolean;
	/** Explicit in background jobs; legacy HTTP callers can use their request session. */
	userId?: string;
	signal?: AbortSignal;
	/** Persona and standing rules; sent as the provider's system instruction. */
	system?: string;
	prompt: string;
	temperature: number;
}

export type EngineResult = ReadableStream<Uint8Array> | Response;

/** Dispatch a prompt to the engine the user picked. */
export function runEngine(
	engineId: EngineId,
	request: EngineRequest,
): Promise<EngineResult> {
	switch (ENGINES[engineId].provider) {
		case "openai":
			return chatgptEngine(request);
		case "google":
			return geminiEngine(request);
	}
}

/** Collect an engine's stream into the raw text it produced. */
export async function collectEngineText(
	result: ReadableStream<Uint8Array>,
): Promise<string> {
	const reader = result.getReader();
	const decoder = new TextDecoder();
	let text = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		text += decoder.decode(value, { stream: true });
	}
	return text;
}

/**
 * One-shot request: the engine's whole reply as plain text, with the
 * provider's stream framing removed. Throws on an HTTP error or once
 * `deadlineMs` passes, aborting the request so nothing keeps streaming.
 */
export async function requestEngineText(
	engineId: EngineId,
	request: EngineRequest,
	deadlineMs: number,
): Promise<string> {
	const abort = new AbortController();
	let deadline: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			(async () => {
				const result = await runEngine(engineId, {
					...request,
					signal: request.signal
						? AbortSignal.any([abort.signal, request.signal])
						: abort.signal,
				});
				if (result instanceof Response)
					throw new Error(`${engineId} HTTP ${result.status}`);
				const raw = await collectEngineText(result);
				return ENGINES[engineId].provider === "google"
					? parseGeminiResponse(raw)
					: parseChatGPTResponse(raw);
			})(),
			new Promise<never>((_, reject) => {
				deadline = setTimeout(() => {
					reject(new Error(`${engineId} timed out after ${deadlineMs} ms`));
					abort.abort();
				}, deadlineMs);
			}),
		]);
	} finally {
		clearTimeout(deadline);
	}
}
