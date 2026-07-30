# Plan: Upstream Integration — 140 Commits (v1.10.0 + Unreleased)

Status: Stage 0–1 in progress on branch `claude/upstream-release-integration-11b4y7`.

## Context

- Fork point: upstream `theopenco/llmgateway` commit `57ad9fc04` (2026-07-21), byte-identical
  to our import commit `360e400`.
- Upstream is **140 commits ahead**: 78 up to tag `v1.10.0` (2026-07-26) + 62 unreleased.
- Our fork is **66 commits ahead**: rebrand (betarouter/BetaPass), production deployment,
  and the Admin Provider/Model Catalog initiative (`packages/catalog`, catalog-policy hooks
  in every gateway endpoint, 8 local migrations, platform credentials).
- Simulated merge (`git merge-tree --merge-base=360e400 HEAD upstream/main`): **169
  conflicted files** — ~48 rename-only, ~14 prettier noise, ~75 UI/marketing copy,
  ~22 genuine engineering conflicts, 12 modify/delete, 1 journal, 1 add/add.

Decision: **take all 140 commits, staged**. Stopping at v1.10.0 forfeits nearly all
security fixes (they are unreleased) while still paying ~70% of the conflict cost.

## Key hazards (established by analysis, must be re-verified at each stage)

1. **Silent billing defect**: upstream extracted the chat cancel path into
   `respondCanceledStreaming`, whose `calculateCosts` call lacks our `pricingOverride`.
   Merged tree shows 12 `calculateCosts` sites but only 11 with `pricingOverride` — the
   missing one is in a _cleanly merged_ region. Every upstream helper extraction in
   `chat.ts` (800 changed lines, only 6 conflicts) is a candidate for silently dropping
   catalog hooks.
2. **Catalog governance bypass**: new upstream surfaces `/v1/realtime`, `/v1/rerank`,
   `/v1/audio/transcriptions` resolve models from the static `@betarouter/models` array —
   no `enforceCatalogRequest`, no `pricingOverride`. Must be hooked (via
   `upstream-dispatcher.ts`) before those endpoints are enabled.
3. **Migration procedure exception**: the standard CLAUDE.md restore-and-regenerate
   procedure is **destructive for this merge**. Upstream migrations `1785105737` and
   `1785190561` are hand-annotated with `CREATE INDEX CONCURRENTLY` prep that drizzle-kit
   cannot regenerate; and after a naive merge the final snapshot lacks our 13 `platform_*`
   tables, so `pnpm migrations` would emit `DROP TABLE` for all of them. Correct order:
   adopt upstream's 13 migrations **verbatim**, remove our 8 local migrations + snapshots,
   regenerate ours as **one** new migration on top of upstream's final snapshot, hand-add
   `IF NOT EXISTS` guards only if a deployed DB already applied the old 8.
4. **Credential-selection design merge**: upstream's plan-scoped env variants
   (`LLM_OPENAI_API_KEY__ENTERPRISE`, `excludedIndices`, `getOrganizationEnvVariant`) and
   our platform credentials (`requiredCredentialId`, `decryptPlatformProviderToken`)
   rewrote the same functions. Resolve `get-provider-env.ts` first as a superset options
   type with precedence: **platform credential → variant env → plain env**; propagate to
   `resolve-provider-context.ts`, `chat.ts`, `video-jobs.ts`, and the five non-chat
   endpoints. The video-job poller must use the same credential class as job creation.
5. **Dependency direction**: we are _ahead_ of upstream on `better-auth` (1.6.25 vs
   1.6.23) and several security overrides. `package.json` conflicts resolve as a
   **union taking the max/strictest** — never blind "theirs".
6. **Brand leakage**: 221 new upstream files, 54 importing `@llmgateway/*` (loud build
   failure), ~1000 old-brand strings (silent). CI grep gate + sweep script guard this.

## Stages

### Stage 0 — Preparation (this PR)

- [x] Rebrand debt audit: remaining `@llmgateway` references are only the legitimate
      third-party npm package `@llmgateway/ai-sdk-provider` — no action needed beyond
      excluding it in the gate.
- [ ] `scripts/check-brand.sh` grep gate (CI-wired): fails on `@llmgateway/*` imports
      (except `@llmgateway/ai-sdk-provider`) and old brand strings in user-facing source.
