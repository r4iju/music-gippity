import { GenerationNotificationSchema } from "~/lib/generation-notification";
import { auth } from "~/server/auth";
import { generation } from "~/server/generation/runtime";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(
	request: Request,
	context: { params: Promise<{ id: string }> },
) {
	const session = await auth();
	if (!session) return new Response("Unauthorized", { status: 401 });
	const { id } = await context.params;
	if (!(await generation.observe(session.user.id, id)))
		return new Response("Not found", { status: 404 });
	const requested = Number(
		new URL(request.url).searchParams.get("cursor") ?? 0,
	);
	let cursor =
		Number.isSafeInteger(requested) && requested >= 0 ? requested : 0;
	const source = await generation.notifications(session.user.id, id, cursor);
	if (!source) return new Response(null, { status: 204 });
	const reader = source.getReader();
	const encoder = new TextEncoder();
	const signal = AbortSignal.any([request.signal, AbortSignal.timeout(50_000)]);
	const abort = () => {
		void reader.cancel().catch(() => {});
	};
	signal.addEventListener("abort", abort, { once: true });
	if (signal.aborted) abort();
	return new Response(
		new ReadableStream({
			async pull(controller) {
				try {
					const { done, value } = await reader.read();
					if (done) {
						signal.removeEventListener("abort", abort);
						reader.releaseLock();
						controller.close();
						return;
					}
					const notification = GenerationNotificationSchema.parse(value);
					if (notification.playlistId !== id)
						throw new Error("Wrong playlist notification");
					controller.enqueue(
						encoder.encode(
							`${JSON.stringify({ cursor: ++cursor, notification })}\n`,
						),
					);
				} catch (error) {
					signal.removeEventListener("abort", abort);
					await reader.cancel().catch(() => {});
					reader.releaseLock();
					controller.error(error);
				}
			},
			async cancel() {
				signal.removeEventListener("abort", abort);
				await reader.cancel().catch(() => {});
				reader.releaseLock();
			},
		}),
		{
			headers: {
				"Content-Type": "application/x-ndjson",
				"Cache-Control": "no-store, no-transform",
			},
		},
	);
}
