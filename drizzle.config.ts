import type { Config } from "drizzle-kit";

import { env } from "~/env.mjs";

const CONFIG = {
	development: {
		schema: "./src/server/schema.ts",
		out: "./migrations",
		dialect: "turso",
		dbCredentials: {
			url: env.TURSO_DATABASE_URL,
			authToken: env.TURSO_AUTH_TOKEN,
		},
	} satisfies Config,
	production: {
		schema: "./src/server/schema.ts",
		out: "./migrations",
		dialect: "turso",
		dbCredentials: {
			url: env.TURSO_DATABASE_URL,
			authToken: env.TURSO_AUTH_TOKEN,
		},
	} satisfies Config,
};

export default CONFIG.production satisfies Config;
