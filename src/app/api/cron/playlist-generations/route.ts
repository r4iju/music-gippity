import { generation } from "~/server/generation/runtime";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
	const secret = process.env.CRON_SECRET;
	if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
		return new Response("Unauthorized", { status: 401 });
	const result = await generation.recover();
	return Response.json(result, {
		status: result.failed ? 503 : 200,
		headers: { "Cache-Control": "no-store" },
	});
}
