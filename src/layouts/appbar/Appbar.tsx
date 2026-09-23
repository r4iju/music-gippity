import { ListMusic, LogIn, Music, Palette } from "lucide-react";
import type { Session } from "next-auth";
import { DarkModeToggle } from "~/components/mode-toggle";
import DesktopMenu from "./DesktopMenu";
import MobileMenu from "./MobileMenu";
import ProfileDropdown from "./ProfileDropdown";

export type Page = {
	name: string;
	pathname: string;
	must?: "logged-in" | "logged-out";
	icon?: React.ReactNode;
};

const pages: Page[] = [
	{
		name: "Create playlist",
		pathname: "/dashboard/create-playlist",
		must: "logged-in",
		icon: <Music style={{ height: "30px", width: "30px" }} />,
	},
	{
		name: "Playlists",
		pathname: "/dashboard/playlists",
		must: "logged-in",
		icon: <ListMusic style={{ height: "30px", width: "30px" }} />,
	},
	{
		name: "Color Palette",
		pathname: "/color-palette",
		must: undefined,
		icon: <Palette style={{ height: "30px", width: "30px" }} />,
	},
	{
		name: "Login",
		pathname: "/auth/login",
		must: "logged-out",
		icon: <LogIn size={30} />,
	},
];

type Props = {
	session: Session | null;
};

export default function Appbar({ session }: Props) {
	const isLoggedIn = !!session?.user;
	const displayPages = pages.filter(
		(page) =>
			typeof page.must === "undefined" ||
			page.must === (isLoggedIn ? "logged-in" : "logged-out"),
	);

	return (
		<nav className="container mx-auto h-[65px] px-6 py-3">
			<div className="flex justify-between align-middle">
				<MobileMenu pages={displayPages} />

				<DesktopMenu pages={displayPages} />

				<div className="flex items-center gap-4">
					<ProfileDropdown session={session} />
					<DarkModeToggle />
				</div>
			</div>
		</nav>
	);
}
