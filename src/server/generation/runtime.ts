import { getRun, start } from "workflow/api";
import type { GenerationNotification } from "~/lib/generation-notification";
import { getDrizzle } from "~/server/drizzle";
import { checkpointedGenerationWorkflow } from "~/workflows/checkpointed-generation/workflow";
import { playlistGenerationWorkflow } from "~/workflows/playlist-generation/workflow";
import { GenerationModule } from "./module";

let generation: GenerationModule | undefined;

export function getGenerationModule() {
	generation ??= new GenerationModule(
		getDrizzle(),
		(id) => start(checkpointedGenerationWorkflow, [id]),
		(id) => start(playlistGenerationWorkflow, [id]),
		(id, cursor) =>
			getRun(id).getReadable<GenerationNotification>({ startIndex: cursor }),
	);
	return generation;
}
