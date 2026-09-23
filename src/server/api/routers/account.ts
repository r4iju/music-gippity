import { deleteUserData } from "~/server/account-deletion";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { UpdateUserSchema } from "./account-schema";

export const accountRouter = createTRPCRouter({
	getTokenUsage: protectedProcedure.query(async ({ ctx }) => {
		const rows = await ctx.drizzle
			.select({
				engine: ctx.schema.llmTokenUsage.engine,
				inputTokens: ctx.schema.llmTokenUsage.inputTokens,
				outputTokens: ctx.schema.llmTokenUsage.outputTokens,
				totalTokens: ctx.schema.llmTokenUsage.totalTokens,
			})
			.from(ctx.schema.llmTokenUsage)
			.where(ctx.op.eq(ctx.schema.llmTokenUsage.userId, ctx.session.user.id));

		// should return an array of objects with the total tokens, input tokens, and output tokens per engine
		const tokenUsage = rows.reduce(
			(acc, row) => {
				acc[row.engine] = {
					totalTokens: acc[row.engine].totalTokens + row.totalTokens,
					inputTokens: acc[row.engine].inputTokens + row.inputTokens,
					outputTokens: acc[row.engine].outputTokens + row.outputTokens,
				};
				return acc;
			},
			{
				chatgpt: {
					totalTokens: 0,
					inputTokens: 0,
					outputTokens: 0,
				},
				gemini: {
					totalTokens: 0,
					inputTokens: 0,
					outputTokens: 0,
				},
			},
		);
		return tokenUsage;
	}),
	updateUser: protectedProcedure
		.input(UpdateUserSchema)
		.mutation(async ({ ctx, input }) => {
			const res = await ctx.drizzle
				.update(ctx.schema.users)
				.set({ name: input.name, email: input.email })
				.where(ctx.op.eq(ctx.schema.users.id, ctx.session.user.id))
				.returning();

			return res[0];
		}),
	deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
		await deleteUserData(ctx.drizzle, ctx.session.user.id);
	}),
});
