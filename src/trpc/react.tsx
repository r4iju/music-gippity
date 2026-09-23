"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import type React from "react";
import { useMemo } from "react";

import type { AppRouter } from "~/server/api/root";
import { getBaseUrl, transformer } from "./shared";

export const api = createTRPCReact<AppRouter>();

type Props = {
	children: React.ReactNode;
	headers?: Headers;
};

export function TRPCReactProvider({ children, headers }: Props) {
	const queryClient = new QueryClient();

	// Create two separate clients for api and apiEdge
	const trpcClient = useMemo(
		() =>
			api.createClient({
				links: [
					loggerLink({
						enabled: (op) =>
							process.env.NODE_ENV === "development" ||
							(op.direction === "down" && op.result instanceof Error),
					}),
					httpBatchLink({
						transformer,
						url: `${getBaseUrl()}/api/trpc`,
						headers: () => {
							const heads = new Map(headers);
							heads.set("x-trpc-source", "react");
							return Object.fromEntries(heads);
						},
					}),
				],
			}),
		[headers],
	);

	return (
		<QueryClientProvider client={queryClient}>
			<api.Provider client={trpcClient} queryClient={queryClient}>
				{children}
			</api.Provider>
		</QueryClientProvider>
	);
}
