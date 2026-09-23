import { z } from "zod";

export const UpdateUserSchema = z.object({
	name: z.string().min(1, "Name is required"),
	email: z.email("Email must be a valid email address"),
});
