import type { Metadata } from "next";

import NextLink from "next/link";
import { Button } from "~/components/ui/button";
import AuthWithSocial from "./auth-with-social";

export const metadata: Metadata = {
	title: "Login",
	description: "Login | Music Gippity",
};

export default function Login() {
	return (
		<div className="max-w-screen-xs container mx-auto flex h-full flex-col items-center justify-center">
			<h4 className="text-foreground text-2xl font-bold">
				Sign in to Music Gippity
			</h4>

			<div className="text-foreground mt-2 flex items-center space-x-1">
				<p className="text-sm">New user?</p>

				<Button variant="link" asChild>
					<NextLink
						href="https://www.spotify.com/signup"
						className="text-foreground text-sm font-medium"
					>
						Create an account at Spotify
					</NextLink>
				</Button>
			</div>

			<AuthWithSocial />
		</div>
	);
}
