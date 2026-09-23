// src/server/api/engines/engine-gemini.ts
import { z } from "zod";
import { env } from "~/env.mjs";
import { ENGINES } from "~/lib/engines";
import { extractJSONObject } from "~/server/api/stream-helpers";
import { auth } from "~/server/auth";
import { drizzle, schema } from "~/server/drizzle";
import { logger } from "~/utils";

// Thinking is on, so Gemini bills thought tokens as output too; they are
// added to the candidates so the row matches OpenAI's, whose completion
// count includes reasoning.
const UsageSchema = z.object({
	promptTokenCount: z.number(),
	candidatesTokenCount: z.number(),
	thoughtsTokenCount: z.number().optional(),
	totalTokenCount: z.number(),
});

/**
 * The usage the stream reported last: every chunk carries the count so
 * far, so only the final one is the call's usage.
 */
function finalUsage(raw: string): z.infer<typeof UsageSchema> | undefined {
	let usage: z.infer<typeof UsageSchema> | undefined;
	for (
		let found = extractJSONObject(raw);
		found;
		found = extractJSONObject(found.rest)
	) {
		try {
			const parsed = UsageSchema.safeParse(
				(JSON.parse(found.json) as { usageMetadata?: unknown }).usageMetadata,
			);
			if (parsed.success) usage = parsed.data;
		} catch {
			// A chunk that is not JSON carries no usage.
		}
	}
	return usage;
}

async function logTokenUsage(raw: string, ownerId?: string) {
	const usage = finalUsage(raw);
	if (!usage) {
		logger.warning("Gemini stream ended without usage metadata");
		return;
	}
	const userId = ownerId ?? (await auth())?.user.id;
	if (!userId) {
		logger.error("No session found");
		return;
	}
	await drizzle.insert(schema.llmTokenUsage).values({
		userId,
		engine: "gemini",
		inputTokens: usage.promptTokenCount,
		outputTokens: usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0),
		totalTokens: usage.totalTokenCount,
	});
}

/**
 * Passes the stream through unchanged and records its usage once it ends,
 * so a call records usage whether the route streams it or collects it.
 */
function recordingUsage(
	userId?: string,
	requireCompletion = false,
): TransformStream<Uint8Array, Uint8Array> {
	const decoder = new TextDecoder();
	let raw = "";
	return new TransformStream({
		transform(chunk, controller) {
			raw += decoder.decode(chunk, { stream: true });
			controller.enqueue(chunk);
		},
		async flush() {
			if (requireCompletion) {
				const chunks = z
					.array(
						z.object({
							candidates: z
								.array(z.object({ finishReason: z.string().optional() }))
								.optional(),
						}),
					)
					.parse(JSON.parse(raw));
				if (
					!chunks.some((chunk) =>
						chunk.candidates?.some(
							(candidate) => candidate.finishReason === "STOP",
						),
					)
				)
					throw new Error("Curator stream ended without confirmation");
			}
			// Accounting must never abort a playlist that was already delivered.
			try {
				await logTokenUsage(raw, userId);
			} catch (error) {
				logger.error("geminiEngine: failed to record usage", error as Error);
			}
		},
	});
}

interface Props {
	requireCompletion?: boolean;
	userId?: string;
	signal?: AbortSignal;
	system?: string;
	prompt: string;
	temperature: number;
}

/** Gemini's streamGenerateContent JSON array, passed through unchanged. */
export async function geminiEngine({
	requireCompletion = false,
	userId,
	signal,
	system,
	prompt,
	temperature,
}: Props): Promise<ReadableStream<Uint8Array> | Response> {
	const url = `https://generativelanguage.googleapis.com/v1beta/models/${ENGINES.gemini.model}:streamGenerateContent`;
	const requestBody = {
		...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
		contents: [{ parts: [{ text: prompt }] }],
		generationConfig: {
			temperature,
			thinkingConfig: { thinkingLevel: "low" },
		},
	};

	try {
		logger.info("Gemini request started");
		const response = await fetch(url, {
			signal,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-goog-api-key": env.GEMINI_API_KEY,
			},
			body: JSON.stringify(requestBody),
		});
		logger.info("Gemini API response status:", response.status);
		if (!response.ok) {
			const errorText = await response.text();
			logger.error("Gemini request failed", response.status);
			return new Response(errorText, {
				status: response.status,
				statusText: response.statusText,
			});
		}
		if (!response.body) {
			logger.error("Gemini engine: response.body is null");
			return new Response("No response body", { status: 500 });
		}
		return response.body.pipeThrough(recordingUsage(userId, requireCompletion));
	} catch (error: unknown) {
		let errorMessage = "Unknown error";
		if (error instanceof Error) {
			logger.error("Gemini transport failed");
			errorMessage = error.message;
		}
		return new Response(`Error from Gemini: ${errorMessage}`, { status: 500 });
	}
}
