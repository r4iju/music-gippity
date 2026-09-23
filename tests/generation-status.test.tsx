import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GenerationStatus } from "~/app/dashboard/create-playlist/generation-status";

test("creation keeps the progress panel in place without allowing premature cancellation", () => {
	const html = renderToStaticMarkup(
		<GenerationStatus
			preparation="creating"
			count={0}
			target={20}
			onCancel={() => {}}
			onKeep={() => {}}
			onRetry={() => {}}
		/>,
	);
	expect(html).toContain("Creating your playlist");
	expect(html).toContain('role="progressbar"');
	expect(html).toContain("disabled");
});

test("interrupted state offers explicit recovery and never implies resume", () => {
	const html = renderToStaticMarkup(
		<GenerationStatus
			generation={{ status: "interrupted", message: "Connection ended early." }}
			count={3}
			target={10}
			onCancel={() => {}}
			onKeep={() => {}}
			onRetry={() => {}}
		/>,
	);
	expect(html).toContain("Connection ended early.");
	expect(html).toContain("3 of 10");
	expect(html).toContain("Keep these tracks");
	expect(html).toContain("Generate again");
	expect(html).toContain("new generation");
});

test("running can stop; an empty interruption cannot keep tracks", () => {
	const props = {
		count: 0,
		target: 10,
		onCancel() {},
		onKeep() {},
		onRetry() {},
	};
	expect(
		renderToStaticMarkup(
			<GenerationStatus
				{...props}
				generation={{ status: "running", runId: "run" }}
			/>,
		),
	).toContain("Stop generation");
	expect(
		renderToStaticMarkup(
			<GenerationStatus
				{...props}
				generation={{ status: "interrupted", message: "Stopped" }}
			/>,
		),
	).not.toContain("Keep these tracks");
});

test("durable phases and failed outcomes remain honest after accepting partial tracks", () => {
	const props = {
		count: 3,
		target: 10,
		onCancel() {},
		onKeep() {},
		onRetry() {},
	};
	const running = renderToStaticMarkup(
		<GenerationStatus
			{...props}
			run={{ id: "run", state: { status: "running", phase: "resolution" } }}
		/>,
	);
	expect(running).toContain("Matching recordings");
	expect(running).toContain("3 of 10 tracks ready");
	const kept = renderToStaticMarkup(
		<GenerationStatus
			{...props}
			generation={{ status: "kept" }}
			run={{
				id: "run",
				state: {
					status: "failed",
					phase: "rerank",
					failure: {
						code: "ambiguous",
						message: "A paid request could not be confirmed.",
					},
				},
			}}
		/>,
	);
	expect(kept).toContain("Generation failed");
	expect(kept).toContain("A paid request could not be confirmed.");
	expect(kept).toContain("Using your kept tracks");
	expect(kept).not.toContain("Keep these tracks");
});
