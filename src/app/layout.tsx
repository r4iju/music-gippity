import type { ReactNode } from "react";
import "~/styles/global.css";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import { SessionProvider } from "next-auth/react";
import SnackbarProvider from "~/components/snackbar/SnackbarProvider";
import { ThemeProvider } from "~/components/theme-provider";
import { TooltipProvider } from "~/components/ui/tooltip";
import Appbar from "~/layouts/appbar/Appbar";
import Copyright from "~/layouts/Copyright";
import { auth } from "~/server/auth";
import { TRPCReactProvider } from "~/trpc/react";

const inter = Inter({
	subsets: ["latin"],
	variable: "--font-sans",
});

export const metadata = {
	title: "Music Gippity",
	description:
		"Describe a mood, scene or activity and get a playlist built for it in your Spotify account.",
};

type AppProps = {
	children: ReactNode;
};

export default async function RootLayout({ children }: AppProps) {
	const session = await auth();
	return (
		<html lang="en" suppressHydrationWarning>
			<body className={`font-sans ${inter.variable}`}>
				<TRPCReactProvider headers={await headers()}>
					<SessionProvider>
						<SnackbarProvider>
							<TooltipProvider>
								<ThemeProvider
									attribute="class"
									defaultTheme="system"
									enableSystem
									disableTransitionOnChange
								>
									<div className="grid min-h-screen grid-rows-[auto_1fr_auto]">
										<Appbar session={session} />

										{/* Expanded main content area */}
										<main className="row-auto text-gray-200">{children}</main>

										<Copyright />
									</div>
								</ThemeProvider>
							</TooltipProvider>
						</SnackbarProvider>
					</SessionProvider>
				</TRPCReactProvider>
			</body>
		</html>
	);
}
