import {
	checkEvidenceStep,
	curatePicksStep,
	finalizePlaylistStep,
	interpretIntentStep,
	recordFailureStep,
	repairRecordingsStep,
	rerankRecordingsStep,
	resolveRecordingsStep,
	retrieveCandidatesStep,
} from "./steps";

export async function checkpointedGenerationWorkflow(id: string) {
	"use workflow";
	try {
		const intent = await interpretIntentStep(id);
		const research = await retrieveCandidatesStep(id, intent);
		const curated = await curatePicksStep(id, research);
		const resolved = await resolveRecordingsStep(id, research, curated);
		const checked = await checkEvidenceStep(id, research, resolved);
		const repaired = await repairRecordingsStep(id, research, checked);
		await rerankRecordingsStep(id, research, repaired);
		await finalizePlaylistStep(id);
	} catch {
		await recordFailureStep(id);
	}
}
