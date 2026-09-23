"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import type { Session } from "next-auth";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { logger } from "~/utils";

type Props = {
	session: Session | null;
};

type Setting = "Profile" | "Logout" | "Login";

export default function AppbarDropdown({ session }: Props) {
	const isLoggedIn = !!session?.user;
	const settings: Setting[] = isLoggedIn ? ["Profile", "Logout"] : ["Login"];
	const router = useRouter();
	const [showDropdown, setShowDropdown] = useState(false);

	useEffect(() => {
		const handleOutsideClick = (event: MouseEvent) => {
			if (!event.target) return;
			if (!(event.target as Element).closest(".profile-menu")) {
				setShowDropdown(false);
			}
		};
		document.addEventListener("click", handleOutsideClick);
		return () => {
			document.removeEventListener("click", handleOutsideClick);
		};
	}, []);

	const handleSettingClick = (setting: Setting) => {
		setShowDropdown(false);
		switch (setting) {
			case "Profile":
				router.push("/dashboard");
				break;
			case "Logout":
				signOut().catch((error) => {
					if (error instanceof Error) {
						logger.error(error);
					}
				});
				break;
			case "Login":
				router.push("/auth/login");
				break;
			default:
				logger.error("Unknown setting: ", setting);
				break;
		}
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="outline"
					className="flex items-center rounded-full focus:outline-hidden"
					aria-haspopup="true"
					size="icon"
					onClick={() => setShowDropdown(!showDropdown)}
				>
					<Image
						className="hover:bg-opacity-25 rounded-full"
						src={session?.user.image || "/assets/images/avatar.png"}
						alt={session?.user.name || "User"}
						width={40}
						height={40}
					/>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent>
				{settings.map((setting) => (
					<DropdownMenuItem
						key={setting}
						onClick={() => handleSettingClick(setting)}
					>
						{setting}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
