import { createClient } from "@libsql/client";
import { drizzle as drizzleFactory } from "drizzle-orm/libsql";
import { env } from "~/env.mjs";
import * as drizzleSchema from "~/server/schema";

// Create a Better SQLite3 database connection
const getSqliteInstance = () => {
	const turso = createClient({
		url: env.TURSO_DATABASE_URL,
		authToken: env.TURSO_AUTH_TOKEN,
	});

	return drizzleFactory(turso, { schema: drizzleSchema });
};

// Use a global variable to store the drizzle instance (singleton pattern)
declare global {
	// eslint-disable-next-line no-var
	var __drizzle: ReturnType<typeof getSqliteInstance> | undefined;
}

export const drizzle = globalThis.__drizzle ?? getSqliteInstance();
if (env.NODE_ENV !== "production") globalThis.__drizzle = drizzle;

export const schema = drizzleSchema;
export * as op from "drizzle-orm";
