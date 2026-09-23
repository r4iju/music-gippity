"use client";

import { EllipsisVertical, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AiCuratorLabel } from "~/components/ai-curator-label";
import { useSnackbar } from "~/components/snackbar";
import { OpenInSpotify } from "~/components/spotify/open-in-spotify";
import { SpotifyAttribution } from "~/components/spotify/spotify-attribution";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
	Carousel,
	CarouselContent,
	CarouselItem,
	CarouselNext,
	CarouselPrevious,
} from "~/components/ui/carousel";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { usePlaylist } from "~/contexts/playlist-provider";
import {
	PromptBuilderProvider,
	usePromptBuilder,
} from "~/contexts/prompt-builder-provider";
import {
	RecommendationsProvider,
	useRecommendations,
} from "~/contexts/use-recommendations";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/shared";
import { refresh } from "./actions";

type Props = {
	playlists: RouterOutputs["playlist"]["getPlaylists"];
};

export const CarouselCards = ({ playlists: initialPlaylists }: Props) => {
	const [isFront, setIsFront] = useState<
		RouterOutputs["playlist"]["getPlaylists"][number]["id"][]
	>([]);
	const [displayedPlaylists, setDisplayedPlaylists] =
		useState(initialPlaylists);
	const { open } = useSnackbar();

	const { mutate: deletePlaylist } = api.playlist.deletePlaylist.useMutation({
		onMutate: (playlist) => {
			setDisplayedPlaylists((prev) => prev.filter((p) => p.id !== playlist.id));
		},
		onSuccess: () => {
			open("Removed", "success");
			void refresh();
		},
		onError: (error) => {
			console.error("Error deleting playlist", error.message);
			open("Something went wrong", "error");
			setDisplayedPlaylists(initialPlaylists);
		},
	});

	const handleFlip = (
		playlist: RouterOutputs["playlist"]["getPlaylists"][number],
	) => {
		setIsFront((prev) => {
			if (prev.includes(playlist.id)) {
				return prev.filter((id) => id !== playlist.id);
			}
			return [...prev, playlist.id];
		});
	};

	return (
		<PromptBuilderProvider>
			<RecommendationsProvider>
				<Carousel
					id="carousel-container"
					className="relative mx-auto my-4 w-full max-w-[75vw] sm:my-16"
				>
					<CarouselContent className="ml-0">
						<AnimatePresence>
							{displayedPlaylists.map((playlist) => {
								const spotifyPlaylistId = playlist.spotifyPlaylistId;
								return (
									<motion.div
										className="size-full min-w-80 cursor-pointer"
										key={playlist.id}
										layout
										initial={{ scale: 1, opacity: 1 }}
										animate={{ scale: 1, opacity: 1 }}
										exit={{ scale: 0, opacity: 0 }}
										transition={{ duration: 0.15 }}
									>
										<CarouselItem className="relative max-w-xs overflow-visible px-6">
											<div className="relative flex flex-col items-center">
												{/* Top left popout (song count) – visible only on back side */}
												<div
													className={cn(
														"absolute top-2 left-[-16px] z-20 transition-opacity duration-300",
														{
															"opacity-0": !isFront.includes(playlist.id),
															"opacity-100": isFront.includes(playlist.id),
														},
													)}
												>
													<div className="bg-card rounded-xl border px-2 py-1 text-center leading-none shadow-sm">
														<span className="text-primary text-xs font-bold">
															{playlist.length}
														</span>
														<br />
														<span className="text-muted-foreground text-xs">
															songs
														</span>
													</div>
												</div>

												{/* Main Card content */}
												<div className="relative w-full pt-8">
													<Card
														onClick={() => handleFlip(playlist)}
														className={cn(
															"transform cursor-pointer shadow-md transition-all duration-300 hover:-translate-y-2 hover:shadow-xl",
															"aspect-square w-full",
														)}
														style={{
															perspective: "1000px",
															transformStyle: "preserve-3d",
															transform: isFront.includes(playlist.id)
																? "rotateY(180deg)"
																: "rotateY(0deg)",
														}}
													>
														{/* Front of the card */}
														<div
															id={`front-${playlist.id}`}
															className="relative grid size-full grid-cols-2 gap-0"
															style={{
																opacity: isFront.includes(playlist.id) ? 0 : 1,
																transition: "opacity 0.3s",
															}}
														>
															{playlist.songs
																.filter((song) => song.albumImage)
																.slice(0, 4)
																.map((song, index) => (
																	<Image
																		key={song.id}
																		src={song.albumImage ?? ""}
																		alt={song.title}
																		width={200}
																		height={200}
																		className={cn(
																			"object-cover",
																			index === 0 && "rounded-tl-[4px]",
																			index === 1 && "rounded-tr-[4px]",
																			index === 2 && "rounded-bl-[4px]",
																			index === 3 && "rounded-br-[4px]",
																		)}
																	/>
																))}
														</div>
														{/* Back of the card */}
														<div
															className="absolute inset-0 overflow-visible"
															style={{
																opacity: isFront.includes(playlist.id) ? 1 : 0,
																transition: "opacity 0.3s",
																transform: "rotateY(180deg)",
															}}
														>
															<div className="flex h-full flex-col">
																<CardHeader
																	id="card-back-header"
																	className="bg-secondary rounded-t-md p-2"
																>
																	<CardTitle
																		id="card-back-title"
																		className="text-primary relative flex items-center justify-between"
																	>
																		<Button
																			variant="ghost"
																			size="icon"
																			disabled
																		></Button>
																		<span>{playlist.name}</span>
																		<ActionsDropdown
																			playlist={playlist}
																			deletePlaylist={deletePlaylist}
																			onExported={(spotifyPlaylistId) =>
																				setDisplayedPlaylists((prev) =>
																					prev.map((p) =>
																						p.id === playlist.id
																							? {
																									...p,
																									isExported: true,
																									spotifyPlaylistId,
																								}
																							: p,
																					),
																				)
																			}
																		/>
																	</CardTitle>
																</CardHeader>
																<CardContent
																	className="text-foreground flex h-full flex-col justify-between overflow-hidden rounded-b-md p-0 text-xs"
																	style={{
																		background:
																			"linear-gradient(to bottom, hsl(var(--card)) 0%, hsl(var(--secondary)) 60%, hsl(var(--secondary-light)) 100%)",
																	}}
																>
																	<div className="flex h-full flex-col items-center justify-center gap-2">
																		<p className="px-4 pt-2 text-center italic">
																			<AiCuratorLabel className="mr-1.5" />
																			{playlist.description}
																		</p>
																		{spotifyPlaylistId && (
																			<OpenInSpotify
																				kind="playlist"
																				id={spotifyPlaylistId}
																				label="Listen on Spotify"
																				subject={playlist.name}
																				onClick={(e) => e.stopPropagation()}
																			/>
																		)}
																	</div>
																	<div className="flex flex-col gap-1">
																		<div className="flex items-center justify-center">
																			<div className="border-muted-foreground h-[1px] w-full border-t" />
																			<p className="mx-2 text-center font-bold">
																				Prompt
																			</p>
																			<div className="border-muted-foreground h-[1px] w-full border-t" />
																		</div>
																		<p className="text-card-foreground px-4 pb-3 text-center text-xs">
																			&quot;{playlist.prompt}&quot;
																		</p>
																	</div>
																</CardContent>
															</div>
														</div>
													</Card>
												</div>
												{/* Title under card, only for front side */}
												<h2
													className={cn(
														"mt-2 text-center text-sm font-semibold transition-opacity duration-300",
														{
															"opacity-0": isFront.includes(playlist.id),
														},
													)}
												>
													{playlist.name}
												</h2>
											</div>
										</CarouselItem>
									</motion.div>
								);
							})}
						</AnimatePresence>
					</CarouselContent>
					<CarouselPrevious />
					<CarouselNext />
				</Carousel>
				<SpotifyAttribution className="justify-center px-4 pb-8" />
			</RecommendationsProvider>
		</PromptBuilderProvider>
	);
};

