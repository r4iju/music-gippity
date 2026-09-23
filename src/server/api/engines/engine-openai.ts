// src/server/api/engines/engine-openai.ts

import { z } from "zod";
import { env } from "~/env.mjs";
import { ENGINES } from "~/lib/engines";
import { auth } from "~/server/auth";
import { drizzle, schema } from "~/server/drizzle";
import { logger } from "~/utils";

const UsageSchema = z.object({
	prompt_tokens: z.number(),
	completion_tokens: z.number(),
	total_tokens: z.number(),
});

// With stream_options.include_usage the final chunk carries `usage` and an
// empty `choices` array.
const ChunkSchema = z.object({
	choices: z.array(
		z.object({
			delta: z.object({
				content: z.string().nullish(),
			}),
		}),
	),
	usage: UsageSchema.nullish(),
});

type Usage = z.infer<typeof UsageSchema>;

type Props = {
	requireCompletion?: boolean;
	userId?: string;
	system?: string;
	prompt: string;
	temperature: number;
	signal?: AbortSignal;
};

const engine = ENGINES.chatgpt;

export async function chatgptEngine({
	requireCompletion = false,
	userId,
	signal,
	system,
	prompt,
	temperature,
}: Props): Promise<ReadableStream<Uint8Array> | Response> {
	logger.info("chatgptEngine request started");

	const response = await fetch("https://api.openai.com/v1/chat/completions", {
		signal,
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${env.OPENAI_KEY}`,
			"Openai-Organization": env.OPENAI_ORGANIZATION_ID,
		},
		body: JSON.stringify({
			model: engine.model,
			messages: [
				...(system ? [{ role: "system", content: system }] : []),
				{ role: "user", content: prompt },
			],
			max_completion_tokens: 10000,
			reasoning_effort: "none",
			stream_options: { include_usage: true },
			temperature,
			stream: true,
		}),
	});

	logger.info("chatgptEngine response status:", response.status);
	if (!response.ok) {
		const errorText = await response.text();
		logger.error("chatgptEngine request failed", response.status);
		return new Response(errorText, {
			status: response.status,
			statusText: response.statusText,
		});
	}

	const textEncoder = new TextEncoder();
	const decoder = new TextDecoder();
	return new ReadableStream({
		async start(controller) {
			if (!response.body) {
				if (requireCompletion)
					throw new Error("Curator response body is missing");
				logger.error("chatgptEngine: response.body is null");
				controller.close();
				return;
			}
			const reader = response.body.getReader();
			let partial = "";
			let fullContent = "";
			let usage: Usage | undefined;

			const handleEvent = (dataStr: string) => {
				try {
					const parsedChunk = ChunkSchema.parse(JSON.parse(dataStr));
					if (parsedChunk.usage) usage = parsedChunk.usage;
					const content = parsedChunk.choices
						.map((choice) => choice.delta.content ?? "")
						.join("");
					if (content) {
						fullContent += content;
						controller.enqueue(
							textEncoder.encode(`${JSON.stringify({ content })}\n`),
						);
					}
				} catch (error) {
					if (requireCompletion) throw error;
					logger.error("chatgptEngine: error parsing chunk:", error as Error);
				}
			};

			const finish = async () => {
				// Accounting must never abort a playlist that was already delivered.
				try {
					await logTokenUsage(prompt, fullContent, usage, userId);
				} catch (error) {
					logger.error("chatgptEngine: failed to record usage", error as Error);
				} finally {
					controller.close();
				}
			};

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				partial += decoder.decode(value, { stream: true });
				const lines = partial.split("\n");
				partial = lines.pop() || "";
				for (const line of lines) {
					if (line.trim() === "data: [DONE]") {
						logger.info("chatgptEngine: [DONE] received. Closing stream.");
						await finish();
						return;
					}
					if (line.startsWith("data: ")) {
						const dataStr = line.substring(6).trim();
						if (dataStr) handleEvent(dataStr);
					}
				}
			}

			const trailing = partial.trim();
			if (requireCompletion && trailing !== "data: [DONE]")
				throw new Error("Curator stream ended without confirmation");
			if (trailing.startsWith("data: ") && !trailing.includes("[DONE]")) {
				handleEvent(trailing.substring(6));
			}
			await finish();
		},
	});
}

async function logTokenUsage(
	prompt: string,
	output: string,
	usage?: Usage,
	ownerId?: string,
) {
	// Fallback for streams that end without a usage chunk.
	const approxTokens = (text: string) => Math.ceil(text.length / 4);
	const inputTokens = usage?.prompt_tokens ?? approxTokens(prompt);
	const outputTokens = usage?.completion_tokens ?? approxTokens(output);
	const totalTokens = usage?.total_tokens ?? inputTokens + outputTokens;
	logger.info(
		`${usage ? "Reported" : "Approximate"} token usage: input ${inputTokens}, output ${outputTokens}, total ${totalTokens}`,
	);
	const userId = ownerId ?? (await auth())?.user.id;
	if (!userId) {
		logger.error("No session found");
		return;
	}
	await drizzle.insert(schema.llmTokenUsage).values({
		userId,
		engine: "chatgpt",
		inputTokens,
		outputTokens,
		totalTokens,
	});
}
