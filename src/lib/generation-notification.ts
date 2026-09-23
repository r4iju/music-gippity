import { z } from "zod";
import { PhaseSchema } from "./generation-run";

export const GenerationNotificationSchema = z.object({
	playlistId: z.string().uuid(),
	revision: z.number().int().nonnegative(),
	phase: PhaseSchema,
});
export type GenerationNotification = z.infer<
	typeof GenerationNotificationSchema
>;
export const NotificationEnvelopeSchema = z.object({
	cursor: z.number().int().nonnegative(),
	notification: GenerationNotificationSchema,
});