function ActionsDropdown({
	playlist,
	deletePlaylist,
	onExported,
}: {
	playlist: RouterOutputs["playlist"]["getPlaylists"][number];
	deletePlaylist: (
		playlist: RouterOutputs["playlist"]["getPlaylists"][number],
	) => void;
	onExported: (spotifyPlaylistId: string) => void;
}) {
	const snackbar = useSnackbar();
	const { setPlaylist: setCachedPlaylist } = usePlaylist();
	const { setRecommendations } = useRecommendations();
	const {
		setSelectedMood,
		setSelectedGenres,
		setSelectedArtists,
		setSelectedTrackCount,
		setSelectedEngine,
		choosePurpose,
	} = usePromptBuilder();
	const router = useRouter();

	const { mutate: exportPlaylist, isPending: isExporting } =
		api.playlist.exportPlaylist.useMutation({
			onSuccess: (created) => {
				onExported(created.id);
				snackbar.open(
					`Playlist created successfully! Check it out `,
					"success",
				);
				void refresh();
			},
			onError: () => {
				snackbar.open(
					`Could not create playlist. Please try again later.`,
					"error",
				);
			},
		});

	const handleDelete = () => {
		deletePlaylist(playlist);
	};

	const handleLoad = () => {
		setCachedPlaylist({
			...playlist,
			purpose: playlist.purpose ?? undefined,
			spotifyPlaylistId: playlist.spotifyPlaylistId ?? undefined,
			isLoading: false,
			generation: { status: "kept" },
			isSavedForLater: !playlist.id,
			avoidedSongs: [],
		});
		setRecommendations(playlist.recommendations);
		setSelectedMood(playlist.selectedMood);
		setSelectedGenres(playlist.selectedGenres);
		setSelectedArtists(playlist.selectedArtists);
		setSelectedTrackCount(playlist.selectedTrackCount);
		setSelectedEngine(playlist.selectedEngine);
		if (playlist.purpose) choosePurpose(playlist.purpose);

		router.push("/dashboard/create-playlist?currentStep=1");
	};

	const handleExport = () => {
		exportPlaylist({
			id: playlist.id,
			name: playlist.name,
			description: playlist.description,
			songIds: playlist.songs
				.map((song) => song.songId)
				.filter((id): id is string => id !== null),
		});
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					onClick={(e) => e.stopPropagation()}
					variant="ghost"
					size="icon"
				>
					<EllipsisVertical />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				onClick={(e) => e.stopPropagation()}
				className="w-32"
			>
				<DropdownMenuItem onClick={handleDelete}>Remove</DropdownMenuItem>
				<DropdownMenuItem
					disabled={playlist.isExported || isExporting}
					onClick={handleExport}
				>
					{isExporting ? (
						<Loader2 className="animate-spin" />
					) : (
						"Save to Spotify"
					)}
				</DropdownMenuItem>
				<DropdownMenuItem onClick={handleLoad}>Customize</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