- [ ] Rename-sweep helper script for future upstream merges
      (`@llmgateway/` → `@betarouter/`, brand strings, key prefixes).
- [ ] Catalog-enforcement invariant test suite: asserts `pricingOverride` at every billed
      `calculateCosts` site and `enforceCatalogRequest`/catalog filtering on every billed
      gateway endpoint. Must pass on HEAD; becomes the regression net for hazards 1–2.
- Prettier: both sides already resolve to 3.9.6; spec pinned to `^3.9.6` for parity.

### Stage 1 — Security + models (this PR)

- Cherry-picks: `fa6595a03` (brace-expansion DoS), `dd6587a2e` (crypto-random),
  `c417c2816` (min password length 12), `46e1aab48` (CI `GITHUB_TOKEN` restriction,
  adapted to our trimmed workflow set), `d4c497783` (safety-id from tenant ids),
  plus advisory dependency bumps not already applied locally.
- Apply the full `packages/models` delta `57ad9fc04..upstream/main` (6 new providers,
  ~25 new models, 19 `deactivatedAt` retirements; zero merge conflicts). Preserve local
  additions (openai-moderation entry, mistral e-6 price fix). All prices e-6 notation.
- `package.json` overrides: union taking max.
- Note: `minPasswordLength: 12` affects sign-up/reset/change only; verify seed users and
  any e2e that creates accounts via sign-up still pass.

### Stage 2 — Schema + migrations

Follow the migration procedure exception (hazard 3) exactly. Run the two
`CREATE INDEX CONCURRENTLY` preps out-of-band on staging, then production, **before**
the migrator. Verify `pnpm migrations` is a no-op afterwards. Lands: `user_iam_rule`,
`refund_feedback`, `model_survey_response`, `log.api_origin`, TTFT counters,
`provider_key.compliance_attestation`, realtime tables, `provider_stats_v2` indexes.

### Stage 2 outcome — ops prerequisite (MIGRATOR LEDGER)

Stage 2 landed as one regenerated migration (`1785376241_lively_starbolt`, journal
idx 216, fully `IF NOT EXISTS`-guarded). **Deploy hazard for databases that already
applied our old 8 migrations** (high-water mark `1784934282664`): drizzle's migrator
skips migrations with older timestamps, so upstream's `1784722021_pretty_bromley`
(user_iam_rule) and `1784752643_loose_rocket_racer` (model_survey_response) would be
**silently skipped**. Ops must apply those two by hand (both are simple CREATE TABLE)
or adjust the `__drizzle_migrations` ledger before the next deploy — in addition to
the pre-existing requirement to run the `CREATE INDEX CONCURRENTLY` preps from
`1785105737`/`1785190561` before the migrator. Fresh databases are unaffected.

### Stage 3 — Credential keystone (single senior-owned PR)

Resolve hazard 4. Land with it: temperature clamping, client-abort handling,
`upstream-dispatcher`, JSON healing, keepalive and TTFT fixes. Gate on the Stage-0
invariant suite plus scoped `TEST_MODELS` e2e across all five credential classes
(env-keyed, platform-credential, BYOK, regional, Vertex).

### Stage 4 — API + UI + docs

Master API for custom providers (tenant-scoped; distinct from our operator-scoped
platform providers), compliance restrictions, IAM member rules, Discord notifications,
refund reason; UI redesign, Lounge/points, census survey, `/start` page. Apply rename
sweep. Modify/delete conflicts: keep our deletions (trimmed workflows, self-host docs,
llmgateway blog posts); accept upstream's deletion of `coding-agents.mdx`.
Decide whether tenant custom providers (`custom/<name>/<model>`) are exempt from
`enforceCatalogRequest`, and ensure the `custom/` namespace cannot collide with
catalog provider ids.

**Decision (2026-07-30, product owner):** keep betarouter naming — do NOT adopt the
"Lounge" product name. Take the Lounge _feature_ code (points, voice UI) but keep our
existing product naming for the chat app. The betarouter brand name is always
lowercase ("betarouter", never "BetaRouter"/"Betarouter") in user-facing copy; the
BetaPass product name keeps its own casing.

### Stage 4a outcome — apps/api merged (2026-07-30)

All 41 `apps/api` commits in `57ad9fc04..upstream/main` are merged. `ee/audit` was
untouched by the range. Notes carried forward to the UI stage (4b):

