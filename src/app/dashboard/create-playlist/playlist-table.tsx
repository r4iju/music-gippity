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
import { isGenerating } from "~/lib/generation-snapshot";
import { PURPOSE } from "~/lib/purpose";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { GenerationHistory } from "./generation-history";
import { GenerationStatus } from "./generation-status";
import { IntentChips } from "./intent-chips";
import {
	type PlaylistFormInput,
	withClassicsOff,
} from "./playlist-form-schema";
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

	const regenerateRequest = (): PlaylistFormInput =>
		playlist.request ?? {
			prompt: brief.prompt,
			trackCount: selectedTrackCount,
			engine: brief.engine,
			creativity: brief.creativity,
			purpose: playlist.purpose,
		};

	const handleRegeneratePlaylist = () => {
		void createPlaylist(regenerateRequest());
	};

	// A new generation like Regenerate; this playlist is kept as it is.
	const handleUndoClassics = () => {
		void createPlaylist(withClassicsOff(regenerateRequest()));
	};

	const generating = isGenerating(playlist.generation.status);
	const placeholderName = playlist.name === "Just a moment...";
	const connectionNotice =
		playlist.remote && connection.status === "offline" ? (
			<p role="status" className="text-xs text-amber-500">
				You are offline. Saved tracks stay here and generation continues on the
				server; we reconnect when your connection returns.
			</p>
		) : playlist.remote && connection.status === "reconnecting" ? (
			<p role="status" className="text-xs text-amber-500">
				Connection lost. Generation continues on the server; reconnecting to
				saved progress…
			</p>
		) : undefined;
	const rowCount = playlist.isLoading
		? Math.min(playlist.length, Math.max(3, playlist.songs.length + 1))
		: playlist.songs.length;

	return (
		<div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-8 pt-4 pb-10">
			<header className="flex flex-col gap-4">
				<div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
					<div className="flex min-w-0 flex-col gap-2">
						<p className="text-muted-foreground text-xs font-medium uppercase tracking-[0.14em]">
							Playlist
							{playlist.purpose && (
								<span title="You picked this purpose">
									{" "}
									· {PURPOSE[playlist.purpose].label}
								</span>
							)}
						</p>
						<h1
							className={cn(
								"text-foreground min-w-0 text-3xl font-bold tracking-tight text-balance break-words sm:text-4xl",
								placeholderName && "text-muted-foreground/70",
							)}
						>
							{placeholderName ? "Your next playlist" : playlist.name}
						</h1>
					</div>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="text-muted-foreground hover:text-foreground mt-6"
							>
								<MoreHorizontal className="h-4 w-4" />
								<span className="sr-only">Playlist options</span>
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
						</DropdownMenuContent>
					</DropdownMenu>
				</div>

				{playlist.description.length > 0 && (
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
										"text-foreground/75 w-full text-[15px] leading-7",
										{
											"line-clamp-3": !isDescriptionExpanded,
										},
									)}
								>
									<AiCuratorLabel className="mr-2" />
									{playlist.description}
								</p>
							</motion.div>
						</AnimatePresence>
						{(isTruncated || isDescriptionExpanded) && (
							<Button
								variant="link"
								size="sm"
								className="text-muted-foreground hover:text-foreground h-auto self-start p-0 text-xs"
								onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
							>
								{isDescriptionExpanded ? "Read less" : "Read more"}
							</Button>
						)}
					</div>
				)}

				<IntentChips
					intent={playlist.intent}
					widened={playlist.widened}
					onUndoClassics={generating ? undefined : handleUndoClassics}
				/>

				{(playlist.generation.status === "complete" ||
					playlist.generation.status === "kept") &&
					allSongIds.length > 0 && (
						<div className="flex flex-wrap items-center gap-3 pt-1">
							{spotifyPlaylistId ? (
								<OpenInSpotify
									kind="playlist"
									id={spotifyPlaylistId}
									label="Listen on Spotify"
									subject={playlist.name}
								/>
							) : (
								<Button
									onClick={handleExportClick}
									disabled={isExporting || playlist.isLoading}
									className="rounded-full px-5"
								>
									{isExporting ? (
										<Loader2 className="animate-spin" />
									) : (
										<Upload />
									)}
									{isExporting ? "Saving to Spotify…" : "Save to Spotify"}
								</Button>
							)}
						</div>
					)}
			</header>

			{(recoveryWarning ||
				storageWarning ||
				(playlist.remote && connection.status === "error")) && (
				<div className="flex flex-col gap-1">
					{playlist.remote && connection.status === "error" && (
						<p role="alert" className="text-destructive text-sm">
							{connection.message}
						</p>
					)}
					{recoveryWarning && (
						<p role="alert" className="text-destructive text-sm">
							{recoveryWarning}
						</p>
					)}
					{storageWarning && (
						<p role="alert" className="text-destructive text-sm">
							Browser storage is unavailable. Server generations remain in your
							history; unsaved local edits may not survive a reload.
						</p>
					)}
				</div>
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
					notice={connectionNotice}
				/>
			)}

			{rowCount > 0 && (
				<section aria-label="Tracks" className="flex flex-col">
					<div
						aria-hidden="true"
						className="text-muted-foreground border-border/60 grid grid-cols-[2rem_3rem_minmax(0,1fr)_2.5rem] gap-3 border-b px-2 pb-2 text-xs font-medium uppercase tracking-[0.14em]"
					>
						<span className="text-center">#</span>
						<span className="col-span-2">Title</span>
					</div>
					<AudioProvider>
						<ol className="flex flex-col pt-2">
							<AnimatePresence>
								{Array.from({ length: rowCount }).map((_, i) => {
									const song = playlist.songs[i];
									return (
										<motion.li
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
												} else if (info.offset.x > replaceThreshold && song) {
													void replaceSong(song.id);
													snackbar.open(`Replacing ${song.title}...`, "info");
												}
											}}
											className="w-full touch-pan-y overflow-hidden"
											key={song ? song.id : `skeleton-${i}`}
										>
											{song && ("songId" in song || !playlist.isLoading) ? (
												<SongPreview
													song={song}
													position={i + 1}
													editable={!playlist.isLoading}
													onDelete={() => removeSong(song.id)}
													onReplace={() => replaceSong(song.id)}
												/>
											) : (
												<SongPreviewSkeleton position={i + 1} />
											)}
										</motion.li>
									);
								})}
							</AnimatePresence>
						</ol>
					</AudioProvider>
				</section>
			)}

			<footer className="border-border/60 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
				<SpotifyAttribution />
				<AlertDialog>
					<AlertDialogTrigger asChild>
						<Button
							size="sm"
							variant="ghost"
							className="text-muted-foreground hover:text-foreground -mr-3"
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
			</footer>
			<GenerationHistory />
		</div>
	);
}
