import "./live";
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ENGINE_IDS } from "~/lib/engines";
import { TEST_SESSION } from "../tests/setup";
import { CASES } from "./cases";
import { judgePlaylist } from "./judge";
import { loadListener } from "./listener";
import {
	type CaseRecord,
	type EvalRun,
	historicalResults,
	overlap,
	renderReport,
	summaryRow,
	TABLE_HEADER,
} from "./report";
import { runCase } from "./runner";

const RESULTS_DIR = path.join(import.meta.dir, "results");
const print = (line: string) => process.stdout.write(`${line}\n`);

function select<T extends string>(
	value: string | undefined,
	available: readonly T[],
	name: string,
): T[] {
	if (value === undefined) return [...available];
	const requested = [...new Set(value.split(",").map((item) => item.trim()))];
	if (
		!requested.length ||
		requested.some((item) => !available.includes(item as T))
	)
		throw new Error(`${name}: choose from ${available.join(", ")}`);
	return requested as T[];
}

async function clientCredentialsToken(): Promise<string> {
	const id = process.env.SPOTIFY_CLIENT_ID;
	const secret = process.env.SPOTIFY_CLIENT_SECRET;
	if (!id || !secret) throw new Error("SPOTIFY_CLIENT_ID/SECRET missing");
	const res = await fetch("https://accounts.spotify.com/api/token", {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
		},
		body: "grant_type=client_credentials",
	});
	if (!res.ok) throw new Error(`Spotify token HTTP ${res.status}`);
	return ((await res.json()) as { access_token: string }).access_token;
}

test(
	"curator harness live eval",
	async () => {
		const selectedCases = select(
			process.env.EVAL_CASES,
			CASES.map((item) => item.id),
			"EVAL_CASES",
		);
		const selectedEngines = select(
			process.env.EVAL_ENGINES,
			ENGINE_IDS,
			"EVAL_ENGINES",
		);
		const judges = select(
			process.env.EVAL_JUDGE_ENGINE ?? "gemini",
			ENGINE_IDS,
			"EVAL_JUDGE_ENGINE",
		);
		const judgeEngine = judges[0];
		if (judges.length !== 1 || !judgeEngine)
			throw new Error("Choose exactly one EVAL_JUDGE_ENGINE");
		const pauseMs = Number(process.env.EVAL_PAUSE_MS ?? 15000);
		if (
			process.env.EVAL_PAUSE_MS?.trim() === "" ||
			!Number.isInteger(pauseMs) ||
			pauseMs < 0 ||
			pauseMs > 60000
		)
			throw new Error("EVAL_PAUSE_MS must be an integer from 0 to 60000");
		await mkdir(RESULTS_DIR, { recursive: true });
		const files = (await readdir(RESULTS_DIR))
			.filter((file) => file.endsWith(".json"))
			.sort()
			.reverse();
		const previous = [];
		for (const file of files) {
			try {
				const parsed: unknown = JSON.parse(
					await readFile(path.join(RESULTS_DIR, file), "utf8"),
				);
				previous.push(
					...historicalResults(parsed).map((result) => ({ file, result })),
				);
			} catch {
				print(`Skipping unreadable history: ${file}`);
			}
		}
		const run: EvalRun = {
			schemaVersion: 2,
			startedAt: new Date().toISOString(),
			source: {
				revision: execFileSync("git", ["rev-parse", "HEAD"], {
					encoding: "utf8",
				}).trim(),
				dirty: !!execFileSync("git", ["status", "--porcelain"], {
					encoding: "utf8",
				}).trim(),
			},
			selectedCases,
			selectedEngines,
			judgeEngine,
			complete: false,
			records: [],
		};
		const stem = path.join(RESULTS_DIR, run.startedAt.replace(/[:.]/g, "-"));
		const save = async () => {
			await writeFile(`${stem}.json.tmp`, JSON.stringify(run, null, 2));
			await rename(`${stem}.json.tmp`, `${stem}.json`);
			await writeFile(`${stem}.md`, renderReport(run));
		};
		TEST_SESSION.user.accessToken = await clientCredentialsToken();
		const listener = await loadListener();
		print(`Artifacts: ${stem}.{json,md}`);
		print(TABLE_HEADER);
		await save();
		for (const evalCase of CASES.filter((item) =>
			selectedCases.includes(item.id),
		)) {
			for (const engine of selectedEngines) {
				// The fixed judge shares a provider quota with one generator.
				if (run.records.length) await Bun.sleep(pauseMs);
				const record: CaseRecord = {
					caseId: evalCase.id,
					engine,
					failures: [],
					overlap: "n/a",
				};
				run.records.push(record);
				try {
					const result = await runCase(evalCase, engine, listener);
					record.result = result;
					record.overlap = overlap(result, previous);
					if (result.tracks !== evalCase.trackCount)
						record.failures.push(
							`Expected ${evalCase.trackCount} tracks, received ${result.tracks}`,
						);
					if (result.uniqueArtists !== result.tracks)
						record.failures.push("Repeated artist");
					if (!result.tracks || result.onSpotify / result.tracks < 0.8)
						record.failures.push("on Spotify rate below 80%");
					if (!result.name || !result.description)
						record.failures.push("Missing name or description");
					await save();
					record.judgment = await judgePlaylist(result, judgeEngine);
					if (record.judgment.status === "error")
						record.failures.push(record.judgment.error);
				} catch (error) {
					record.failures.push(
						error instanceof Error ? error.message : String(error),
					);
				}
				await save();
				print(summaryRow(record));
			}
		}
		run.complete = true;
		await save();
		print(`Review: ${stem}.md`);
		expect(
			run.records.flatMap((record) =>
				record.failures.map(
					(failure) => `${record.caseId}/${record.engine}: ${failure}`,
				),
			),
		).toEqual([]);
	},
	30 * 60 * 1000,
);
