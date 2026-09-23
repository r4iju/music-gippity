import { auth } from "~/server/auth";
import { generation } from "~/server/generation/runtime";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
	const session = await auth();
	if (!session) return new Response("Unauthorized", { status: 401 });
	const { id } = await context.params;
	const snapshot = await generation.observe(session.user.id, id);
	if (!snapshot) return new Response("Not found", { status: 404 });
	return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
export async function DELETE(_request: Request, context: Context) {
	const session = await auth();
	if (!session) return new Response("Unauthorized", { status: 401 });
	const snapshot = await generation.cancel(
		session.user.id,
		(await context.params).id,
	);
	return snapshot
		? Response.json(snapshot, { headers: { "Cache-Control": "no-store" } })
		: new Response("Not found", { status: 404 });
}
