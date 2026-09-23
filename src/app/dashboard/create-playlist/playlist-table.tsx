"use client";

import {
	ArrowLeft,
	Loader2,
	MoreHorizontal,
	RefreshCcw,
	Save,
	Upload,
	X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { AiCuratorLabel } from "~/components/ai-curator-label";
import { useSnackbar } from "~/components/snackbar";
import { OpenInSpotify } from "~/components/spotify/open-in-spotify";
import { SpotifyAttribution } from "~/components/spotify/spotify-attribution";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { AudioProvider } from "~/contexts/audio-provider";
import { usePlaylist } from "~/contexts/playlist-provider";
import { usePromptBuilder } from "~/contexts/prompt-builder-provider";
import { useOnboarding } from "~/contexts/step-provider";
import { useRecommendations } from "~/contexts/use-recommendations";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { GenerationHistory } from "./generation-history";
import { GenerationStatus } from "./generation-status";
import { IntentChips } from "./intent-chips";
import SongPreview from "./song-preview";
import SongPreviewSkeleton from "./song-preview-skeleton";

export default function PlaylistTable() {
	const snackbar = useSnackbar();
	const {
		playlist,
		connection,
		createPlaylist,
		resetPlaylist,
		markExported,
		setIsSavedForLater,
		removeSong,
		replaceSong,
		cancelGeneration,
		keepPartial,
		generationRun,
		storageWarning,
		recoveryWarning,
	} = usePlaylist();
	const {
		selectedMood,
		selectedGenres,
		selectedArtists,
		selectedTrackCount,
		selectedEngine,
		creativity,
		buildPrompt,
		resetPrompt,
	} = usePromptBuilder();
	const { resetStep, goToStep } = useOnboarding();
	const { recommendations, ignoredArtists, resetRecommendations } =
		useRecommendations();

	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
	const spotifyPlaylistId = playlist.isExported
		? playlist.spotifyPlaylistId
		: undefined;
	const [isTruncated, setIsTruncated] = useState(false);
	const descriptionRef = useRef<HTMLParagraphElement>(null);

	useLayoutEffect(() => {
		if (!playlist.description) {
			return;
		}
		const element = descriptionRef.current;
		if (element) {
			setIsTruncated(element.scrollHeight > element.clientHeight);
		}
	}, [playlist.description]);

	const allSongIds = playlist.songs.flatMap((song) =>
		song.songId ? [song.songId] : [],
	);

	// The brief may have been edited at step 6, so the one that actually
	// produced this playlist wins over the builder's template.
	const brief = playlist.brief ?? {
		prompt: buildPrompt(),
		engine: selectedEngine,
		creativity,
	};

	const { mutate: exportPlaylist, isPending: isExporting } =
		api.playlist.exportPlaylist.useMutation();
	const { mutate: saveForLater, isPending: isSavingForLater } =
		api.playlist.saveForLater.useMutation();

	const handleExportClick = () => {
		if (playlist.isExported) {
			snackbar.open("Playlist already exported!", "info");
			return;
		}
		if (allSongIds.length === 0) {
			snackbar.open("No songs to export!", "error");
			return;
		}
		exportPlaylist(
			{
				name: playlist.name,
				description: playlist.description,
				songIds: allSongIds,
			},
			{
				onSuccess: (created) => {
					markExported(created.id);
					snackbar.open(
						"Playlist created successfully! Check it out",
						"success",
					);
				},
				onError: () => {
					snackbar.open(
						"Could not create playlist. Please try again later.",
						"error",
					);
				},
			},
		);
	};

	const handleSaveForLaterClick = () => {
		if (playlist.isSavedForLater) {
			snackbar.open("Playlist already saved for later!", "info");
			return;
		}
		saveForLater(
			{
				id: playlist.id,
				prompt: brief.prompt,
				name: playlist.name,
				description: playlist.description,
				songs: playlist.songs,
				isExported: playlist.isExported,
				spotifyPlaylistId: playlist.spotifyPlaylistId ?? null,
				selectedMood,
				selectedGenres,
				selectedArtists,
				selectedTrackCount,
				selectedEngine: brief.engine,
				intent: playlist.intent ?? null,
				purpose: playlist.purpose ?? null,
				recommendations,
				ignoredArtists,
			},
			{
				onSuccess: () => {
					setIsSavedForLater(true);
					snackbar.open("Playlist saved for later!", "success");
				},
				onError: () => {
					snackbar.open(
						"Could not save playlist. Please try again later.",
						"error",
					);
				},
			},
		);
	};

	const handleStartOver = useCallback(() => {
		resetPlaylist();
		resetPrompt();
		resetStep();
		resetRecommendations();
	}, [resetPlaylist, resetPrompt, resetStep, resetRecommendations]);

	const handleRegeneratePlaylist = () => {
		void createPlaylist(
			playlist.request ?? {
				prompt: brief.prompt,
				trackCount: selectedTrackCount,
				engine: brief.engine,
				creativity: brief.creativity,
				purpose: playlist.purpose,
			},
		);
	};

	return (
		<div className="mx-auto flex w-full min-w-0 max-w-xl flex-col gap-3 pb-6">
			<Card className="border-border/40 w-full min-w-0 overflow-hidden p-4 shadow-none sm:p-6">
				<div className="grid min-w-0 gap-5">
					{playlist.remote && connection.status === "offline" && (
						<p role="status">
							You are offline. Saved tracks stay here; generation continues
							independently. Reconnecting when your connection returns.
						</p>
					)}
					{playlist.remote && connection.status === "reconnecting" && (
						<p role="status" className="text-sm text-muted-foreground">
							Connection lost. Generation continues on the server; reconnecting
							to saved progress…
						</p>
					)}
					{playlist.remote && connection.status === "error" && (
						<p role="alert" className="text-sm text-destructive">
							{connection.message}
						</p>
					)}
					{recoveryWarning && (
						<p role="alert" className="text-sm text-destructive">
							{recoveryWarning}
						</p>
					)}
					{storageWarning && (
						<p role="alert" className="text-sm text-destructive">
							Browser storage is unavailable. Server generations remain in your
							history; unsaved local edits may not survive a reload.
						</p>
					)}
					{playlist.remote &&
					connection.status === "error" &&
					!generationRun &&
					playlist.songs.length === 0 ? null : (
						<GenerationStatus
							{...(playlist.remote?.pending
								? { preparation: "creating" as const }
								: playlist.remote &&
										connection.status === "connecting" &&
										!generationRun
									? { preparation: "loading" as const }
									: { generation: playlist.generation, run: generationRun })}
							count={allSongIds.length}
							target={playlist.request?.trackCount ?? playlist.length}
							onCancel={cancelGeneration}
							onKeep={keepPartial}
							onRetry={handleRegeneratePlaylist}
						/>
					)}

					{/* Header, left column can expand to fill space */}
					<header className="grid grid-cols-[1fr_auto] items-center">
						<div className="flex min-w-0 flex-col gap-1">
							<h4 className="min-w-0 break-words text-xl font-semibold tracking-tight">
								{playlist.name === "Just a moment..."
									? "Your next playlist"
									: playlist.name}
							</h4>
							{spotifyPlaylistId && (
								<OpenInSpotify
									kind="playlist"
									id={spotifyPlaylistId}
									label="Listen on Spotify"
									subject={playlist.name}
									className="self-start"
								/>
							)}
						</div>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" size="icon">
									<MoreHorizontal className="h-4 w-4" />
									<span className="sr-only">Open menu</span>
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem
									onClick={handleRegeneratePlaylist}
									disabled={playlist.isLoading}
								>
									<RefreshCcw className="mr-2 h-4 w-4" />
									Regenerate
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={handleSaveForLaterClick}
									disabled={
										isSavingForLater ||
										playlist.isSavedForLater ||
										playlist.isLoading ||
										playlist.generation?.status === "interrupted" ||
										allSongIds.length === 0
									}
								>
									{isSavingForLater ? (
										<>
											<Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
											Saving...
										</>
									) : playlist.isSavedForLater ? (
										"Already saved"
									) : (
										<>
											<Save className="mr-2 h-4 w-4" />
											Save for later
										</>
									)}
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={handleExportClick}
									disabled={
										isExporting ||
										playlist.isExported ||
										playlist.isLoading ||
										playlist.generation?.status === "interrupted" ||
										allSongIds.length === 0
									}
								>
									{isExporting ? (
										<>
											<Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
											Saving...
										</>
									) : playlist.isExported ? (
										"Already exported"
									) : (
										<>
											<Upload className="mr-2 h-4 w-4" />
											Save to Spotify
										</>
									)}
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</header>

					<IntentChips intent={playlist.intent} purpose={playlist.purpose} />

					{/* Description */}
					{playlist.description.length > 0 && (
						<section className="w-full">
							<div className="flex flex-col gap-1">
								<AnimatePresence mode="popLayout">
									<motion.div
										key="description-text"
										initial={{ opacity: 0, y: 5 }}
										animate={{ opacity: 1, y: 0 }}
										exit={{ opacity: 0, y: -5 }}
										transition={{ duration: 0.2 }}
									>
										<p
											ref={descriptionRef}
											className={cn(
												"text-muted-foreground w-full text-sm leading-6",
												{ "line-clamp-4": !isDescriptionExpanded },
											)}
										>
											<AiCuratorLabel className="mr-1.5" />
											{playlist.description}
										</p>
									</motion.div>
								</AnimatePresence>
								{(isTruncated || isDescriptionExpanded) && (
									<Button
										variant="link"
										size="sm"
										className="text-muted-foreground hover:text-foreground h-auto p-0 self-start text-xs"
										onClick={() =>
											setIsDescriptionExpanded(!isDescriptionExpanded)
										}
									>
										{isDescriptionExpanded ? "Read less" : "Read more"}
									</Button>
								)}
							</div>
						</section>
					)}

					{/* Song List */}
					<section>
						<AudioProvider>
							<div className="grid grid-cols-1 gap-2">
								{/* Song Previews */}
								<div className="flex w-full flex-col gap-4">
									<AnimatePresence>
										{Array.from({
											length: playlist.isLoading
												? Math.min(
														playlist.length,
														Math.max(3, playlist.songs.length + 1),
													)
												: playlist.songs.length,
										}).map((_, i) => {
											const song = playlist.songs[i];
											return (
												<motion.div
													layout
													initial={false}
													animate={{ opacity: 1, y: 0, x: 0 }}
													exit={
														song
															? {
																	opacity: 0,
																	x: -300,
																	height: 0,
																	marginTop: 0,
																	marginBottom: 0,
																	transition: {
																		duration: 0.3,
																		ease: "easeInOut",
																	},
																}
															: { opacity: 0, transition: { duration: 0 } }
													}
													transition={{
														duration: 0.2,
														delay: i * 0.05, // Stagger effect
													}}
													drag={song && !playlist.isLoading ? "x" : false}
													dragConstraints={{ left: 0, right: 0 }}
													dragElastic={0.1}
													onDragEnd={(_, info) => {
														const deleteThreshold = -100;
														const replaceThreshold = 100;

														if (info.offset.x < deleteThreshold && song) {
															removeSong(song.id);
														} else if (
															info.offset.x > replaceThreshold &&
															song
														) {
															void replaceSong(song.id);
															snackbar.open(
																`Replacing ${song.title}...`,
																"info",
															);
														}
													}}
													className="w-full touch-pan-y overflow-hidden"
													key={song ? song.id : `skeleton-${i}`}
												>
													{song && ("songId" in song || !playlist.isLoading) ? (
														<SongPreview
															song={song}
															editable={!playlist.isLoading}
															onDelete={() => removeSong(song.id)}
															onReplace={() => replaceSong(song.id)}
														/>
													) : (
														<SongPreviewSkeleton />
													)}
												</motion.div>
											);
										})}
									</AnimatePresence>
								</div>
							</div>
						</AudioProvider>
					</section>

					<SpotifyAttribution />
				</div>
			</Card>
			<AlertDialog>
				<AlertDialogTrigger asChild className="px-2">
					<Button
						size="sm"
						variant="ghost"
						className="min-h-11 w-full text-muted-foreground"
					>
						<ArrowLeft className="size-4" />
						Start over
					</Button>
				</AlertDialogTrigger>
				<AlertDialogContent className="rounded-md">
					<AlertDialogHeader>
						<div className="flex flex-row items-center justify-between">
							<AlertDialogTitle>Reset everything?</AlertDialogTitle>
							<AlertDialogCancel asChild>
								<Button
									className="h-9 rounded-full"
									size="icon"
									variant="outline"
								>
									<X className="size-4" />
								</Button>
							</AlertDialogCancel>
						</div>
						<AlertDialogDescription>
							Do you want to start from scratch or just go back to the first
							step, keeping current options intact?
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter className="flex w-full flex-row flex-wrap justify-between gap-2">
						<AlertDialogAction asChild>
							<Button
								className="border-muted bg-background text-accent-foreground hover:bg-accent hover:text-accent-foreground h-9 border"
								variant="outline"
								onClick={() => goToStep(1)}
							>
								Keep current options
							</Button>
						</AlertDialogAction>

						<AlertDialogAction asChild>
							<Button
								className="h-9"
								variant="secondary"
								onClick={handleStartOver}
							>
								Start from scratch
							</Button>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<GenerationHistory />
		</div>
	);
}
