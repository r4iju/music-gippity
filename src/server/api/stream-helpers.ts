// src/server/api/stream-helpers.ts

import { logger } from "~/utils";

/** The first complete JSON object in the buffer, found by bracket counting, and what follows it. */
export function extractJSONObject(
	buffer: string,
): { json: string; rest: string } | null {
	// Remove any leading whitespace, commas, or '[' characters.
	buffer = buffer.trim().replace(/^(\[|,)+/, "");
	const start = buffer.indexOf("{");
	if (start === -1) return null;
	let inString = false;
	let isEscape = false;
	let count = 0;
	let end = -1;
	for (let i = start; i < buffer.length; i++) {
		const char = buffer[i];
		if (inString) {
			if (isEscape) {
				isEscape = false;
			} else if (char === "\\") {
				isEscape = true;
			} else if (char === '"') {
				inString = false;
			}
		} else {
			if (char === '"') {
				inString = true;
			} else if (char === "{") {
				count++;
			} else if (char === "}") {
				count--;
				if (count === 0) {
					end = i + 1;
					break;
				}
			}
		}
	}
	if (end === -1) return null;
	const jsonStr = buffer.slice(start, end);
	const rest = buffer.slice(end);
	return { json: jsonStr, rest };
}

export async function processEngineStream<T extends object>(
	stream: ReadableStream<Uint8Array>,
	_controller: ReadableStreamDefaultController<Uint8Array> | undefined,
	processObject: (obj: T) => Promise<void> | void,
	signal?: AbortSignal,
	strict = false,
) {
	const reader = stream.getReader();
	const abort = () => {
		void reader.cancel().catch(() => {});
	};
	signal?.addEventListener("abort", abort, { once: true });
	const decoder = new TextDecoder("utf-8");
	let rawBuffer = ""; // accumulates raw JSON fragments from the stream
	let tokenBuffer = ""; // accumulates token text from ChatGPT or Gemini

	try {
		// Read from the stream.
		while (true) {
			signal?.throwIfAborted();
			const { done, value } = await reader.read();
			signal?.throwIfAborted();
			if (done) break;
			rawBuffer += decoder.decode(value, { stream: true });

			// Process any complete raw JSON objects from rawBuffer.
			let extracted = extractJSONObject(rawBuffer);
			while (extracted !== null) {
				signal?.throwIfAborted();
				const { json, rest } = extracted;
				rawBuffer = rest;
				let parsed: T;
				try {
					parsed = JSON.parse(json) as T;
				} catch (err) {
					if (strict) throw err;
					console.error("Error parsing raw JSON:", err, json);
					// If the JSON is malformed, we might have a partial object or just garbage.
					// For now, we'll skip it and try to extract the next one.
					extracted = extractJSONObject(rawBuffer); // Try to get the next object
					continue;
				}

				// If the object is a token fragment from ChatGPT...
				if ("content" in parsed && typeof parsed.content === "string") {
					// ...remove code fences and add to tokenBuffer.
					const content = parsed.content.replace(/```/g, "");
					tokenBuffer += content;
				}
				// ...or if it’s a Gemini token fragment.
				else if ("candidates" in parsed && Array.isArray(parsed.candidates)) {
					const candidate = parsed.candidates[0] as {
						content: { parts: { text: string }[] };
					};
					if (candidate?.content?.parts) {
						const candidateText = candidate.content.parts
							.map((p) => p.text)
							.join("");
						tokenBuffer += candidateText;
					}
				}

				// Otherwise, process the object immediately.
				else {
					await processObject(parsed);
				}

				// Now, try to extract complete JSON objects from tokenBuffer.
				let tokenExtracted = extractJSONObject(tokenBuffer);
				while (tokenExtracted !== null) {
					signal?.throwIfAborted();
					const { json: completeJsonStr, rest: remaining } = tokenExtracted;
					tokenBuffer = remaining;

					try {
						const completeJson = JSON.parse(completeJsonStr) as T;
						await processObject(completeJson);
					} catch (e) {
						if (strict) throw e;
						signal?.throwIfAborted();
						logger.error(
							"stream-helpers: error parsing extracted token object",
							e as Error,
						);
					}

					tokenExtracted = extractJSONObject(tokenBuffer);
				}

				extracted = extractJSONObject(rawBuffer);
			}
		}
		if (
			strict &&
			(rawBuffer.replace(/[\s,[\]`]/g, "") ||
				tokenBuffer.replace(/[\s,[\]`]/g, ""))
		)
			throw new Error("Curator stream ended with incomplete content");
	} finally {
		signal?.removeEventListener("abort", abort);
		void reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

// Optional: if you need to create an NDJSON stream from items.
export function createNDJSONStream<T>(items: T[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			for (const item of items) {
				controller.enqueue(encoder.encode(`${JSON.stringify(item)}\n`));
			}
			controller.close();
		},
	});
}
