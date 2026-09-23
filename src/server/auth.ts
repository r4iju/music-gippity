import type { AdapterUser } from "@auth/core/adapters";
import type { JWT, JWTOptions } from "@auth/core/jwt";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth, { type DefaultSession } from "next-auth";
import type { ProviderId } from "next-auth/providers";
import SpotifyProvider from "next-auth/providers/spotify";
import { env } from "~/env.mjs";
import { SPOTIFY_SCOPES } from "~/lib/spotify-scopes";
import { drizzle, op, schema } from "~/server/drizzle";
import { getSpotifyToken } from "~/server/spotify-token";
import { logger } from "~/utils";

declare module "next-auth" {
	interface Session extends DefaultSession {
		user: {
			id: string;
			provider: ProviderId;
			accessToken: string;
			role: string;
		} & AdapterUser;
		error?: string | "RefreshAccessTokenError";
	}
}

export const {
	handlers: { GET, POST },
	auth,
} = NextAuth({
	...(env.NODE_ENV === "production" && {
		trustHost: true,
	}),
	callbacks: {
		async jwt(payload) {
			const { account, token } = payload;
			// logger.info('JWT callback invoked', { account, token });

			if (account?.access_token && token.sub) {
				await drizzle
					.update(schema.accounts)
					.set({
						access_token: account.access_token,
						...(account.refresh_token
							? { refresh_token: account.refresh_token }
							: {}),
						expires_at:
							account.expires_at ??
							Math.floor(Date.now() / 1000) +
								Number(account.expires_in ?? 3600),
						refreshLeaseUntil: 0,
					})
					.where(
						op.and(
							op.eq(schema.accounts.userId, token.sub),
							op.eq(schema.accounts.provider, "spotify"),
						),
					);
				// Initial sign-in or when a new token is provided.
				const updatedToken = {
					...token,
					accessToken: account.access_token,
					refreshToken: account.refresh_token,
					accessTokenExpiresAt:
						(account.expires_at ??
							Math.floor(Date.now() / 1000) +
								Number(account.expires_in ?? 3600)) * 1000,
				};
				// logger.info('Initial/New token set', { updatedToken });
				return updatedToken;
			}

			if (Date.now() < (token.accessTokenExpiresAt as number)) {
				// Access token is still valid.
				// logger.info('Access token valid', { accessTokenExpiresAt: token.accessTokenExpiresAt });
				return token;
			}

			// Access token has expired; attempt to refresh it.
			// logger.info('Access token expired; attempting to refresh', { token });
			try {
				const refreshedToken = await refreshAccessToken(token);
				// logger.info('Token refreshed successfully', { refreshedToken });
				return refreshedToken;
			} catch (error) {
				logger.error("Error refreshing access token", error as Error);
				return {
					...token,
					error: "RefreshAccessTokenError",
				};
			}
		},
		session({ session, token }) {
			// logger.info('Session callback invoked', { session, token });
			session.user = {
				...session.user,
				id: token.sub as string,
				accessToken: token.accessToken as string,
				role: token.role as string,
			};
			session.error = token.error as string | undefined;
			return session;
		},
		redirect({ baseUrl }) {
			return `${baseUrl}/dashboard/create-playlist`;
		},
	},
	adapter: DrizzleAdapter(drizzle),
	session: { strategy: "jwt" },
	jwt: {
		secret: env.NEXTAUTH_SECRET,
	} as Partial<JWTOptions>,
	providers: [
		SpotifyProvider({
			clientId: env.SPOTIFY_CLIENT_ID,
			clientSecret: env.SPOTIFY_CLIENT_SECRET,
			authorization: `https://accounts.spotify.com/authorize?scope=${SPOTIFY_SCOPES.join(" ")}`,
			token: "https://accounts.spotify.com/api/token",
			userinfo: "https://api.spotify.com/v1/me",
		}),
	],
	debug: true,
});

async function refreshAccessToken(token: JWT): Promise<JWT> {
	if (!token.sub) throw new Error("Missing account identity");
	const credentials = await getSpotifyToken(token.sub);
	return {
		...token,
		accessToken: credentials.accessToken,
		accessTokenExpiresAt: credentials.expiresAt,
		error: undefined,
	};
}