- **Custom-provider catalogue exemption (decided + implemented).** Tenant custom
  providers are org-owned BYOK inventory, so `enforceCatalogRequest` returns `null`
  for the reserved `custom` namespace and `filterProviderMappingsByCatalog` passes
  their synthetic mappings through. `chat.ts` now forwards `"custom"` as the
  providerId instead of `undefined` so the exemption can fire — without this every
  custom-provider request would 404 once `CATALOG_ROUTING_ENABLED` flips on.
- **Namespace collision closed from both directions.** `platform-providers.ts`
  already rejected `provider: "custom"`; `platform-catalog.ts` now rejects change-set
  operations targeting the `custom` provider id or its mappings, and
  `assertCustomProviderNameAvailable` rejects tenant provider names that collide with
  any catalogue provider id (such a provider would be created permanently unroutable,
  since `parseModelInput` resolves `<name>/<model>` against the catalogue first).
- **Reconciliations.** `gateway/src/lib/iam.ts` and `packages/models` compliance
  helpers were already fully merged by Stages 1/3 — only the missing endpoint specs
  were added. `keys-provider.ts` kept the Stage-1 crypto-random pick and gained
  upstream's `CUSTOM_PROVIDER_NAME_REGEX` / `ProviderKeyComplianceAttestation`.
- **packages/shared partially merged**: `custom-providers.ts`, `refunds.ts`, `csv.ts`
  and their index exports only. `RUNWARE_PROMO` and the React components
  (refund-reason fieldset, provider icons, `use-countdown`) are left for Stage 4b.
- **Naming**: `Lounge` survives only as internal identifiers, route paths and level
  titles. All user-facing copy the API emits (transaction descriptions, OpenAPI
  descriptions, error messages) stays "Chat Plan"/"BetaPass". Stage 4b must not
  reintroduce "Lounge" as a rendered product name.
- **Deferred to Stage 5**: nothing from `apps/api` — the range adds no realtime
  session or client-secret route. Playground realtime _history_ endpoints are
  included (their tables landed in Stage 2) but are inert while the gateway
  `/v1/realtime` surface stays dark.

### Stage 4b outcome — frontends + docs merged (2026-07-30)

All `apps/ui`, `apps/playground`, `apps/code`, `apps/docs`, `ee/admin` and the
remaining `packages/shared` changes in `57ad9fc04..upstream/main` are merged
(427 upstream file changes: 62 taken verbatim, 232 three-way merged, 130 new,
1 deletion accepted). Commits: `2dab76ea9` (shared), `2312ff145` (ui),
`4b9aa14db` (playground), `c98dad79a` (code + ee/admin), `8b5754bad` (docs),
plus `build: ship pcm-recorder worklet past js ignores`.

**Landed.** Product-page redesign (`/products/ai-gateway`, `/products/playground`,
`/products/devpass`, `/products/observability`) + `product-sections.tsx`; nav and
footer redesign; motion polish; member-level IAM rules editor; custom-provider
rename dialog, `useCustomProviders`, compliance-attestation card; API-origin in
log metadata (`API_ORIGIN_LABELS`); provider/model discount and TTFT
display fixes (`provider-stats.ts` + spec); `deactivation.ts` model-hiding;
`SelectableProviderOption` refactor of `MultiProviderSelector`; `RUNWARE_PROMO`,
refund-reason fieldset, `use-countdown`, provider icons. Playground: shared
`StudioNav`, points pill / leaderboard / profile, unified media sidebars,
`call-history`, `realtime-audio`, pcm-recorder worklet. Code: `/start` landing
page, quarterly model census (survey form, reminder dialog, public
`/data/[year]` registry), agent time ranges + CSV export. Admin: gift reset
passes, project chart source breakdown, manage-org rename. Docs: API-key
rotation/renaming, GitHub Copilot guide, Cursor agent-mode correction, Gemini
2.5 migration, `developers/` AI SDK section, `features/timeouts.mdx`,
`learn/playground-audio.mdx`, product-grouped learn index.

**Naming reverts applied** (no "Lounge" as a rendered product name):

- `apps/ui/src/app/products/lounge` → `products/playground`; sitemap, navbar and
  footer links follow. Copy rewritten to Playground/plan wording.
