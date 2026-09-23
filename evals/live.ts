// Without LIVE_EVAL the test preload swaps in test-only evidence settings and
// fake keys, which silently turns a live run into a broken one.
if (!process.env.LIVE_EVAL)
	throw new Error("Run evals through `bun run eval*`, which sets LIVE_EVAL=1.");
