import { PlaylistProvider } from "~/contexts/playlist-provider";
import AuthGuard from "~/guards/AuthGuard";
import { auth } from "~/server/auth";

type Props = {
	children: React.ReactNode;
};

export default async function DashboardLayout({ children }: Props) {
	const session = await auth();
	return (
		<AuthGuard>
			<PlaylistProvider
				key={session?.user.id ?? ""}
				userId={session?.user.id ?? ""}
			>
				{children}
			</PlaylistProvider>
		</AuthGuard>
	);
}
