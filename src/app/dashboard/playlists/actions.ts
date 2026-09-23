"use server";

import "server-only";
import { revalidatePath } from "next/cache";

export const refresh = async () => {
	return new Promise<void>((resolve) => {
		revalidatePath("/dashboard/playlists", "page");
		resolve();
	});
};
