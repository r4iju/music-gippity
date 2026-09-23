import Image from "next/image";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import type { Page } from "./Appbar";

type Props = {
	pages: Page[];
};

export default function DesktopMenu({ pages }: Props) {
	return (
		<div className="hidden items-center justify-center space-x-20 md:flex">
			<Link href="/" className="items-center sm:hidden md:flex">
				<Image
					src="/app.svg"
					alt="Music Gippity Logo"
					width={40}
					height={40}
					className="rounded-full transition-opacity duration-200 ease-in-out hover:opacity-70"
				/>
			</Link>
			{/* Desktop Menu */}
			<div className="flex items-center space-x-10">
				{pages.map((page) => (
					<Button variant="link" key={page.name} asChild>
						<Link href={page.pathname}>{page.name}</Link>
					</Button>
				))}
			</div>
		</div>
	);
}
