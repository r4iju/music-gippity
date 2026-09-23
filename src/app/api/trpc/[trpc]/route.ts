import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { ServerRuntime } from "next";
import type { NextRequest } from "next/server";

import { env } from "~/env.mjs";
import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { logger } from "~/utils";

export const runtime = "edge" satisfies ServerRuntime;

const handler = (req: NextRequest) =>
	fetchRequestHandler({
		endpoint: "/api/trpc",
		req,
		router: appRouter,
		createContext: createTRPCContext,
		onError:
			env.NODE_ENV === "development"
				? ({ path, error }) => {
						logger.error(
							`❌ tRPC failed on ${path ?? "<no-path>"}: ${error.message}`,
						);
					}
				: undefined,
	});

export { handler as GET, handler as POST };
