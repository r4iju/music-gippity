// src/app/api/edge/recommendations/route.ts

import type { ServerRuntime } from "next";
import { z } from "zod";
import {
	CREATIVITY,
	CREATIVITY_LEVELS,
	DEFAULT_CREATIVITY,
} from "~/lib/creativity";
import { ENGINE_IDS } from "~/lib/engines";
import { runEngine } from "~/server/api/engines";
import { curatorSystemPrompt } from "~/server/api/engines/common";
import { processEngineStream } from "~/server/api/stream-helpers";
import { auth } from "~/server/auth";
import { logger } from "~/utils";

export const runtime = "edge" satisfies ServerRuntime;

const RecommendationSchema = z.object({
	engine: z.enum(ENGINE_IDS),
	mood: z.string(),
	genres: z.array(z.string()),
	selectedArtists: z.array(z.string()),
	rejectedArtists: z.array(z.string()),
	expectedCount: z.number(),
	creativity: z.enum(CREATIVITY_LEVELS).default(DEFAULT_CREATIVITY),
});

function createRecommendationPrompt({
	mood,
	genres,
	expectedCount,
	selectedArtists,
	rejectedArtists,
}: Omit<
	z.infer<typeof RecommendationSchema>,
	"engine" | "creativity"
>): string {
	return `Based on the mood "${mood}" and the genres ${genres.join(
		", ",
	)}, please recommend exactly ${expectedCount} new artists that have not been previously selected.
Do use the following selected artists as a reference for similarity: ${selectedArtists.join(", ") || "none"}.
Exclude the following rejected artists: ${rejectedArtists.join(", ") || "none"}.
Provide the response in the following JSON format:
[
  {
    "artist": "Artist Name 1"
  },
  {
    "artist": "Artist Name 2"
  },
  ...
]
Do not include any extra text.`;
}

export async function POST(req: Request) {
	const session = await auth();
	if (!session) return new Response("Unauthorized", { status: 401 });

	try {
		const body: unknown = await req.json();
		const validated = RecommendationSchema.parse(body);
		const {
			engine,
			mood,
			genres,
			selectedArtists,
			rejectedArtists,
			expectedCount,
			creativity,
		} = validated;
		const prompt = createRecommendationPrompt({
			mood,
			genres,
			expectedCount,
			selectedArtists,
			rejectedArtists,
		});
		logger.info("Recommendation prompt:", prompt);

		logger.info(`Using ${engine} engine.`);
		const result = await runEngine(engine, {
			system: curatorSystemPrompt,
			prompt,
			temperature: CREATIVITY[creativity].temperature,
		});

		if (result instanceof Response) {
			logger.error("Engine returned an error response:", result);
			return result;
		}

		const textEncoder = new TextEncoder();
		const incrementalStream = new ReadableStream<Uint8Array>({
			async start(controller) {
				await processEngineStream<{ artist: string }>(
					result,
					controller,
					(obj) => {
						// For recommendations, simply forward objects that have an "artist" property.
						if ("artist" in obj) {
							controller.enqueue(
								textEncoder.encode(`${JSON.stringify(obj)}\n`),
							);
						} else {
							logger.warning("Unrecognized object:", obj);
						}
					},
				);
				controller.close();
			},
		});

		return new Response(incrementalStream, {
			headers: { "Content-Type": "text/event-stream; charset=utf-8" },
		});
	} catch (error: unknown) {
		if (error instanceof Error) {
			logger.error("Error in /api/recommendations:", error);
			return new Response(`Error processing request: ${error.message}`, {
				status: 500,
			});
		}
		logger.error("Unknown error in /api/recommendations");
		return new Response(`Error processing request`, { status: 500 });
	}
}
