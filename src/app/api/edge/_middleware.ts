/**
 * Hacky workaround for edge functions when using DB sessions
 */
import { eq } from "drizzle-orm";
import type { ServerRuntime } from "next";
import { drizzle, schema } from "~/server/drizzle";
import { logger } from "~/utils";

export const runtime = "edge" satisfies ServerRuntime;

export async function edgeMiddleware(request: Request) {
	const baseUrl =
		request.headers.get("host") || request.headers.get("x-forwarded-for");
	if (!baseUrl) throw new Error("CRITICAL: No host/x-forwarded-for header");
	const redirectUrl = new URL("/auth/login", `https://${baseUrl}`).toString();

	const token = request.headers
		.get("Cookie")
		?.split("; ")
		.find((row) => row.startsWith("__Secure-authjs.session-token"))
		?.split("=")[1];

	if (!token) {
		logger.error("No token found in cookie");
		return Response.redirect(redirectUrl);
	}

	const res = await drizzle
		.select()
		.from(schema.sessions)
		.leftJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
		.where(eq(schema.sessions.sessionToken, token));

	const session = res[0];

	if (
		!session ||
		new Date() > new Date(session.session.expires) ||
		!session.user
	) {
		logger.error("No session found for token");
		return Response.redirect(redirectUrl);
	}

	return null;
}
