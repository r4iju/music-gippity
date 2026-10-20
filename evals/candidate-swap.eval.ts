import "./live";
import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import type { CandidatePool } from "~/server/api/candidates";
import { TEST_SESSION } from "../tests/setup";
import {
	matchPicks,
	type Offer,
	type PickMatches,
	pickDonor,
	poolMatch,
	swapPool,
} from "./candidate-swap";
import { loadListener } from "./listener";
import { clientCredentialsToken } from "./live";
import type { CaseRecord } from "./report";
import { type RunResult, runCase } from "./runner";

const print = (text: string) => process.stdout.write(`${text}\n`);
const cell = (value: string) =>
	value.replaceAll("|", "\\|").replaceAll("\n", " ");
const offerOf = (pool: Offer): Offer => ({
	artists: pool.artists,
	tracks: pool.tracks,
});
const summary = (matches: PickMatches) =>
	`${matches.real} real / ${matches.swapped} swapped / ${matches.both} both / ${matches.neither} neither of ${matches.total}`;

test(
	"candidate swap",
	async () => {
		const sources = process.env.EVAL_INPUTS?.split(",").filter(Boolean);
		if (!sources?.length)
			throw new Error("EVAL_INPUTS must list saved live-eval JSON files");
		const pauseMs = Number(process.env.EVAL_PAUSE_MS ?? 15000);
		if (!Number.isInteger(pauseMs) || pauseMs < 0 || pauseMs > 60000)
			throw new Error("EVAL_PAUSE_MS must be an integer from 0 to 60000");
		const saved: {
			source: string;
			caseId: string;
			brief: string;
			result: RunResult;
			candidates?: Offer;
		}[] = [];
		for (const source of sources) {
			const run = JSON.parse(await readFile(source, "utf8"));
			if (run.schemaVersion !== 2 || !Array.isArray(run.records))
				throw new Error(`Unsupported input ${source}`);
			for (const record of run.records as CaseRecord[]) {
				if (!record.result) continue;
				const candidates = record.result.candidates;
				saved.push({
					source,
					caseId: record.caseId,
					brief: record.result.brief,
					result: record.result,
					candidates:
						candidates?.status === "ok" ? offerOf(candidates) : undefined,
				});
			}
		}
		const stem = `${import.meta.dir}/results/candidate-swap-${new Date().toISOString().replaceAll(":", "-")}`;
		const records: {
			source: string;
			caseId: string;
			engine: RunResult["engine"];
			donor: { source: string; caseId: string; offer: Offer };
			/** The saved run's picks against its own offer and the donor's. */
			savedMatches: PickMatches;
			/** The pool this rerun found, which the curator never saw. */
			real: Offer;
			matches: PickMatches;
			result: RunResult;
		}[] = [];
		const errors: string[] = [];
		const skipped: string[] = [];
		const save = async () => {
			await writeFile(
				`${stem}.json`,
				JSON.stringify({ sources, records, skipped, errors }, null, 2),
			);
			const lines = [
				"# Candidate swap",
				"",
				"Each case is generated again with the candidates it found replaced by another brief's offer. A final pick counts toward the real pool when its artist (or a credited artist) was in what the real search found, toward the swapped pool when it was in the offer the curator saw instead. Picks that follow the swapped pool show the curator uses candidates; picks that still match the real pool came from its own knowledge of the brief. The saved run is the same count against its own offer, for reference.",
				"",
				"| case | engine | donor | saved run | swapped run |",
				"|---|---|---|---|---|",
				...records.map(
					(record) =>
						`| ${record.caseId} | ${record.engine} | ${record.donor.caseId} | ${summary(record.savedMatches)} | ${summary(record.matches)} |`,
				),
				"",
			];
			for (const record of records)
				lines.push(
					`## ${record.caseId} / ${record.engine} with ${record.donor.caseId}'s candidates`,
					"",
					`Source: ${record.source}; donor: ${record.donor.source}`,
					"",
					`Brief: ${cell(record.result.brief)}`,
					"",
					...record.result.songs.map(
						(song) =>
							`- ${cell(song.artist)} — ${cell(song.title)} (${poolMatch(record.real, record.donor.offer)(song)})`,
					),
					"",
				);
			if (skipped.length) lines.push("## Skipped", "", ...skipped, "");
			if (errors.length) lines.push("## Errors", "", ...errors);
			await writeFile(`${stem}.md`, `${lines.join("\n")}\n`);
		};
		TEST_SESSION.user.accessToken = await clientCredentialsToken();
		const listener = await loadListener();
		print(`Artifacts: ${stem}.{json,md}`);
		let runs = 0;
		for (const target of saved) {
			const label = `${target.caseId}/${target.result.engine}`;
			if (
				!target.candidates?.artists.length &&
				!target.candidates?.tracks.length
			) {
				skipped.push(`- ${label}: the saved run was offered no candidates`);
				continue;
			}
			const donor = pickDonor(target, saved);
			if (!donor?.candidates) {
				errors.push(`${label}: no other brief offered candidates`);
				continue;
			}
			// Generation and its lookups share provider quotas between runs.
			if (runs++) await Bun.sleep(pauseMs);
			const offer = donor.candidates;
			const seen: { real?: CandidatePool } = {};
			try {
				const result = await runCase(
					target.result.case,
					target.result.engine,
					listener,
					(found) => {
						seen.real = found;
						return swapPool(found, offer);
					},
				);
				const real = seen.real;
				if (!real) throw new Error("the candidate search did not run");
				const matches = matchPicks(result.songs, real, offer);
				records.push({
					source: target.source,
					caseId: target.caseId,
					engine: result.engine,
					donor: { source: donor.source, caseId: donor.caseId, offer },
					savedMatches: matchPicks(
						target.result.songs,
						target.candidates,
						offer,
					),
					real: offerOf(real),
					matches,
					result,
				});
				print(`${label} with ${donor.caseId}: ${summary(matches)}`);
			} catch (error) {
				errors.push(
					`${label}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			await save();
		}
		await save();
		expect(errors).toEqual([]);
	},
	60 * 60 * 1000,
);
