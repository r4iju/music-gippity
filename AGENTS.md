<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project runner

This project runs in the project runner: run installs, builds, tests, dev
servers and package scripts through `prun`, never directly on the Mac.

- Install: `prun bun install --frozen-lockfile`. The runner skips install
  scripts, so `prepare` (husky) does not run; nothing else needs it.
- Checks: `prun bun run ci`, `prun bun run typecheck`, `prun bun run test`.
- Build: `prun bun run build`.
- Dev server: `prun --port 3025 bun run next:dev`, then open
  http://localhost:3025. Stop it with Ctrl-C on the `prun` process.
  `bun run dev` also starts `turso dev`, which is not in the container, so
  pages that use the database fail in dev until the local database moves to
  libsql `file:` mode.
- The `eval*` and `db:*` scripts call live APIs or the production database;
  run them only when the task asks for it.
- Codex threads get no `.env` files: install, checks and tests work; a
  production build or dev server needs a Claude thread.