- `apps/playground/src/lib/brand.ts` rewritten to the betarouter Playground
  identity; `brand.spec.ts` asserts it. `manifest.ts` and `layout.tsx` consume
  `BRAND`.
- Sidebar/auth lockups keep OUR `Logo` + `Wordmark` + `Chat` badge instead of
  upstream's bundled `Wordmark size="sm" iconBox`; `wordmark.tsx` is ours
  (add/add). Upstream's Fraunces/Geist font swap rejected (our Bricolage
  `--font-display` drives the wordmark); `--lounge-gold` adopted as a bare CSS
  variable alongside our `--sidebar-ring`.
- "membership" → "plan" across pricing, billing-history, upsell and profile
  copy. `Lounge` survives only as identifiers (`useLoungePoints`,
  `SidebarLoungePoints`, `/lounge/points/me`, `--lounge-gold`, file paths).
- `DevPass` → `BetaPass` in every rendered string in `apps/code` and
  `apps/docs`; component/route identifiers (`GetDevPassButton`,
  `DevPassInvoices`, `/products/devpass`, `devpass-code`) unchanged. The sweep
  was never run repo-wide with `--include-devpass`.

**Skipped (deliberate).**

- All new `apps/ui` blog posts (openrouter-alternatives cluster, performance
  benchmark, generate-*-api set) and their images; all new changelog entries and
  images — LLMGateway-authored marketing, we maintain our own.
