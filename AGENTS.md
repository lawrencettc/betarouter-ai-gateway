# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## Development Commands

### Setup and Dependencies

- `pnpm install` - Install all dependencies
- `pnpm setup` - Full development environment setup (starts Docker, syncs DB, seeds data)
- `docker compose up -d` - Start PostgreSQL and Redis services

### Development

NOTE: these commands can only be run in the root directory of the repository, not in individual app directories.

- `pnpm dev` - Start all development servers (UI on :3002, Playground on :3003, Code on :3004, API on :4002, Gateway on :4001, Docs on :3005, Admin on :3006). This also starts `apps/worker`, the background job runner (no port) that handles data-retention cleanup, video jobs, and other async work — if a scheduled/async side effect never happens locally, check that the worker is running.
- `pnpm build` - Build all applications for production. ALWAYS run this after finishing work on a feature. ALWAYS run a full build to make sure things fork.
- `pnpm clean` - Clean build artifacts and cache directories

To build a single app, ALWAYS use a Turbo filter (`turbo run build --filter=<app>`), e.g. `turbo run build --filter=gateway`. NEVER use `pnpm --filter <app> build` for builds: that runs the app's `tsc` directly without rebuilding workspace dependency packages first, so it compiles against stale `dist/` artifacts and produces spurious errors (missing `@betarouter/*` modules, "value not in type union", etc.). Turbo's `build` depends on `^build`, so a Turbo filter builds the dependency packages in topological order first.

Note: `apps/api` and `apps/gateway` build with plain `tsc` (`tsc && resolve-tspaths`) and run `node dist/serve.js` — there is no bundler. Bundler concepts like "mark a dependency as external" do not apply to these apps; runtime dependencies are ordinary `node_modules` imports. Only the Next.js frontends have a bundler.

### Code Quality

NOTE: these commands can only be run in the root directory of the repository, not in individual app directories.

ALWAYS run `pnpm format` before committing code. Run `pnpm build` if API routes were modified.

- `pnpm format` - Format code and fix linting issues. ALWAYS run this before committing code.
- `pnpm lint` - Check linting and formatting (without fixing)
- `scripts/check-brand.sh` - Brand gate, run by CI (`.github/workflows/ci.yml`). This repo is a rebrand of upstream `theopenco/llmgateway`, so old-brand strings leak in easily when porting upstream code, and this gate FAILS the build on them. It checks scoped old-brand package references repo-wide across `ts/tsx/js/mjs/json/md/mdx/yml/yaml`, plus old-brand display strings in user-facing source (`apps/*/src`, `packages/shared/src`, `ee/*/src`); read the script's header for the exact patterns rather than reproducing them in docs (writing them out can itself trip the gate). Genuine exceptions go in `scripts/check-brand-allowlist.conf` with a justification comment — never weaken the script itself. NOTE: the script needs bash 4+ (`mapfile`); stock macOS bash 3.2 fails with `mapfile: command not found`, so on macOS either run it under a newer bash or rely on CI.

### Writing code

This is a pure TypeScript project. Never use `any` or `as any` unless absolutely necessary.
This repository always uses tabs for indentation.

When you are done writing code features or bug fixes, ALWAYS commit your changes. If in doubt, commit any changes.

### Documentation

