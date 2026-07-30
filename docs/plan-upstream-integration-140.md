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
   missing one is in a *cleanly merged* region. Every upstream helper extraction in
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
5. **Dependency direction**: we are *ahead* of upstream on `better-auth` (1.6.25 vs
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
"Lounge" product name. Take the Lounge *feature* code (points, voice UI) but keep our
existing product naming for the chat app. The betarouter brand name is always
lowercase ("betarouter", never "BetaRouter"/"Betarouter") in user-facing copy; the
BetaPass product name keeps its own casing.

### Stage 5 — Realtime + rerank + transcriptions (landed dark)

Land code with `/v1/realtime` disabled by default (upstream had a revert/re-land cycle;
index fix `d95d3b8ae` is unreleased). Before enabling: add `redis-storage` service to
`infra/docker-compose.betarouter.yml` + `unified.dockerfile` + `supervisord.conf`;
populate the 15 `REALTIME_*` vars, `STORAGE_REDIS_*`, `RESPONSES_STORAGE_DRIVER`,
`GATEWAY_CORS_ORIGINS` (CORS now defaults **closed** — deploy checklist item),
`UPSTREAM_KEEPALIVE_TIMEOUT_MS`; extend catalog enforcement to all three new surfaces.
Enable per-org, then globally.

### Stage 6 — Verification

`pnpm build`, `pnpm test:unit`, scoped `pnpm test:e2e` per changed mapping,
`pnpm format`, grep gates green (zero stray `@llmgateway`, `pricingOverride` at 100% of
`calculateCosts` sites, `enforceCatalogRequest` at 100% of billed entry points).
Reconcile catalog policy rows against upstream's 19 mapping deactivations on a real DB;
re-tune catalog health thresholds for the new TTFT semantics.

## Effort

~16–24 person-days total across 6 shippable increments. Stages 0–2 (4–6 pd) carry all
security value.