- Upstream edits to blog posts / self-host docs / `guides/cli.mdx` we had
  deleted: those files stay deleted (9 modify/delete cases, all resolved "keep
  our deletion").
- The `self-host` entry upstream re-added to `apps/docs/content/meta.json`
  (that docs section is deleted in our tree), and the dead
  `self-hosted-or-cloud` feature icon in the features OG image.
- `apps/ui/src/app/open-source` and its sitemap entry; the "Self-Hosted"
  enterprise pricing tier; the "Cloud or self-hosted" ai-gateway product feature
  (replaced with a compliance-controls entry) and the self-host line in the
  ai-gateway closing CTA.
- Upstream's "no team or company use" DevPass policy in
  `apps/code/src/app/legal/terms/page.tsx` and `Faq.tsx` — our fork offers team
  plans, so our copy is kept.
- `apps/playground/e2e/lounge-rebrand.pw.ts` (asserts the Lounge identity).
  `lounge-nav-gamification.pw.ts` and `apps/code/e2e/census.pw.ts` are kept.

**Deferred to Stage 5.**

- Playground realtime voice UI ships **dark**: `REALTIME_ENABLED` in
  `studio-nav.tsx` reads `NEXT_PUBLIC_REALTIME_ENABLED` (default off), hides the
  Voice studio tile, and `/realtime` `notFound()`s. The components
  (`realtime-page-client`, `realtime-sidebar`, `use-realtime-call`,
  `realtime-audio`, `call-history-list`, `voice-activity-indicator`,
  `/api/realtime/session`) compile and are committed, but the gateway
  `/v1/realtime` WebSocket surface does not exist yet. Flip the env var when
  Stage 5 lands.
- Docs for surfaces that do not exist in this tree were **not imported**:
  `features/realtime.mdx`, `features/rerank.mdx`, `features/transcription.mdx`,
  `learn/playground-realtime.mdx` (+ its 4 screenshots). Cross-links from
  `learn/index.mdx`, `learn/meta.json`, `features/embeddings.mdx` and
  `developers/ai-sdk-images.mdx` were pruned accordingly — restore all of these
  in Stage 5.

**Merge hazards hit.** `git merge-file` duplicated whole JSX blocks in the
opengraph-image files (both sides had applied the prettier 3.9.6 JSX-paren
reformat). Those 13 files were re-derived from upstream and re-branded
programmatically (`viewBox="0 0 218 232"` logo → our chevron mark,
`LLMGatewayIcon` → `BrandIcon`) rather than hand-merged. Separately, taking
"ours" for the sidebar wordmark hunks dropped upstream's now-unused `Logo`/
`Badge` imports; `next build` did **not** catch it (no typecheck), only
`eslint`'s `jsx-no-undef` did — run per-app `pnpm exec eslint src` after any
future ours/theirs hunk mixing.

**Needs human visual QA.** The four new product pages; the redesigned navbar
products dropdown and footer; the playground StudioNav tile grid at collapsed
and mobile widths; the points pill / leaderboard / profile pages (gold accent
against our green sidebar ring); the 13 regenerated OG cards (logo placement was
scripted, not eyeballed); the `/start` page and `/data/[year]` census registry.

### Stage 5 — Realtime + rerank + transcriptions (landed dark) — DONE

Land code with `/v1/realtime` disabled by default (upstream had a revert/re-land cycle;
index fix `d95d3b8ae` is unreleased). Before enabling: add `redis-storage` service to
`infra/docker-compose.betarouter.yml` + `unified.dockerfile` + `supervisord.conf`;
populate the 15 `REALTIME_*` vars, `STORAGE_REDIS_*`, `RESPONSES_STORAGE_DRIVER`,
`GATEWAY_CORS_ORIGINS` (CORS now defaults **closed** — deploy checklist item),
`UPSTREAM_KEEPALIVE_TIMEOUT_MS`; extend catalog enforcement to all three new surfaces.
Enable per-org, then globally.

### Stage 5 outcome — realtime + rerank + transcriptions landed dark (2026-07-30)

Commits: `d6bc62f1a` (surfaces), `cbcddd3b4` (audio-hour catalog pricing),
`64e4aa80d` (infra + deploy docs), `75876ab88` (docs pages).

**Landed.** `apps/gateway/src/realtime/**` (17 files), `rerank/**`,
`transcriptions/**`, their `app.ts`/`serve.ts` registrations (realtime attach +
explicit WebSocket drain), `middleware/cors.ts` (+ spec),
`packages/cache/src/storage-redis.ts` with the `storageRedisClient` export, the
dual-Redis gateway health check, `closeStorageRedisClient()` in the worker, and
the storage-Redis quit in `packages/db/src/seed.ts`. `cache.ts` now stores the
gateway response cache on the storage instance. `chat-helpers.e2e.ts` gained
`rerankModels` / `transcriptionModels` and the matching `filteredModels`
exclusions; `rerank.e2e.ts` and `transcriptions.e2e.ts` came with them.
`ws` + `@types/ws` added to `apps/gateway`. `d4c497783` needed no cherry-pick:
`upstream/main`'s `preflight.ts` already contains the tenant-derived
`deriveSafetyIdentifier`.

Not taken (out of Stage 5 scope, deliberate): upstream's
`@hono/node-server` v2 bump, the `swr.ts` in-flight coalescing / detached
mirror-write perf work, `redis.ts` `enableAutoPipelining`, and
`responses/tools/response-storage.ts` (a responses-module extraction). Because
that last one is absent, `RESPONSES_STORAGE_DRIVER` is documented as reserved
and inert.

**Gating defaults.** Realtime is DARK, and upstream's own gating already
defaults off, so no default was flipped: `isRealtimeEnabled()` requires
`REALTIME_INLINE=true` (or an explicit `REALTIME_ENABLED`), `REALTIME_DISABLED`
is an overriding kill switch, and `serve.ts` only attaches the WebSocket
listener under `REALTIME_INLINE`. The compose file pins
`REALTIME_INLINE=false` + `REALTIME_DISABLED=true`. Frontend
`NEXT_PUBLIC_REALTIME_ENABLED` was not touched (still default-off from 4b).
`/v1/rerank` and `/v1/audio/transcriptions` ship ENABLED: they are catalog-
governed on exactly the same terms as the other non-chat surfaces
(`operation: "deferred_non_chat"`), so a separate flag would have been a
different, weaker control than the catalogue.

**Hazard 2 closed — how each surface is hooked.**

- _rerank_: `findRerankMapping` now only resolves the requested model id; the
  mapping that is served and priced comes from `enforceCatalogRequest` +
  `filterProviderMappingsByCatalog` over the `rerank: true` mappings of the
  model definition. `503` when the catalogue admits none. `inputPrice` /
  `requestPrice` are therefore the catalogue's customer prices. The log row
  carries `modelProviderMappingId` + `catalogRevisionId`.
- _transcriptions_: identical shape over `transcriptions: true` mappings.
- _realtime_: new `admitRealtimeMapping()` in `realtime/catalog.ts` runs
  admission and returns the catalog-adjusted `RealtimeMappingMatch`. Preflight
  applies it to the session model (fails closed with a `503`
  `model_unavailable` `RealtimeConnectError`) and to every candidate from
  `listRealtimeTranscriptionMappings`, storing the results in a new
  `allowedTranscriptionMatches` map. `session.ts` and `server.ts` now bill
  against that map instead of re-resolving the static mapping, so
  `buildRealtimePriceSnapshot` / `buildTranscriptionPriceSnapshot` see
  catalogue prices. A catalogue rejection of an ASR candidate only drops that
  candidate; it does not fail the connection.
- All three also thread `requiredCredentialId` / `requiredCredentialProfile`
  from the admitted mapping plus the org env variant into the now-`await`ed
  `getProviderEnv`, and honour `envResult.baseUrl` — i.e. they use the Stage 3
  credential precedence (platform credential → variant env → plain env)
  instead of upstream's plain-env-only call.

**Pricing gap found and closed.** `/v1/audio/transcriptions` bills on
`mapping.inputAudioHourPrice`, a unit the catalogue did not model, so admission
alone would still have billed source cost under a markup/fixed policy.
`audioHour` is now a first-class `PriceUnit`: new
`model_provider_mapping.input_audio_hour_price` column (migration
`1785386011_colorful_sharon_carter`, `IF NOT EXISTS`-guarded, timestamp above
the ledger high-water mark so drizzle applies it normally),
`sourceMappingPricesToPriceMap`, `fixedPricesV1ToPriceMap` + its contract
schema, worker model sync, and `applyCatalogCustomerPrices` (flat USD, like
`requestPrice`/`ocrPagePrice` — never `/1e6`). Side benefit: because
`resolveMappingPrice` now sees the unit, a fixed policy that omits `audioHour`
makes the mapping not-ready rather than under-billing. **Remaining**: the admin
catalogue UI has no input for the `audioHour` fixed price yet, so a fixed
policy for the xAI STT mapping must be set through the API.

**Invariant suite — final state (no allowlisting).**

- Discovery is now MODULE-level, not per-file. `realtime/` bills in
  `billing.ts`/`preflight.ts` but routes only in `client-secrets-route.ts`, so
  the old per-file conjunction silently missed it — the exact failure mode the
  suite exists to prevent.
- `BILLED_PATH_SIGNALS` gained `.insert(log)` (realtime writes log rows
  directly, bypassing `insertLog`).
- `ROUTE_REGISTRATION_SIGNALS` narrowed to `createRoute(`, `new OpenAPIHono`,
  `.openapi(` — module-level discovery made bare `.get(`/`.post(` match `lib/`
  (Maps, Redis clients).
- `EXPECTED_BILLED_GATEWAY_MODULES` (pinned, 10): `chat`, `embeddings`,
  `images`, `moderations`, `ocr`, `realtime`, `rerank`, `speech`,
  `transcriptions`, `videos`. `CATALOG_ADMISSION_ALLOWLIST` unchanged (only
  `images`, which delegates to `/v1/chat/completions`).
- `EXPECTED_CALCULATE_COSTS_CENSUS` **unchanged** at
  `{ "apps/gateway/src/chat/chat.ts": 11 }`. The new surfaces do not call
  `calculateCosts` at all — they price inline from the mapping's price fields.
- New **invariant 4** covers exactly that blind spot: `embeddings`, `ocr`,
  `realtime`, `rerank`, `speech`, `transcriptions`, `videos` must each
  reference `filterProviderMappingsByCatalog(`, which is their equivalent of
  `pricingOverride`. 17 tests, all green.

**Infra.** `redis-storage` runs as a second in-container Redis (supervisord
program, port 6380, AOF on `/var/lib/redis-storage`), so the container
healthcheck — which requires every supervisord program to be `RUNNING` — now
depends on it, as does the gateway `/` endpoint (it pings both instances).
`unified.dockerfile` creates the data dir and exposes 6380;
`docker-compose.betarouter.yml` mounts a `redis_storage_data` volume and sets
`STORAGE_REDIS_HOST/PORT`, `GATEWAY_CORS_ORIGINS`, and the realtime switches;
the root `docker-compose.yml` gained upstream's dev `redis-storage` service.
Low-memory/serialized-build customizations untouched.

**Ops checklist before enablement** (full version in
`infra/DEPLOYMENT_BETAROUTER.md`):

1. Set `GATEWAY_CORS_ORIGINS` **before** deploying if any browser client calls
   `api.betarouter.com` directly — CORS now defaults closed and the breakage is
   silent. Server-to-server clients are unaffected.
2. Confirm `redis-storage` is `RUNNING` and gateway health is green; add
   `redis_storage_data` to the backup set.
3. Apply migration `1785386011`; the two upstream migrations from the Stage 2
   ops note still need their manual treatment.
4. Set `REALTIME_MAX_SESSION_SPEND_USD` and the per-org/per-key lease caps —
   realtime bills continuously and is not covered by request-level usage
   limits. Ensure `REALTIME_SHUTDOWN_GRACE_PERIOD_MS` ≤ the compose
   `stop_grace_period` (2m today).
5. Pilot: `REALTIME_INLINE=true` + drop `REALTIME_DISABLED`, and scope access
   with catalogue visibility / per-key IAM (there is no per-org realtime flag).
   Watch `realtime_session` rows and their linked `log` rows;
   `unpriceable_usage:*` / `unbillable_transcription` close reasons mean the
   gateway refused to deliver unbilled work — fix the mapping's prices, do not
   raise limits. Roll back with `REALTIME_DISABLED=true`.
6. Global: widen catalogue/IAM, then build `apps/playground` with
   `NEXT_PUBLIC_REALTIME_ENABLED=true`.
7. Add the `audioHour` fixed-price field to the admin catalogue UI before
   moving the xAI STT mapping to a fixed pricing policy.

**Verification.** `turbo run build --filter=gateway --filter=api
--filter=worker --filter=docs` green (14 tasks). `vitest run
--no-file-parallelism apps/gateway/src apps/worker packages/cache packages/db`:
**110 files, 1987 passed, 2 skipped, 0 failed** — including all 69 upstream
realtime specs and the 17 catalog invariants. `scripts/check-brand.sh` PASSED.
`pnpm format` clean (only pre-existing `ui`/`playground` warnings). Both local
databases (`db` and `test`) needed `pnpm --filter db push` for the new column
before the worker `sync-models` specs passed. No realtime spec needed a live
redis-storage instance; only `postgres` + `redis` were running locally.

**Deferred.** Scoped `TEST_MODELS` e2e for the new mappings
(`xai/grok-stt-1.0`, the alibaba rerank mappings, the OpenAI realtime mappings)
was not run — it needs live provider credentials. Realtime has no `.e2e.ts` at
all upstream.

### Stage 6 — Verification

`pnpm build`, `pnpm test:unit`, scoped `pnpm test:e2e` per changed mapping,
`pnpm format`, grep gates green (zero stray `@llmgateway`, `pricingOverride` at 100% of
`calculateCosts` sites, `enforceCatalogRequest` at 100% of billed entry points).
Reconcile catalog policy rows against upstream's 19 mapping deactivations on a real DB;
re-tune catalog health thresholds for the new TTFT semantics.

### Stage 6 outcome — verification green (2026-07-30)

Final verification at `dc5317db0` (103 commits over the base `360e400`):
`pnpm lint` 18/18 (2 pre-existing warnings), full `pnpm build` 18/18,
`pnpm test:unit` 223 files / 3472 tests passed (1 file + 3 tests skipped),
`scripts/check-brand.sh` green, catalog-invariant suite 17/17. Grep gates:
all 11 `calculateCosts` call sites (all in `chat.ts`) pass `pricingOverride`;
`enforceCatalogRequest` present ≥2× in every billed module (chat, embeddings,
speech, moderations, ocr, videos, rerank, transcriptions, realtime); the only
`@llmgateway` references are the `ai-sdk-provider` package, the allowlisted
worker contract comment, and the brand tooling itself. One fix fell out of
verification: `dc5317db0` removed unsupported `size`/`iconBox` props on a
`Wordmark` call introduced by `4b9aa14db`.

**Still open (ops, not code):** scoped `TEST_MODELS` e2e for the new mappings
(needs live provider keys); catalog-policy reconciliation against upstream's
19 mapping deactivations on the production DB; migration-ledger backfill and
`CREATE INDEX CONCURRENTLY` preps at deploy time; the Stage 4b human visual QA
checklist; catalog health-threshold re-tune for the new TTFT semantics.

## Effort

~16–24 person-days total across 6 shippable increments. Stages 0–2 (4–6 pd) carry all
security value.
