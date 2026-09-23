import { appRouter } from "~/server/api/root";
import { createCallerFactory, createTRPCContext } from "~/server/api/trpc";

// Server Components call the router in-process. The previous HTTP client hit
// `https://$VERCEL_URL/api/trpc`, which is the protected deployment URL and
// answers with the Vercel SSO login page instead of JSON.
export const api = createCallerFactory(appRouter)(createTRPCContext);
