import { drizzle } from "~/server/drizzle";
import { notifyCommitted } from "./notifications";
import { GenerationRepository } from "./repository";
import { RunRepository } from "./run-repository";

export const generations = new GenerationRepository(drizzle);
export const generationRuns = new RunRepository(drizzle, notifyCommitted);