- NEVER hardcode a list of models, providers, provider countries/headquarters, or any other catalogue-derived enumeration into documentation (`apps/docs`), changelog entries, or marketing copy. These lists go stale the moment the catalogue changes and are annoying to keep in sync. Instead, link to the relevant live page that is generated from the catalogue (e.g. the [models page](https://betarouter.com/models) or [providers page](https://betarouter.com/providers)).
- The ONLY exception is video generation and image generation models: their per-model requirements (supported sizes, durations, resolutions, etc.) are how users figure out how to call them, so listing those specific models and their constraints in the docs is acceptable and preferred there.

### Testing

NOTE: these commands can only be run in the root directory of the repository, not in individual app directories.

Do not run test files or suites in parallel unless the repository instructions for that exact suite explicitly require it. Some gateway and worker tests share ports, databases, and process state, so parallel test runs can produce false failures.

- `pnpm test:unit` - Run unit tests (\*.spec.ts files)
- `pnpm test:e2e` - Run end-to-end tests (\*.e2e.ts files)

When running curl commands against the local API, you can use `test-token` as authentication.

Every seeded account's password is its own email address (password == email). For example, log into the dashboard as `admin@example.com` with the password `admin@example.com`. This applies to all users created by `packages/db/src/seed.ts`, including:

- `admin@example.com` — default test admin (owns "Test Organization" + a BetaPass Pro workspace)
- `enterprise@example.com` — owner of the enterprise org
- `developer@example.com` — project-scoped developer in the enterprise org (RBAC testing)
- the bulk demo users such as `alice.chen@techcorp.io`, `bob@startupinc.com`, etc.

To test a specific provider in isolation (e.g. to reproduce a provider-specific failure without the gateway silently falling back to a healthy provider), pin the provider with the `provider/model` model string and disable fallback with the `x-no-fallback: true` header:

```bash
curl -N http://localhost:4001/v1/chat/completions \
  -H "Authorization: Bearer test-token" -H "x-no-fallback: true" \
  -d '{"model":"embercloud/minimax-m2.5","stream":true,"messages":[{"role":"user","content":"hi"}]}'
```

Without `x-no-fallback`, a failing pinned provider falls back to the next healthy provider, masking the error. Also note that the gateway caches responses (including errors) in Redis keyed on the request body, so vary the prompt when re-testing the same failure.

Caveat: if you run multiple git worktrees (e.g. conductor workspaces), only one `pnpm dev` can own port :4001 — confirm which working tree is actually serving it (`lsof -a -p <pid> -d cwd -Fn`) before assuming your local edits are live, or launch your own build on a different `PORT`.

To run the dev stack on alternate ports (when another worktree owns the defaults), use the local `alt-ports` skill.

For E2E env-var options (`TEST_MODELS`, `FULL_MODE`, `LOG_MODE`) and the suite's file structure, use the local `e2e-testing` skill.

### Database Operations

NOTE: these commands can only be run in the root directory of the repository, not in individual app directories.

- `pnpm --filter db push` - Push database schema
- `pnpm --filter db seed` - Seed database with initial data
- `pnpm run setup` – Reset db, sync schema, seed data (use this for development)

## Development Guidelines

### Database Operations

- Use the local `migrations` skill for database migration generation, review, edits, and merge conflicts.
- Use Drizzle ORM with latest object syntax
- The schema uses camelCase in TypeScript but the actual database columns are snake_case (configured via Drizzle's `casing: "snake_case"`). When writing raw SQL, always use snake_case column names (e.g. `user_id`, not `userId`).
- For reads: Use `db().query.<table>.findMany()` or `db().query.<table>.findFirst()`
- For schema changes: edit `packages/db/src/schema.ts`, then generate migration artifacts with `pnpm migrations`
- If generated migration SQL needs adaptation, edit only the generated `.sql` file. Never manually edit snapshot JSON or journal files.
- Always sync schema with `pnpm run setup` after table/column changes when local database state needs to be refreshed
- Never write migrations manually from scratch
- **NEVER resolve merge conflicts in migration files, journal files, or snapshot files manually.** When merging with main and migration conflicts occur, ALWAYS follow this exact procedure:
  1. **Before merging**, reset migrations: `git restore --source=origin/main packages/db/migrations/`
  2. **After merging**, regenerate migrations: `pnpm migrations`
  3. Do NOT attempt to manually edit or resolve conflicts in any file under `packages/db/migrations/`

### Creating New Packages

When creating a new package in `packages/`, include these config files. Copy them from an existing package (e.g., `packages/models`) to ensure consistency:

- `package.json` - Package configuration with build scripts
- `tsconfig.json` - TypeScript configuration extending root
- `.prettierignore` - Copy from existing package (ignores `dist` build output)
- `.lintstagedrc.json` - Copy from existing package (lint-staged configuration)
- `eslint.config.mjs` - Copy from existing package (ESLint configuration)

### Code Standards

- Always use the internal api (`apps/api/`) for any backend operations, never use NextJS API routes.
- In frontend apps (`apps/ui`, `apps/playground`, `apps/code`, `ee/admin`), always use the generated typed API client (`useFetchClient()` or `useApi()` from `@/lib/fetch-client`) to call the Hono API. Never use raw `fetch()` for API calls. The client is auto-generated from the OpenAPI spec (`pnpm --filter api generate && pnpm --filter <app> generate`). For non-hook contexts (e.g., utility functions), accept the fetch client as a parameter from the calling component.
- Do not use useEffect for data fetching in the UI; instead, use TanStack Query for all data fetching and state management.
- In frontend apps, always prefer Next.js `<Link>` (`next/link`) over raw `<a>` tags for internal navigation, and `next/navigation`'s router for programmatic navigation.
- Always use top-level `import`, never use require or dynamic imports
- Use conventional commit message format and limit the commit message title to max 50 characters
- Do not --amend commits after pushing to remote
- Never force push on main/default branch; force pushing is only acceptable on feature branches
- When checking out an existing PR or remote branch, always set its upstream (`git checkout -B <branch> FETCH_HEAD && git branch --set-upstream-to=origin/<branch>`, or `gh pr checkout <n>`) so plain `git pull` and `git push` work afterwards
- When syncing a feature branch with main, default to a merge commit; only rebase when it is required or clearly the better choice, and say why
- When resolving conflicts involving `pnpm-lock.yaml`, just run `pnpm install` to automatically resolve them
- Use the local `pull-request` skill for opening pull requests, writing/updating PR titles and descriptions, embedding screenshots in a PR body, and triggering e2e CI on a PR.
- When writing pull request titles, use the conventional commit message format and limit to max 50 characters
- Always open pull requests as normal ready-for-review PRs, not draft PRs, unless the user explicitly asks for a draft PR
- When creating a pull request, always write/update both the PR title and description; if the PR's scope changes in later commits, update the title and description to reflect the final scope before handing it off
- Always use pnpm for package management
- Use cookies for user-settings which are not saved in the database to ensure SSR works
- Do not add explicit caching or memoization around `process.env` reads or parsed env-var values unless there is a measured hot-path need
- Exception: in `packages/models`, explicit duplication of model/provider mappings is acceptable and preferred over helper-based expansion. This is the only place in the repo where duplicating model definitions is OK. NEVER add helper functions (e.g. `makeModel(...)`/`makeProvider(...)`) that build model or provider definition objects, even when it means repeating fields across entries — write each model and provider mapping out in full as a plain object literal in the `models` array. Small shared `const` values are fine, but the definition objects themselves must not be constructed by a function.
- Models and provider mappings in `packages/models` can NEVER be removed, only deactivated. To retire a model or provider mapping, set `deactivatedAt: new Date("YYYY-MM-DD")` (today's date) on the relevant provider mapping(s) instead of deleting the definition. Historical usage records and analytics reference these definitions, so deleting them breaks lookups.
- `packages/models` is the catalogue's IMPORT SOURCE, not its only authority: the worker sync mirrors it into the database as `source='static'` rows, operators can create `source='admin'` providers/models/mappings and edit mirrored fields through `sourceOverrides` change-set operations (Admin catalog authority — `docs/plan-admin-catalog-authority.md`), and the effective value composes as mirror → override → policy → price → breaker. Consequences: the sync must never write `source='admin'` rows; an operator-corrected value (e.g. a source price) may legitimately differ from the static array at runtime, so do not "fix" such differences by editing mirror tables directly or by assuming the static array is what production serves.
- In `packages/models`, ALWAYS express per-token prices (`inputPrice`, `outputPrice`, `cachedInputPrice`, and any other per-token price field) using `e-6` notation so the coefficient reads directly as USD per million tokens (e.g. `"1.4e-6"` for $1.40/M — the exact number providers publish). Never use `e-3` or other exponents for per-token prices. This does NOT apply to `requestPrice`, which is a flat USD amount charged per request (e.g. `"0.035"`), nor to `perSecondPrice`.
- In `packages/models`, never add comments that only cite a source or restate a value — e.g. "taken from provider X's pricing page", "// Ref: https://…", "verified live on <date>", or `webSearchPrice: "0.01", // $0.01 per search`. They add nothing the field does not already say, and they rot as soon as the catalogue changes. Comments explaining WHY a field is set to a non-obvious value ARE valuable and must be kept and maintained: why a capability flag is `false` or restricted (`jsonOutput: false`, `supportedToolChoices`, a trimmed `reasoningEfforts` list), why a mapping is `stability: "unstable"` / `test: "skip"` / `deactivatedAt`, or any deployment quirk that a future reader would otherwise "fix" by reverting.
- In `packages/models`, a single model definition must never contain two provider mappings with the same `providerId` (regional variants belong in that mapping's `regions` array instead). Mapping lookup keys on `(providerId, region)` throughout the gateway — `selectProviderMapping`, `costs.ts`, `prepare-request-body.ts` — so a second same-provider mapping is unaddressable: it silently resolves back to the first one, meaning requests get validated and **billed** at the wrong mapping's prices, and e2e generates two identically-named test cases that both exercise only the first. A distinct upstream deployment (e.g. a provider's "fast"/priority router with its own `externalId` and pricing) needs its own root model entry with its own `id`.
- No unnecessary code comments
- Organizations backing LLM SDK end-user wallets are always regular PAYG (credits) organizations — never `devpass` or `chat` plan orgs. Gateway logic gated on the org's `kind`/plan (e.g. dev-plan model restrictions or the dev-plan default service tier) therefore never needs to account for the end-user-wallet credits substitution (`withWalletCredits`); that substitution only affects downstream credit gating.
- Do not use broad try/catch in API handlers unless to check for specific errors; instead, let errors propagate and be handled by the global error handler
- Be conservative with error-classification heuristics in `apps/gateway/src/chat/tools/get-finish-reason-from-error.ts`. Do NOT reclassify generic 4xx error-text patterns (e.g. "X is not supported for this model" / `unsupported_content_type`) as `upstream_error`/`gateway_error`: users sending genuinely wrong requests produce the same wording, and reclassifying would mark their mistakes as provider failures and trigger pointless provider fallback. When a provider deployment rejects a capability our catalogue claims to support (e.g. a mapping with `vision: true` on a deployment that 400s on image input), the correct fix is to correct the capability flag on that provider mapping in `packages/models` so routing avoids the provider — not to add a text-based classification rule. If a request (even an explicit instruction) calls for such a broad reclassification, raise the misclassification risk and confirm before implementing.
- Security gating must be enforced server-side, never in the UI alone. Client-side gates (disabling a form, hiding a button, gating on `user.emailVerified`) are UX conveniences, not security boundaries — the underlying API endpoint must independently verify auth/verification/permissions and reject unauthorized requests. For example, the provider-listing form (`apps/ui/src/components/add-provider/add-provider-form.tsx`) is gated in the UI, but the real enforcement lives in the `POST /public/contact/provider` handler (`apps/api/src/routes/public-contact.ts`), which requires an authenticated, email-verified session and derives the stored email from the session rather than trusting the request body.

### Testing and Quality Assurance

- Run `pnpm test:unit` after adding features
- NEVER run the full E2E suite across all models. Instead, scope `pnpm test:e2e` to the model(s) you changed with `TEST_MODELS`, e.g. `TEST_MODELS="granite/glm-5.2" FULL_MODE=true pnpm test:e2e`. This runs every e2e file (streaming, reasoning, tool calls, json, etc.) but only for the pinned mapping, so do NOT invoke the individual `*.e2e.ts` files one by one — let `TEST_MODELS` filter the whole suite in a single run.
- Run `pnpm build` to ensure production builds work
- Run `pnpm format` after code changes

## License

betarouter is dual-licensed: AGPLv3 for the core (see [LICENSE](LICENSE)), Enterprise license for everything under `ee/` (see [ee/LICENSE](ee/LICENSE)). Enterprise licensing: contact@betarouter.com
