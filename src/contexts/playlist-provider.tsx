"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type React from "react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { z } from "zod";
import type { PlaylistFormInput } from "~/app/dashboard/create-playlist/playlist-form-schema";
import { useSnackbar } from "~/components/snackbar";
import { usePlaylistDraft } from "~/hooks/use-playlist-draft";
import type { Evidence } from "~/lib/evidence";
import {
	type Connection,
	cancelRemoteGeneration,
	observeGeneration,
} from "~/lib/generation-client";
import {
	type GenerationSnapshot,
	isGenerating,
} from "~/lib/generation-snapshot";
import { replaceRecording } from "~/lib/playlist-client";
import {
	editSongs,
	emptyDraft,
	type PlaylistDraft,
	startGeneration,
} from "~/lib/playlist-generation";
import type { SongSchema, SongSource } from "~/lib/playlist-stream";

/** Evidence travels on its own line and is joined in memory, never on a song line. */
export type Song = z.infer<typeof SongSchema> & {
	evidence?: Evidence;
	/** The rerank's one line on why the recording belongs. */
	reason?: string;
};

/** A song on its way through the create route, which always knows its source. */
export type SourcedSong = Song & { source: SongSource };

export type PartialSong = Pick<Song, "order" | "artist" | "title">;

export type NotFoundSong = Pick<Song, "id" | "order" | "artist" | "title">;

export type Playlist = PlaylistDraft & { readonly isLoading: boolean };

// ─── CONTEXT INTERFACE ───────────────────────────────────────────────────

export type PlaylistContextType = {
	playlist: Playlist;
	connection: Connection;
	generationRun: GenerationSnapshot["generation"];
	setPlaylist: (playlist: Playlist) => void;
	resetPlaylist: () => void;
	cancelGeneration: () => void;
	keepPartial: () => void;
	storageWarning: boolean;
	recoveryWarning: string | null;
	removeSong: (id: string) => void;
	replaceSong: (songId: string) => Promise<void>;
	createPlaylist: (data: PlaylistFormInput) => Promise<void>;
	markExported: (spotifyPlaylistId: string) => void;
	setIsSavedForLater: (isSavedForLater: boolean) => void;
};

const PlaylistContext = createContext<PlaylistContextType | undefined>(
	undefined,
);

// ─── PROVIDER ───────────────────────────────────────────────────────────

export function PlaylistProvider({
	children,
	userId,
}: {
	children: React.ReactNode;
	userId: string;
}) {
	const pathname = usePathname();
	const search = useSearchParams();
	// Ephemeral local drafts survive URL handoffs even when browser storage is unavailable.
	const draftCacheRef = useRef<PlaylistDraft | null>(null);
	const pendingKey =
		pathname === "/dashboard/create-playlist" ? search.get("playlistId") : null;
	const [handoff, setHandoff] = useState<{ from: string; to: string } | null>(
		null,
	);
	const acknowledge = useCallback((from: string, to: string) => {
		setHandoff({ from, to });
	}, []);
	const sessionKey =
		handoff?.to === pathname ? handoff.from : `${pathname}:${pendingKey ?? ""}`;
	return (
		<PlaylistSession
			key={sessionKey}
			sessionKey={sessionKey}
			onAcknowledge={acknowledge}
			userId={userId}
			pendingKey={pendingKey}
			draftCacheRef={draftCacheRef}
		>
			{children}
		</PlaylistSession>
	);
}

