import { createTRPCRouter } from "~/server/api/trpc";
import { accountRouter } from "./routers/account";
import { playlistRouter } from "./routers/playlist";

export const appRouter = createTRPCRouter({
	playlist: playlistRouter,
	account: accountRouter,
});

export type AppRouter = typeof appRouter;
