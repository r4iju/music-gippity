"use client";

import { MenuIcon } from "lucide-react";
import Link from "next/link";
// import { headers } from 'next/headers';
import { usePathname } from "next/navigation";
import { Button } from "~/components/ui/button";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetTitle,
	SheetTrigger,
} from "~/components/ui/sheet";
import { cn } from "~/lib/utils";
import type { Page } from "./Appbar";

type Props = {
	pages: Page[];
};

const MobileMenu = ({ pages }: Props) => {
	// const headersList = await headers();
	// const pathname = headersList.get('x-pathname');

	const pathname = usePathname();

	const isActive = (page: Page) => pathname === page.pathname;

	return (
		<Sheet>
			<SheetTrigger className="md:hidden" asChild>
				<Button
					aria-label="Menu"
					variant="outline"
					className="size-10 rounded-full transition duration-200 hover:bg-gray-100/10"
				>
					<MenuIcon className="size-5" />
				</Button>
			</SheetTrigger>
			<SheetContent side="left">
				<SheetTitle>Navigation</SheetTitle>
				<div className="mt-4 flex flex-col gap-2">
					{pages.map((page) => (
						<SheetClose asChild key={page.name}>
							<Button
								variant="ghost"
								className={cn(
									"w-full justify-start",
									isActive(page) && "bg-gray-100/10",
								)}
								asChild
							>
								<Link href={page.pathname}>
									{page.icon}
									<span>{page.name}</span>
								</Link>
							</Button>
						</SheetClose>
					))}
				</div>
			</SheetContent>
		</Sheet>
	);
};

export default MobileMenu;
