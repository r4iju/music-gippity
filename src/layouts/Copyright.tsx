import Image from "next/image";
import Link from "next/link";
import { PATH_PAGE } from "~/routes/paths";

export default function Copyright() {
	return (
		<div className="flex flex-col items-center justify-center py-6 text-center text-sm">
			<div className="mb-3">
				<Link href="/">
					<Image
						src="/app.svg"
						alt="Music Gippity Logo"
						width={62}
						height={62}
						className="rounded-full transition-opacity duration-200 ease-in-out hover:opacity-70"
					/>
				</Link>
			</div>
			<div>
				{" Copyright © "}
				Music Gippity
				{` ${new Date().getFullYear().toString()}.`}
			</div>
			<nav className="mt-2 flex gap-4">
				<Link href={PATH_PAGE.privacy} className="hover:underline">
					Privacy
				</Link>
				<Link href={PATH_PAGE.terms} className="hover:underline">
					Terms
				</Link>
			</nav>
		</div>
	);
}
