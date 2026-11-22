import { getDrizzle } from "~/server/drizzle";
import { notifyCommitted } from "./notifications";
import { GenerationRepository } from "./repository";
import { RunRepository } from "./run-repository";

let generations: GenerationRepository | undefined;
let generationRuns: RunRepository | undefined;

export function getGenerationRepository() {
	generations ??= new GenerationRepository(getDrizzle());
	return generations;
}

export function getRunRepository() {
	generationRuns ??= new RunRepository(getDrizzle(), notifyCommitted);
	return generationRuns;
}
