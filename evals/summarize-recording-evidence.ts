import { readFile } from "node:fs/promises";
import { z } from "zod";

const input = process.argv[2];
if (!input) throw new Error("Pass a saved recording-evidence JSON file");
const run = z
	.object({
		source: z.object({
			revision: z.string(),
			dirty: z.boolean(),
			fixtureSha256: z.string(),
			driverSha256: z.string(),
		}),
		cases: z.array(
			z.object({
				id: z.string(),
				artist: z.string(),
				title: z.string(),
				label: z.enum(["vocals", "instrumental", "unknown"]),
			}),
		),
		records: z.array(
			z.object({
				engine: z.enum(["chatgpt", "gemini"]),
				condition: z.enum(["knowledge", "evidence"]),
				repeat: z.number().int().min(1).max(3),
				ms: z.number(),
				error: z.string().optional(),
				answers: z
					.array(
						z.object({
							id: z.string(),
							verdict: z.enum(["vocals", "instrumental", "uncertain"]),
							confidence: z.string(),
							reason: z.string(),
							evidenceIds: z.array(z.string()),
						}),
					)
					.optional(),
			}),
		),
	})
	.parse(JSON.parse(await readFile(input, "utf8")));
if (new Set(run.cases.map((c) => c.id)).size !== run.cases.length)
	throw new Error("Duplicate cases");
if (
	new Set(run.records.map((r) => `${r.engine}/${r.condition}/${r.repeat}`))
		.size !== run.records.length
)
	throw new Error("Duplicate experiment calls");
const cell = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");
const lines = [
	"# Recording evidence results",
	`Experiment calls: ${run.records.length}/12 (${run.records.length === 12 ? "complete" : "INCOMPLETE; totals cover observed calls only"}).`,
	"",
	`Source revision: \`${run.source.revision}\`; dirty: ${run.source.dirty}.`,
	`Fixture SHA-256: \`${run.source.fixtureSha256}\`.`,
	`Driver SHA-256: \`${run.source.driverSha256}\`.`,
	"",
	"Three repeated classifications of each recording are repeated observations, not independent tracks. Correctness means agreement with frozen source-supported labels, not listening-established truth. Unknown reference labels are excluded from correctness totals. Wrong excludes abstentions; missing includes invalid calls. Timings measure reviewer calls only, excluding source retrieval and curation.",
	"",
	"| Engine | Condition | Opportunities | Correct | Wrong | Abstain | Missing | Vocal missed as instrumental | Instrumental flagged vocal | Median call ms |",
	"|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
];
for (const engine of ["chatgpt", "gemini"] as const) {
	for (const condition of ["knowledge", "evidence"] as const) {
		const records = run.records.filter(
			(r) => r.engine === engine && r.condition === condition,
		);
		const known = run.cases.filter((c) => c.label !== "unknown");
		let correct = 0,
			wrong = 0,
			abstain = 0,
			missing = 0,
			missed = 0,
			flagged = 0;
		for (const record of records) {
			for (const c of known) {
				const answer = record.error
					? undefined
					: record.answers?.find((a) => a.id === c.id);
				if (!answer) missing++;
				else if (answer.verdict === "uncertain") abstain++;
				else if (answer.verdict === c.label) correct++;
				else {
					wrong++;
					if (c.label === "vocals") missed++;
					else flagged++;
				}
			}
		}
		const times = records.map((r) => r.ms).sort((a, b) => a - b);
		const mid = Math.floor(times.length / 2);
		const median = times.length
			? times.length % 2
				? times[mid]
				: ((times[mid - 1] ?? 0) + (times[mid] ?? 0)) / 2
			: "n/a";
		lines.push(
			`| ${engine} | ${condition} | ${records.length * known.length} | ${correct} | ${wrong} | ${abstain} | ${missing} | ${missed} | ${flagged} | ${median} |`,
		);
	}
}
lines.push(
	"",
	"## Per-recording verdicts",
	"",
	"V = vocals, I = instrumental, U = uncertain. Each cell lists repetitions in order; confidence follows each verdict. Unknown reference cases have no established binary truth.",
	"",
	"| Recording | Reference | OpenAI knowledge | OpenAI evidence | Gemini knowledge | Gemini evidence |",
	"|---|---|---|---|---|---|",
);
for (const c of run.cases) {
	const cells: string[] = [];
	for (const engine of ["chatgpt", "gemini"] as const) {
		for (const condition of ["knowledge", "evidence"] as const) {
			cells.push(
				run.records
					.filter((r) => r.engine === engine && r.condition === condition)
					.sort((a, b) => a.repeat - b.repeat)
					.map((r) => {
						const a = r.answers?.find((a) => a.id === c.id);
						return r.error || !a
							? "ERROR"
							: `${a.verdict === "vocals" ? "V" : a.verdict === "instrumental" ? "I" : "U"}/${a.confidence}`;
					})
					.join(", "),
			);
		}
	}
	lines.push(
		`| ${cell(`${c.artist} — ${c.title}`)} | ${c.label} | ${cells.join(" | ")} |`,
	);
}
lines.push(
	"",
	"## Reasons from the first repetition",
	"",
	"Full responses for all repetitions remain in the raw JSON. These are model claims, not additional verified facts. Citation IDs refer to the frozen fixture.",
	"",
	"| Recording | Engine | Condition | Verdict | Confidence | Reason | Evidence IDs |",
	"|---|---|---|---|---|---|---|",
);
for (const record of run.records.filter((r) => r.repeat === 1)) {
	for (const a of record.error ? [] : (record.answers ?? [])) {
		lines.push(
			`| ${cell(a.id)} | ${record.engine} | ${record.condition} | ${a.verdict} | ${a.confidence} | ${cell(a.reason)} | ${cell(a.evidenceIds.join(", "))} |`,
		);
	}
}
lines.push("", "## Errors", "");
const errors = run.records.filter((r) => r.error);
lines.push(
	...(errors.length
		? errors.map(
				(r) =>
					`- ${r.engine}/${r.condition}/${r.repeat}: ${cell(r.error ?? "")}`,
			)
		: ["None."]),
);
process.stdout.write(`${lines.join("\n")}\n`);
