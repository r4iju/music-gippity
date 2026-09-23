import Link from "next/link";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";

export default function CustomBreadcrumbs({
	links,
	heading,
}: {
	heading?: string;
	links: {
		name: string;
		href?: string;
		icon?: React.ReactElement;
	}[];
}) {
	return (
		<div className="mb-5">
			<div className="flex items-center">
				<div className="grow">
					{/* HEADING */}
					{heading && (
						<h4 className="text-foreground mb-2 text-2xl font-bold">
							{heading}
						</h4>
					)}

					{/* BREADCRUMBS */}

					<nav
						className={cn("", {
							hidden: links.length === 0,
						})}
						aria-label="Breadcrumbs"
					>
						<ol className="flex flex-row gap-6">
							{links.map((link) => (
								<Button
									className="px-0"
									disabled={link.href === undefined}
									variant="link"
									key={link.name}
								>
									{link.href && (
										<Link
											href={link.href}
											className="hover:text-foreground hidden text-gray-500 transition-colors md:block"
										>
											{link.name}
										</Link>
									)}
									{!link.href && (
										<span className="text-foreground">{link.name}</span>
									)}
								</Button>
							))}
						</ol>
					</nav>
				</div>
			</div>
		</div>
	);
}
