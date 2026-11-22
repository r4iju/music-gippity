import { createClient } from "@libsql/client";
import { drizzle as drizzleFactory } from "drizzle-orm/libsql";
import { getEnv } from "~/env.mjs";
import * as drizzleSchema from "~/server/schema";

const createDatabase = () => {
	const env = getEnv();
	const turso = createClient({
		url: env.TURSO_DATABASE_URL,
		authToken: env.TURSO_AUTH_TOKEN,
	});

	return drizzleFactory(turso, { schema: drizzleSchema });
};

// Use a global variable to store the drizzle instance (singleton pattern)
declare global {
	// eslint-disable-next-line no-var
	var __drizzle: ReturnType<typeof createDatabase> | undefined;
}

let database: ReturnType<typeof createDatabase> | undefined;

export function getDrizzle() {
	if (getEnv().NODE_ENV !== "production") {
		globalThis.__drizzle ??= createDatabase();
		return globalThis.__drizzle;
	}
	database ??= createDatabase();
	return database;
}

export const schema = drizzleSchema;
export * as op from "drizzle-orm";
