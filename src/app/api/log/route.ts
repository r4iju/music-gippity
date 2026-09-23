import type { NextRequest } from "next/server";
import { logger } from "~/utils";

type LogMessage = {
	level: keyof typeof logger;
	message: string;
};

export async function POST(req: NextRequest) {
	try {
		const { level, message } = (await req.json()) as LogMessage;
		if (!level || !message) {
			return new Response(
				JSON.stringify({ error: "Missing required fields" }),
				{ status: 400 },
			);
		}

		logger[level](message);

		return new Response(JSON.stringify({ success: true }), { status: 201 });
	} catch (error) {
		let errorMessage = "Unknown error";
		if (error instanceof Error) {
			errorMessage = error.message;
		}
		return new Response(JSON.stringify({ error: errorMessage }), {
			status: 500,
		});
	}
}
