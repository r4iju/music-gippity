import Image from "next/image";
import Link from "next/link";
import { PATH_AUTH, PATH_DASHBOARD } from "~/routes/paths";
import { auth } from "~/server/auth";

export default async function LandingPage() {
	const session = await auth();

	return (
		<div className="relative grid h-full w-full place-items-center overflow-hidden">
			{/* Background Image */}
			<Image
				src="/assets/illustrations/an_abstract_representation_of_music_and_AI_fusion.webp"
				alt="AI Music Fusion"
				quality={100}
				className="slow-pulse"
				fill
				style={{
					objectFit: "cover",
				}}
			/>

			{/* Content Overlay */}
			<div className="z-10 flex flex-col items-center justify-center gap-4 p-4">
				<h1 className="mb-4 text-5xl font-semibold text-white drop-shadow-md">
					{session && <span>Music Gippity</span>}
				</h1>

				<Link href={session ? PATH_DASHBOARD.playlists : PATH_AUTH.login}>
					<button
						type="button"
						className="transform rounded-lg bg-linear-to-r from-purple-500 to-pink-500 px-6 py-3 text-xl font-bold text-white shadow-lg transition duration-200 ease-in-out hover:scale-105 hover:shadow-xl"
					>
						{session ? "Create Playlist" : "Get Started"}
					</button>
				</Link>
			</div>
		</div>
	);
}