const PlaylistSession = ({
	children,
	userId,
	pendingKey,
	draftCacheRef,
	sessionKey,
	onAcknowledge,
}: {
	children: React.ReactNode;
	userId: string;
	pendingKey: string | null;
	draftCacheRef: React.RefObject<PlaylistDraft | null>;
	sessionKey: string;
	onAcknowledge: (from: string, to: string) => void;
}) => {
	const {
		playlist,
		setPlaylist: setPlaylistState,
		current,
		storageWarning,
		recoveryWarning,
	} = usePlaylistDraft(userId, pendingKey, draftCacheRef);
	const pathname = usePathname();
	const search = useSearchParams();
	const pathId = z
		.string()
		.uuid()
		.optional()
		.catch(undefined)
		.parse(pathname.match(/^\/dashboard\/playlists\/([^/]+)$/)?.[1]);
	const urlId = z
		.string()
		.uuid()
		.nullable()
		.catch(null)
		.parse(search.get("playlistId"));
	const viewedId =
		pathId ?? (pathname === "/dashboard/create-playlist" ? urlId : undefined);
	const [connection, setConnection] = useState<Connection>({
		status: "connecting",
	});
	const [observed, setObserved] = useState<GenerationSnapshot["generation"]>();
	const active = useRef<AbortController | null>(null);
	const revision = useRef(0);
	// External systems: observe DB revisions and fence pending commands when this URL session leaves.
	useEffect(() => {
		if (!viewedId || !userId)
			return () => {
				revision.current++;
			};
		const controller = new AbortController();
		active.current = controller;
		const cached = current.current;
		if (cached.id !== viewedId)
			setPlaylistState({
				...emptyDraft(),
				id: viewedId,
				generation: { status: "queued", runId: viewedId },
				remote: { id: viewedId, revision: 0 },
			});
		void observeGeneration(
			{
				id: viewedId,
				request:
					cached.remote?.id === viewedId && cached.remote.pending
						? cached.request
						: undefined,
			},
			controller.signal,
			(snapshot) => {
				if (active.current !== controller) return;
				if (
					current.current.remote?.id === viewedId &&
					current.current.remote.revision > snapshot.revision
				)
					return;
				setObserved(snapshot.generation);
				setPlaylistState({
					...snapshot.playlist,
					remote: { id: snapshot.playlist.id, revision: snapshot.revision },
				});
				if (
					snapshot.generation &&
					(snapshot.playlist.id !== viewedId || !pathId)
				) {
					const path = `/dashboard/playlists/${snapshot.playlist.id}`;
					onAcknowledge(sessionKey, path);
					window.history.replaceState(null, "", path);
				}
			},
			setConnection,
		);
		return () => {
			revision.current++;
			controller.abort();
			if (active.current === controller) active.current = null;
		};
	}, [
		viewedId,
		userId,
		current,
		setPlaylistState,
		pathId,
		onAcknowledge,
		sessionKey,
	]);
	const clearView = useCallback(() => {
		const url = new URL(window.location.href);
		if (url.pathname.startsWith("/dashboard/playlists/")) {
			url.pathname = "/dashboard/create-playlist";
			url.searchParams.set("currentStep", "7");
		}
		url.searchParams.delete("playlistId");
		window.history.replaceState(null, "", url);
	}, []);
	const invalidate = useCallback(() => {
		active.current?.abort();
		active.current = null;
		revision.current++;
	}, []);

	const snackbar = useSnackbar();

	const setPlaylist = useCallback(
		(pl: Playlist) => {
			setObserved(undefined);
			invalidate();
			clearView();
			const { isLoading: _loading, remote: _remote, ...draft } = pl;
			setPlaylistState({
				...draft,
				generation: { status: pl.songs.length ? "kept" : "idle" },
			});
		},
		[clearView, invalidate, setPlaylistState],
	);

	const resetPlaylist = useCallback(() => {
		setObserved(undefined);
		invalidate();
		clearView();
		setPlaylistState(emptyDraft());
	}, [clearView, invalidate, setPlaylistState]);

	const cancelGeneration = useCallback(() => {
		if (current.current.remote?.pending) return;
		const id = current.current.remote?.id;
		if (!id) return;
		void cancelRemoteGeneration(id)
			.then((snapshot) => {
				if (current.current.remote?.id !== id) return;
				setObserved(snapshot.generation);
				setPlaylistState({
					...snapshot.playlist,
					remote: { id, revision: snapshot.revision },
				});
			})
			.catch(() =>
				snackbar.open(
					"Cancellation was not confirmed. Reconnect and try again.",
					"error",
				),
			);
	}, [current, setPlaylistState, snackbar]);
	const keepPartial = useCallback(() => {
		invalidate();
		setPlaylistState((prev) => {
			const songs = prev.songs.filter(
				(song) => "songId" in song && song.songId,
			);
			return {
				...prev,
				songs,
				length: songs.length,
				generation: { status: "kept" },
			};
		});
	}, [invalidate, setPlaylistState]);

	const markExported = useCallback(
		(spotifyPlaylistId: string) => {
			setPlaylistState((prev) =>
				prev.id === playlist.id &&
				prev.songs === playlist.songs &&
				prev.name === playlist.name &&
				prev.description === playlist.description
					? { ...prev, isExported: true, spotifyPlaylistId }
					: prev,
			);
		},
		[playlist, setPlaylistState],
	);

	const setIsSavedForLater = useCallback(
		(isSavedForLater: boolean) => {
			setPlaylistState((prev) =>
				prev.id === playlist.id &&
				prev.songs === playlist.songs &&
				prev.name === playlist.name &&
				prev.description === playlist.description
					? { ...prev, isSavedForLater }
					: prev,
			);
		},
		[playlist, setPlaylistState],
	);

	const removeSong = useCallback(
		(id: string) => {
			if (isGenerating(current.current.generation.status)) return;
			invalidate();
			clearView();
			setPlaylistState((prev) =>
				isGenerating(prev.generation.status)
					? prev
					: {
							...editSongs(
								prev,
								prev.songs.filter((song) => song.id !== id),
							),
							// Decrement length if greater than 0
							length: Math.max(0, prev.length - 1),
						},
			);
		},
		[current, invalidate, clearView, setPlaylistState],
	);

	const replaceSong = useCallback(
		async (id: string) => {
			if (isGenerating(current.current.generation.status)) return;
			invalidate();
			const startedAt = revision.current;
			const currentPlaylist = current.current;
			const songToReplace = currentPlaylist.songs.find((s) => s.id === id);
			if (!songToReplace) return;

			// Add to avoided songs immediately
			setPlaylistState((prev) => ({
				...prev,
				avoidedSongs: [
					...(prev.avoidedSongs ?? []),
					`${songToReplace.artist} - ${songToReplace.title}`,
				],
			}));

			// Ideally mark the song as loading/replacing here.
			// For now, we'll just let the UI handle pending state if possible or optimistically update?
			// Actually, showing a boolean loading state for specific song is tricky without modifying Song type.
			// Let's rely on the UI component's local state for the "spinner" based on the promise.

			try {
				// Prepare request payload
				const currentSongs = currentPlaylist.songs
					.filter((s) => s.id !== id) // Exclude the on being replaced
					.map((s) => ({ artist: s.artist, title: s.title }));

				const newSong = await replaceRecording({
					playlistName: currentPlaylist.name,
					playlistDescription: currentPlaylist.description,
					currentSongs,
					avoidedSongs: [
						...(currentPlaylist.avoidedSongs ?? []),
						`${songToReplace.artist} - ${songToReplace.title}`, // Ensure current one is included
					],
					targetSongId: id,
					prompt: currentPlaylist.brief?.prompt,
					engine: currentPlaylist.brief?.engine,
					creativity: currentPlaylist.brief?.creativity,
					purpose: currentPlaylist.purpose,
					intent: currentPlaylist.intent ?? null,
				});

				if (revision.current !== startedAt) return;
				// Replace in state
				setPlaylistState((prev) => {
					const index = prev.songs.findIndex((s) => s.id === id);
					if (index === -1) return prev;

					const oldSong = prev.songs[index];
					if (!oldSong) return prev; // Safety check for TS

					const newSongs = [...prev.songs];
					// Preserve the order of the old song
					newSong.order = oldSong.order;
					newSongs[index] = newSong;
					return editSongs(prev, newSongs);
				});
				clearView();
			} catch (error) {
				if (revision.current !== startedAt) return;
				console.error("Error replacing song:", error);
				snackbar.open("Failed to replace song", "error");
			}
		},
		[current, invalidate, clearView, setPlaylistState, snackbar],
	);

	async function createPlaylist(data: PlaylistFormInput) {
		// The cache ref updates synchronously, before React can rerender the button.
		if (isGenerating(current.current.generation.status)) return;
		setObserved(undefined);
		const id = crypto.randomUUID();
		const draft = startGeneration(current.current, data, id);
		invalidate();
		setPlaylistState({
			...draft,
			id,
			generation: { status: "queued", runId: id },
			remote: { id, revision: 0, pending: true },
		});
		window.history.replaceState(
			null,
			"",
			`/dashboard/create-playlist?currentStep=7&playlistId=${id}`,
		);
	}

	return (
		<PlaylistContext.Provider
			value={{
				playlist,
				connection,
				generationRun: observed,
				setPlaylist,
				resetPlaylist,
				cancelGeneration,
				keepPartial,
				storageWarning,
				recoveryWarning,
				removeSong,
				replaceSong,
				createPlaylist,
				markExported,
				setIsSavedForLater,
			}}
		>
			{children}
		</PlaylistContext.Provider>
	);
};

export const usePlaylist = (): PlaylistContextType => {
	const context = useContext(PlaylistContext);
	if (!context) {
		throw new Error("usePlaylist must be used within a PlaylistProvider");
	}
	return context;
};
