import { z } from "zod";
import { PlaylistFormSchema } from "~/app/dashboard/create-playlist/playlist-form-schema";
import type { GenerationSnapshot } from "~/lib/generation-snapshot";
import { auth } from "~/server/auth";
import { GenerationConflictError } from "~/server/generation/repository";
import { generation } from "~/server/generation/runtime";

export const runtime = "nodejs";
const CreateSchema = z.object({
	id: z.string().uuid(),
	request: PlaylistFormSchema,
});
export async function POST(request: Request) {
	const session = await auth();
	if (!session) return new Response("Unauthorized", { status: 401 });
	const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return new Response("Invalid request", { status: 400 });
	let snapshot: GenerationSnapshot;
	try {
		snapshot = await generation.create(
			session.user.id,
			parsed.data.id,
			parsed.data.request,
		);
	} catch (error) {
		return new Response(
			"Could not create this generation; retry with the same request key",
			{ status: error instanceof GenerationConflictError ? 409 : 503 },
		);
	}
	return Response.json(snapshot, {
		status: 202,
		headers: { "Cache-Control": "no-store" },
	});
}
export async function GET() {
	const session = await auth();
	if (!session) return new Response("Unauthorized", { status: 401 });
	return Response.json(await generation.history(session.user.id), {
		headers: { "Cache-Control": "no-store" },
	});
}
