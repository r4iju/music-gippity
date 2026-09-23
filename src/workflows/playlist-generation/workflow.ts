import { failGenerationStep, generatePlaylistStep } from "./steps";

export async function playlistGenerationWorkflow(id: string) {
	"use workflow";
	try {
		await generatePlaylistStep(id);
	} catch {
		await failGenerationStep(id);
	}
}
