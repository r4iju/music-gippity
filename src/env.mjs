import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const RUNTIME_ENV = typeof EdgeRuntime === "string" ? "edge" : "server";

export const env = createEnv({
	server: {
		NODE_ENV: z.enum(["development", "test", "production"]),
		NEXTAUTH_SECRET: z.string().min(1),
		NEXTAUTH_URL: z.preprocess((str) => {
			return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : str;
		}, z.url()),
		SPOTIFY_CLIENT_ID: z.string().min(1),
		SPOTIFY_CLIENT_SECRET: z.string().min(1),
		OPENAI_ORGANIZATION_ID: z.string().min(1),
		OPENAI_KEY: z.string().min(1),
		GEMINI_API_KEY: z.string().min(1),
		// Optional: without it the Last.fm tag and listener lookups are off.
		LASTFM_API_KEY: z.string().min(1).optional(),
		// Each evidence source answers within this or counts as unknown.
		EVIDENCE_DEADLINE_MS: z.coerce.number().int().positive().default(2500),
		// MusicBrainz allows one request per second per client.
		MUSICBRAINZ_INTERVAL_MS: z.coerce
			.number()
			.int()
			.nonnegative()
			.default(1000),
		RUNTIME_ENV: z.literal(RUNTIME_ENV),
		TURSO_DATABASE_URL: z.url(),
		TURSO_AUTH_TOKEN: z.string().min(1),
	},

	client: {},

	runtimeEnv: {
		NODE_ENV: process.env.NODE_ENV,
		NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
		NEXTAUTH_URL: process.env.NEXTAUTH_URL,
		SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
		SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
		OPENAI_KEY: process.env.OPENAI_KEY,
		OPENAI_ORGANIZATION_ID: process.env.OPENAI_ORGANIZATION_ID,
		GEMINI_API_KEY: process.env.GEMINI_API_KEY,
		LASTFM_API_KEY: process.env.LASTFM_API_KEY,
		EVIDENCE_DEADLINE_MS: process.env.EVIDENCE_DEADLINE_MS,
		MUSICBRAINZ_INTERVAL_MS: process.env.MUSICBRAINZ_INTERVAL_MS,
		RUNTIME_ENV: RUNTIME_ENV,
		TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
		TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
	},

	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
