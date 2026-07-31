---
name: alt-ports
description: Run the betarouter dev stack on alternate ports to avoid conflicts with another git worktree that already owns :4002/:3002/etc. Use when `pnpm dev` hits a port collision, when multiple worktrees (e.g. conductor workspaces) need concurrent stacks, or when you must confirm which working tree is actually serving a port.
---

# Running the dev stack on alternate ports (avoiding worktree conflicts)

When another worktree already owns the default ports, run your stack on an offset range instead of fighting for :4002/:3002/etc. The wiring is driven entirely by env vars — no code changes needed:

- **API port**: `PORT` (default `4002`). The API's own base URL is `API_URL`.
- **Frontends → API**: every frontend resolves the backend from `API_URL` (default `http://localhost:4002`), read server-side in `apps/*/src/lib/config-server.ts`. Set it to your relocated API for each frontend process.
- **Auth + CORS**: the API reads `ORIGIN_URLS` (comma-separated CORS/better-auth trusted-origins allowlist; defaults to `localhost:3002..3006,4002`) and `UI_URL`. If you relocate a frontend you MUST add its new origin to `ORIGIN_URLS` or login/API calls fail CORS. Login itself works across ports because the better-auth session cookie is host-only for `localhost` (shared across all ports) — no `COOKIE_DOMAIN` change needed.

Two gotchas:

- The `ui`/`playground`/`code` `dev` scripts hard-code `--port` in `package.json`, so overriding `PORT` alone won't move them — run `next dev --port <n>` directly.
- The API `dev` script loads `../../.env` via `node --env-file`; Node does NOT override already-exported process env, so vars you `export`/prefix on the command line win over `.env`.

Example: API on :4102, UI on :3102, Playground on :3103 (run from repo root, backgrounded):

```bash
ORIGINS="http://localhost:3102,http://localhost:3103,http://localhost:4102"
( cd apps/api && PORT=4102 API_URL=http://localhost:4102 UI_URL=http://localhost:3102 ORIGIN_URLS="$ORIGINS" \
    node --enable-source-maps --env-file=../../.env dist/serve.js )        # build first: turbo run build --filter=api
( cd apps/ui         && API_URL=http://localhost:4102 pnpm exec next dev --port 3102 --turbopack )
( cd apps/playground && API_URL=http://localhost:4102 pnpm exec next dev --port 3103 --turbopack )
```

Running the built `dist/serve.js` gives no watch (rebuild + restart the API after code changes); swap in the `api` package's `dev` script if you want tsc-watch. All apps share the one Postgres/Redis on the default ports, so the relocated stack sees the same seeded DB.
