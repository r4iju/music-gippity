/** Old tabs must reload rather than launch request-bound, unpersisted generation. */
export function POST() {
	return new Response(
		"Playlist generation has moved. Refresh the app to continue.",
		{ status: 410 },
	);
}
