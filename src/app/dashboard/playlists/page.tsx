import { api } from "~/trpc/server";
import { CarouselCards } from "./cards";

export default async function PlaylistsPage() {
	const playlists = await api.playlist.getPlaylists();

	return (
		<div className="h-full bg-background text-foreground">
			{/* Hero section */}
			<section className="py-16 sm:py-24">
				<div className="container mx-auto px-4 text-center sm:px-6 lg:px-8">
					<h1 className="mb-4 text-3xl font-bold sm:text-5xl">
						Discover Your Stunning Playlists
					</h1>
					<p className="mx-auto max-w-2xl text-base sm:text-lg">
						Curated collections that inspire and resonate. Find your next
						favorite tunes among these thoughtfully assembled playlists.
					</p>
				</div>
			</section>

			<CarouselCards playlists={playlists} />
		</div>
	);
}
