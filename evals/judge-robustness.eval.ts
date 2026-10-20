import "./live";
import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { ENGINE_IDS, type EngineId } from "~/lib/engines";
import { type Judgment, judgePlaylist } from "./judge";
import type { CaseRecord } from "./report";
import {
	changedVerdicts,
	type Paraphrase,
	paraphraseDescription,
	robustnessVariants,
	type Variant,
	type VerdictChange,
} from "./robustness";
import type { RunResult } from "./runner";

const print = (text: string) => process.stdout.write(`${text}\n`);
const cell = (value: string) =>
	value.replaceAll("|", "\\|").replaceAll("\n", " ");
/** A paraphrase passed a lexical check only, so its flips may be meaning, not wording. */
const unverified = (variant: Variant, changed: readonly VerdictChange[]) =>
	variant === "paraphrased" && changed.length
		? " (unverified: review the saved paraphrase)"
		: "";

test(
	"judge robustness",
	async () => {
		const sources = process.env.EVAL_INPUTS?.split(",").filter(Boolean);
		if (!sources?.length)
			throw new Error("EVAL_INPUTS must list saved live-eval JSON files");
		const judgeEngine = (process.env.EVAL_JUDGE_ENGINE ?? "gemini") as EngineId;
		if (!ENGINE_IDS.includes(judgeEngine))
			throw new Error(
				`EVAL_JUDGE_ENGINE: choose from ${ENGINE_IDS.join(", ")}`,
			);
		const seed = Number(process.env.EVAL_SEED ?? 1);
		if (!Number.isInteger(seed))
			throw new Error("EVAL_SEED must be an integer");
		const pauseMs = Number(process.env.EVAL_PAUSE_MS ?? 15000);
		if (!Number.isInteger(pauseMs) || pauseMs < 0 || pauseMs > 60000)
			throw new Error("EVAL_PAUSE_MS must be an integer from 0 to 60000");
		const stem = `${import.meta.dir}/results/judge-robustness-${new Date().toISOString().replaceAll(":", "-")}`;
		const records: {
			source: string;
			caseId: string;
			generator: RunResult["engine"];
			result: RunResult;
			original: Judgment;
			paraphrase?: Paraphrase;
			variants: {
				variant: Variant;
				description: string;
				songs: RunResult["songs"];
				judgment: Judgment;
				changed: VerdictChange[] | null;
			}[];
		}[] = [];
		const errors: string[] = [];
		const save = async () => {
			await writeFile(
				`${stem}.json`,
				JSON.stringify(
					{ sources, judgeEngine, seed, records, errors },
					null,
					2,
				),
			);
			const lines = [
				"# Judge robustness",
				"",
				`Judge: ${judgeEngine}. Seed: ${seed}. Each saved run is judged as saved, then with its tracks shuffled, its description paraphrased (one temperature-0 rewording by the judge's own engine, kept only if it loses no artist or title name, number, quoted span or negation word) and its description padded with filler that promises nothing. Tracks are compared by recording, criteria by id. A sequence verdict may legitimately change when the order does; any other shuffled or padded change was swayed by order or filler alone. The paraphrase check is lexical and cannot prove the meaning was kept, so a paraphrased change is marked unverified until the saved paraphrase is reviewed.`,
				"",
			];
			for (const record of records) {
				lines.push(
					`## ${record.caseId} / ${record.generator}`,
					"",
					`Source: ${record.source}`,
					"",
					`Brief: ${cell(record.result.brief)}`,
					"",
				);
				if (record.original.status === "error") {
					lines.push(`ERROR (original): ${cell(record.original.error)}`, "");
					continue;
				}
				const paraphrase = record.paraphrase;
				if (paraphrase && paraphrase.status !== "ok")
					lines.push(
						"### paraphrased: skipped",
						"",
						paraphrase.status === "rejected"
							? `Rejected paraphrase (lost ${cell(paraphrase.missing.join(", "))}): ${cell(paraphrase.text)}`
							: paraphrase.status === "error"
								? `ERROR: ${cell(paraphrase.error)}`
								: "No description to paraphrase.",
						"",
					);
				for (const variant of record.variants) {
					if (variant.judgment.status === "error" || !variant.changed) {
						lines.push(
							`### ${variant.variant}`,
							"",
							`ERROR: ${cell(variant.judgment.status === "error" ? variant.judgment.error : "missing")}`,
							"",
						);
						continue;
					}
					lines.push(
						`### ${variant.variant}: ${variant.changed.length} changed${unverified(variant.variant, variant.changed)}`,
						"",
					);
					if (variant.variant !== "shuffled")
						lines.push(`Description: ${cell(variant.description)}`, "");
					if (!variant.changed.length) continue;
					lines.push(
						"| kind | subject | original | variant | variant reason |",
						"|---|---|---|---|---|",
						...variant.changed.map(
							(change) =>
								`| ${change.kind} | ${cell(change.subject)} | ${change.before} | ${change.after} | ${cell(change.reason)} |`,
						),
						"",
					);
				}
			}
			if (errors.length) lines.push("## Errors", "", ...errors);
			await writeFile(`${stem}.md`, `${lines.join("\n")}\n`);
		};
		print(`Artifacts: ${stem}.{json,md}`);
		let calls = 0;
		// Every call goes to the one judge, so pause between them for its quota.
		const judge = async (result: RunResult) => {
			if (calls++) await Bun.sleep(pauseMs);
			return judgePlaylist(result, judgeEngine);
		};
		for (const source of sources) {
			const run = JSON.parse(await readFile(source, "utf8"));
			if (run.schemaVersion !== 2 || !Array.isArray(run.records))
				throw new Error(`Unsupported input ${source}`);
			for (const saved of run.records as CaseRecord[]) {
				const result = saved.result;
				if (!result?.songs.length) {
					errors.push(`${source}/${saved.caseId}/${saved.engine}: no result`);
					continue;
				}
				// Judged afresh, so the comparison is against the same judge today.
				const original = await judge(result);
				const record: (typeof records)[number] = {
					source,
					caseId: saved.caseId,
					generator: result.engine,
					result,
					original,
					variants: [],
				};
				records.push(record);
				const label = `${saved.caseId}/${result.engine}`;
				if (original.status === "error") {
					errors.push(`${label}/original: ${original.error}`);
					await save();
					continue;
				}
				// The paraphrase is asked of the judge's own engine, so the mode
				// still calls only the judge, and shares its pause.
				await Bun.sleep(pauseMs);
				const paraphrase = await paraphraseDescription(result, judgeEngine);
				record.paraphrase = paraphrase;
				if (paraphrase.status === "error")
					errors.push(`${label}/paraphrase: ${paraphrase.error}`);
				if (paraphrase.status === "rejected")
					print(
						`${label}, paraphrased: skipped, the paraphrase lost ${paraphrase.missing.join(", ")}`,
					);
				for (const { variant, result: varied } of robustnessVariants(
					result,
					seed,
					paraphrase.status === "ok" ? paraphrase.text : null,
				)) {
					const judgment = await judge(varied);
					const changed =
						judgment.status === "ok"
							? changedVerdicts(
									{ songs: result.songs, assessment: original.assessment },
									{ songs: varied.songs, assessment: judgment.assessment },
								)
							: null;
					record.variants.push({
						variant,
						description: varied.description,
						songs: varied.songs,
						judgment,
						changed,
					});
					if (judgment.status === "error")
						errors.push(`${label}/${variant}: ${judgment.error}`);
					print(
						`${label}, ${variant}: ${changed ? `${changed.length} changed (${changed.filter((c) => c.kind === "track").length} track, ${changed.filter((c) => c.kind === "criterion").length} criterion)${unverified(variant, changed)}` : "error"}`,
					);
					await save();
				}
			}
		}
		await save();
		expect(errors).toEqual([]);
	},
	60 * 60 * 1000,
);
