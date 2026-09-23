"use client";

import type { ProviderId } from "next-auth/providers";
import { signIn } from "next-auth/react";
import { SpotifyLogo } from "~/components/spotify/spotify-logo";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { logger } from "~/utils";

export default function AuthWithSocial() {
	const handleProviderLogin = (provider: ProviderId) => {
		try {
			signIn(provider).catch((error) => {
				throw error;
			});
		} catch (error) {
			if (error instanceof Error) {
				logger.error(error);
			}
		}
	};

	return (
		<div>
			<div className="border-muted text-muted-foreground my-6 cursor-default border-y py-2 text-center text-sm">
				Sign in with
			</div>

			<div className="flex flex-col items-center justify-center space-y-4">
				<Button
					type="button"
					variant="secondary"
					onClick={() => handleProviderLogin("spotify")}
					aria-label="Sign in with Spotify"
					className={cn(
						"bg-secondary hover:bg-secondary h-auto w-72 cursor-pointer p-10 transition-all duration-300 hover:scale-105",
					)}
				>
					<SpotifyLogo width={192} decorative />
				</Button>
			</div>
		</div>
	);
}
