import type { Config } from "drizzle-kit";

import { getEnv } from "~/env.mjs";

const CONFIG = {
	development: {
		schema: "./src/server/schema.ts",
		out: "./migrations",
		dialect: "turso",
		dbCredentials: {
			url: getEnv().TURSO_DATABASE_URL,
			authToken: getEnv().TURSO_AUTH_TOKEN,
		},
	} satisfies Config,
	production: {
		schema: "./src/server/schema.ts",
		out: "./migrations",
		dialect: "turso",
		dbCredentials: {
			url: getEnv().TURSO_DATABASE_URL,
			authToken: getEnv().TURSO_AUTH_TOKEN,
		},
	} satisfies Config,
};

export default CONFIG.production satisfies Config;
