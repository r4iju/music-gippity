import "./live";
import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { type Judgment, judgePlaylist } from "./judge";
import type { RunResult } from "./runner";

const print = (text: string) => process.stdout.write(`${text}\n`);
const key = (song: RunResult["songs"][number]) =>
	song.songId ?? `${song.artist}/${song.title}`;
const cell = (value: string) =>
	value.replaceAll("|", "\\|").replaceAll("\n", " ");

test(
	"paired vocal repair comparison",
	async () => {
		const sources = process.env.EVAL_INPUTS?.split(",").filter(Boolean);
		if (!sources?.length)
			throw new Error("EVAL_INPUTS must list saved live-eval JSON files");
		const stem = `${import.meta.dir}/results/vocal-comparison-${new Date().toISOString().replaceAll(":", "-")}`;
		const records: {
			source: string;
			generator: RunResult["engine"];
			result: RunResult;
			union: RunResult["songs"];
			judge: Judgment;
		}[] = [];
		const errors: string[] = [];
		const save = async () => {
			await writeFile(
				`${stem}.json`,
				JSON.stringify({ sources, records, errors }, null, 2),
			);
			const lines = [
				"# Paired vocal repair comparison",
				"",
				"Each judge assesses the union of original and final recordings once, without seeing which version contains them. Unchanged recordings therefore share a verdict. These are model judgments, not audio verification; both models also participate in production review.",
				"",
			];
			for (const record of records) {
				const { result, union, judge } = record;
				lines.push(
					`## ${record.generator} / judge ${judge.engine}`,
					"",
					`Source: ${record.source}`,
					"",
					`Brief: ${cell(result.brief)}`,
					"",
				);
				if (judge.status === "error") {
					lines.push(`ERROR: ${cell(judge.error)}`, "");
					continue;
				}
				lines.push(
					"| recording | before | after | verdict | reason |",
					"|---|---|---|---|---|",
				);
				for (const [index, song] of union.entries()) {
					const assessment = judge.assessment.tracks.find(
						(track) => track.position === index + 1,
					);
					const before = result.beforeVocalRepair?.some(
						(track) => key(track) === key(song),
					);
					const after = result.songs.some((track) => key(track) === key(song));
					lines.push(
						`| ${cell(song.spotifyRecording?.artists.join(", ") ?? song.artist)} — ${cell(song.spotifyRecording?.title ?? song.title)} | ${before ? "yes" : ""} | ${after ? "yes" : ""} | ${assessment?.verdict} | ${cell(assessment?.reason ?? "missing")} |`,
					);
				}
				lines.push("");
			}
			if (errors.length) lines.push("## Errors", "", ...errors);
			await writeFile(`${stem}.md`, `${lines.join("\n")}\n`);
		};
		print(`Artifacts: ${stem}.{json,md}`);
		for (const source of sources) {
			const run = JSON.parse(await readFile(source, "utf8"));
			if (run.schemaVersion !== 2 || !Array.isArray(run.records))
				throw new Error(`Unsupported input ${source}`);
			for (const record of run.records) {
				const result = record.result as RunResult | undefined;
				if (!result?.beforeVocalRepair) {
					errors.push(`${source}/${record.engine}: no original snapshot`);
					await save();
					continue;
				}
				const union = [
					...new Map(
						[...result.beforeVocalRepair, ...result.songs].map((song) => [
							key(song),
							song,
						]),
					).values(),
				];
				// Providers are independent; neither judgment receives the other's output.
				const judges = await Promise.all(
					["gemini", "chatgpt"].map((engine) =>
						judgePlaylist(
							{ ...result, songs: union },
							engine as "gemini" | "chatgpt",
						),
					),
				);
				for (const judge of judges) {
					records.push({
						source,
						generator: result.engine,
						result,
						union,
						judge,
					});
					if (judge.status === "error")
						errors.push(
							`${source}/${result.engine}/${judge.engine}: ${judge.error}`,
						);
					const counts = (songs: RunResult["songs"]) => {
						if (judge.status !== "ok") return "error";
						const verdicts = songs.map(
							(song) =>
								judge.assessment.tracks.find(
									(track) =>
										track.position ===
										union.findIndex((item) => key(item) === key(song)) + 1,
								)?.verdict,
						);
						return `${verdicts.filter((v) => v === "mismatch").length} mismatch / ${verdicts.filter((v) => v === "uncertain").length} uncertain`;
					};
					print(
						`${result.engine}, judge ${judge.engine}: ${counts(result.beforeVocalRepair)} → ${counts(result.songs)}`,
					);
				}
				await save();
				await new Promise((resolve) => setTimeout(resolve, 15000));
			}
		}
		await save();
		expect(errors).toEqual([]);
	},
	30 * 60 * 1000,
);
