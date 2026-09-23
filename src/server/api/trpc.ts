import { auth } from "~/server/auth";
import { drizzle, op, schema } from "~/server/drizzle";

export const createTRPCContext = async () => {
	const session = await auth();
	return {
		session,
		drizzle,
		schema,
		op,
	};
};

import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError, z } from "zod";

const t = initTRPC.context<typeof createTRPCContext>().create({
	transformer: superjson,
	errorFormatter({ shape, error }) {
		return {
			...shape,
			data: {
				...shape.data,
				zodError:
					error.cause instanceof ZodError ? z.flattenError(error.cause) : null,
			},
		};
	},
});

export const createTRPCRouter = t.router;

export const createCallerFactory = t.createCallerFactory;

export const publicProcedure = t.procedure;

const enforceUserIsAuthed = t.middleware(({ ctx, next }) => {
	if (!ctx.session?.user) {
		throw new TRPCError({ code: "UNAUTHORIZED" });
	}
	return next({
		ctx: {
			session: { ...ctx.session, user: ctx.session.user },
		},
	});
});

export const protectedProcedure = t.procedure.use(enforceUserIsAuthed);
