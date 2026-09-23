import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ENGINE_IDS } from "~/lib/engines";
import { IntentSchema } from "~/lib/intent";
import { PURPOSES } from "~/lib/purpose";
import {
	addTracksToPlaylist,
	createSpotifyPlaylist,
	findSpotifyTrack,
	pauseTrack,
	playTrack,
} from "~/server/api/spotify";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { logger } from "~/utils";

export const playlistRouter = createTRPCRouter({
	findSpotifySong: protectedProcedure
		.input(
			z.object({
				id: z.string(),
				order: z.number(),
				title: z.string(),
				artist: z.string(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const spotifyTrack = await findSpotifyTrack({
				song: input,
				token: ctx.session.user.accessToken,
			});
			logger.info(
				"found spotify track for: ",
				input.artist,
				input.title,
				"song ID: ",
				spotifyTrack.songId,
			);
			return spotifyTrack;
		}),

	exportPlaylist: protectedProcedure
		.input(
			z.object({
				id: z.string().optional(),
				name: z.string(),
				description: z.string(),
				songIds: z.array(z.string()),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const playlist = await createSpotifyPlaylist({
				name: input.name,
				description: input.description,
				token: ctx.session.user.accessToken,
			});
			await addTracksToPlaylist({
				playlistId: playlist.id,
				trackIds: input.songIds,
				token: ctx.session.user.accessToken,
			});
			if (input.id) {
				await ctx.drizzle
					.update(ctx.schema.playlists)
					.set({
						isExported: true,
						spotifyPlaylistId: playlist.id,
					})
					.where(ctx.op.eq(ctx.schema.playlists.id, input.id));
			}
			logger.info("created playlist and added tracks");
			return playlist;
		}),

	getPlaylists: protectedProcedure
		.input(
			z
				.object({
					title: z.string().optional(),
				})
				.optional(),
		)
		.query(async ({ ctx }) => {
			const rows = await ctx.drizzle
				.select({
					playlist: ctx.schema.playlists,
					song: ctx.schema.songs, // this will be `null` if no song is joined
				})
				.from(ctx.schema.playlists)
				.leftJoin(
					ctx.schema.songs,
					ctx.op.eq(ctx.schema.playlists.id, ctx.schema.songs.playlistId),
				)
				.where(ctx.op.eq(ctx.schema.playlists.userId, ctx.session.user.id))
				.all();

			const playlistsById = rows.reduce<
				Record<
					string,
					typeof ctx.schema.playlists.$inferSelect & {
						songs: (typeof ctx.schema.songs.$inferSelect)[];
					}
				>
			>((acc, row) => {
				const playlistId = row.playlist.id;

				// If this playlist hasn't been added yet, add it with an empty songs array.
				if (!acc[playlistId]) {
					acc[playlistId] = {
						...row.playlist,
						songs: [],
					};
				}

				// If a song exists (the join can produce a null song), push it to the songs array.
				if (row.song) {
					acc[playlistId].songs.push(row.song);
				}

				return acc;
			}, {});

			const playlists = Object.values(playlistsById);
			return playlists;
		}),

	deletePlaylist: protectedProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ input, ctx }) => {
			await ctx.drizzle
				.delete(ctx.schema.songs)
				.where(ctx.op.eq(ctx.schema.songs.playlistId, input.id));
			// delete playlist
			await ctx.drizzle
				.delete(ctx.schema.playlists)
				.where(ctx.op.eq(ctx.schema.playlists.id, input.id));
			return { success: true };
		}),

	saveForLater: protectedProcedure
		.input(
			z.object({
				id: z.string(),
				name: z.string(),
				description: z.string(),
				prompt: z.string(),
				isExported: z.boolean().default(false),
				spotifyPlaylistId: z.string().nullable().default(null),
				selectedMood: z.string(),
				selectedGenres: z.array(z.string()),
				selectedArtists: z.array(z.string()),
				recommendations: z.array(
					z.object({
						value: z.string(),
						label: z.string(),
					}),
				),
				ignoredArtists: z.array(z.string()),
				selectedTrackCount: z.number(),
				selectedEngine: z.enum(ENGINE_IDS),
				intent: IntentSchema.nullable().default(null),
				purpose: z.enum(PURPOSES).nullable().default(null),
				songs: z.array(
					z.object({
						id: z.string(),
						songId: z.string().optional().nullable(),
						artist: z.string(),
						title: z.string(),
						albumTitle: z.string().optional().nullable(),
						albumImage: z.string().optional().nullable(),
						albumYear: z.number().optional().nullable(),
						order: z.number(),
						previewUrl: z.string().optional().nullable(),
					}), // ts maging to check if this satisfies Song type
				),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			// batch insert songs into the database
			const playlist = await ctx.drizzle
				.insert(ctx.schema.playlists)
				.values({
					id: input.id,
					userId: ctx.session.user.id,
					prompt: input.prompt,
					length: input.songs.length,
					name: input.name,
					description: input.description,
					error: "",
					isExported: input.isExported,
					spotifyPlaylistId: input.spotifyPlaylistId,
					selectedEngine: input.selectedEngine,
					selectedMood: input.selectedMood,
					selectedTrackCount: input.selectedTrackCount,
					selectedArtists: input.selectedArtists,
					ignoredArtists: input.ignoredArtists,
					recommendations: input.recommendations,
					selectedGenres: input.selectedGenres,
					intent: input.intent,
					purpose: input.purpose,
				})
				.returning();
			const playlistId = playlist[0]?.id;
			if (!playlistId) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Playlist ID not generated?",
				});
			}
			await ctx.drizzle.insert(ctx.schema.songs).values(
				input.songs.map((song) => ({
					...song,
					// all optional values shall be null
					songId: song.songId ?? null,
					previewUrl: song.previewUrl ?? null,
					albumImage: song.albumImage ?? null,
					albumYear: song.albumYear ?? null,
					playlistId: playlistId,
				})),
			);
			logger.info("Playlist marked as saved for later:", input.name);
			return { success: true };
		}),

	playTrack: protectedProcedure
		.input(z.object({ trackIds: z.array(z.string()) }))
		.mutation(async ({ input, ctx }) => {
			await playTrack({
				trackIds: input.trackIds,
				token: ctx.session.user.accessToken,
			});
			return { success: true };
		}),

	pauseTrack: protectedProcedure.mutation(async ({ ctx }) => {
		await pauseTrack({
			token: ctx.session.user.accessToken,
		});
		return { success: true };
	}),
});
