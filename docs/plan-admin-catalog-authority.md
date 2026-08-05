# Plan: Admin Catalog Authority

Status: Design agreed 2026-08-05 — approved for phased implementation
Date: 2026-08-05
Owner: BetaRouter platform operator
Scope: Make the Admin console the authority for creating and editing
providers, models, and mappings — including base prices and capabilities —
without code changes or deploys, while `packages/models` remains the import
source. This authority covers EVERY serving modality on the platform (chat,
embeddings, images, videos, speech, transcriptions, OCR, rerank,
moderations, realtime, MCP); chat goes first only as sequencing, and the
program is not complete until all modalities resolve through the catalog. Supersedes the earlier same-day draft proposal ("Admin Catalog
Authority: Moving Provider, Model, and Pricing Control Into Admin"), whose
findings were verified against the codebase and production; this document
records the corrected facts and the agreed design.

Relates to: `docs/spec-admin-model-catalog.md` (launch spec this extends),
`docs/future-build-plan-admin-model-catalog.md` (subsumes the relay-adapter
and diff-suggestion backlog items), `docs/plan-catalog-enforcement-rollout.md`
(the flag ladder, now largely complete — see baseline below).

---

## Verified production baseline (2026-08-05)

The prior draft treated enforcement as an unverified precondition. It has
since been verified directly (env file, container env, and live gateway
process all agree; external probes confirm):

| Item                                 | State                                              |
| ------------------------------------ | -------------------------------------------------- |
| `PLATFORM_CATALOG_SHADOW_READ`       | `true`                                             |
| `PLATFORM_CATALOG_DISCOVERY_ENABLED` | `true`                                             |
| `PLATFORM_CATALOG_ROUTING_ENABLED`   | `true` — catalog policy and pricing are live       |
| `PLATFORM_CATALOG_BREAKER_MODE`      | `observe` — stage 6b (enforce) not yet flipped     |
| Catalog revision                     | 175; `/v1/models` and `/internal/models` ETags agree |
| Curated set                          | `["gpt-5.5"]` visible — intentional minimal storefront |

Consequences: the rollout-precondition phase of the draft is complete and is
dropped from this plan. Flipping the breaker to `enforce` remains an
operational (host-side) task, orthogonal to this work.

Catalog size at the commit this plan was written: 48 providers, 340 models,
589 authored mappings, expanding to 735 database rows after region expansion
(503 active). The draft's "664 mappings" was a launch-era snapshot.

## Problem statement (unchanged from the draft)

The launch Admin Model Catalog gave the operator authority over catalog
policy (visibility, enablement, lifecycle, customer pricing, routing
priority, circuit breaking) but not over the catalog source (which
providers, models, and mappings exist; their base capabilities and upstream
prices). Operator overrides can only narrow. Every source change — a new
provider, a corrected upstream price, a capability that should be on —
requires a pull request and a deploy.

## Key facts established during verification

These correct or sharpen the draft and shape the design below.

1. **Customer pricing authority already works in production.** The three
   price-policy modes (`source_cost`, `markup`, `fixed`) are enforced on
   billed chat requests today. The `fixedPricesV1Schema`
   (`packages/catalog/src/contracts.ts:11`) lacks independent fields for
   `cacheRead`, `cachedImageInput`, `cachedAudioInput`, and `audioInput`,
   but `fixedPricesV1ToPriceMap` (`packages/catalog/src/pricing.ts:180`)
   aliases them from `input`/`cachedInput`, so they are priceable — just not
   independently.
2. **Catalog enforcement is chat-only.** `isCatalogOperationEnabled`
   (`apps/gateway/src/lib/catalog-policy.ts:40`) returns true only for
   `"chat"`; embeddings, images, videos, speech, transcriptions, OCR,
   rerank, moderations, realtime, and MCP pass `"deferred_non_chat"` and
   bypass the catalog entirely, resolving models from the static array.
3. **The effective catalog is an overlay, not a catalog.** `EffectiveModel`
   and `EffectiveMapping` (`packages/catalog/src/catalog.ts`) carry the
   policy overlay plus source prices — no names, capabilities, or context
   sizes. Every catalog mapping must resolve back to a static mapping
   (`findProviderMappingForCatalogMapping`,
   `apps/gateway/src/lib/catalog-policy.ts:280`) or it is dropped from
   routing. Database-only entities are unreachable by construction.
4. **The provider-branch census is ~10x the draft's estimate.** Roughly 19
   provider-keyed switch statements plus a dozen if-chain clusters across
   ~25 files — including the ~2,200-line request-body switch in
   `packages/actions/src/prepare-request-body.ts` — not three. However,
   their `default` branches already implement the unnamed OpenAI-compatible
   protocol, so a new OpenAI-compatible provider needs none of them changed.
   What actually blocks a runtime-created provider is provider *existence*:
   - `parse-model-input.ts` treats unknown provider prefixes as tenant
     custom providers, never platform providers;
   - `ProviderId` is a static type union derived from the code array;
   - the platform credential API rejects providers absent from the static
     array (`assertSupportedProvider`,
     `apps/api/src/routes/platform-providers.ts:115`);
   - base-URL resolution throws for providers absent from
     `PROVIDER_DEFAULT_BASE_URLS`
     (`packages/actions/src/get-provider-endpoint.ts`).
5. **The sync is a dumb mirror, and that is worth keeping.**
   `syncProvidersAndModels()` (`apps/worker/src/services/sync-models.ts`)
   fully overwrites mapping rows on every worker start (explicit NULLs for
   absent fields, `status` forced to `active`). Operator state survives only
   because it lives in the separate `platform_*` policy tables the sync
   never writes.
6. **Reusable machinery is extensive.** Change-set preview/apply/rollback
   with immutable revisions and inverse operations, the encrypted platform
   credential store with fingerprint-bound mapping tests, admission gates
   (`mapping_policy_missing`, `provider_credential_unavailable`,
   `mapping_price_incomplete`, `mapping_test_required` —
   `packages/catalog/src/catalog.ts:310-323`), breaker state with audited
   reset, and the Admin catalog client
   (`ee/admin/src/app/catalog/catalog-client.tsx`) all exist and carry over
   unchanged.

## Core design decisions

### 1. Override overlay, not mutable source rows

The draft proposed making the mirrored source rows operator-editable and
rewriting the sync to file "proposals" for diverged rows. That design has a
structural flaw: once an operator edits a row, it differs from code forever,
and the sync cannot distinguish "operator changed this" from "upstream
changed this" without keeping a third copy (the value at last import) for
three-way comparison — otherwise every deploy re-proposes reverting the
operator's own edit.

Agreed design instead: **source rows stay a pure mirror of code and the sync
is not modified.** Operator edits to code-originated entries live in a
versioned partial-override patch (`sourceOverrides`, jsonb, zod-validated)
on the existing `platform_provider_policy`, `platform_model_policy`, and
`platform_mapping_policy` tables. The effective value of any source field is
the override when set, otherwise the mirrored value. Composition order in
`resolveEffectiveCatalog`:

```
code mirror row → sourceOverrides patch → existing policy overlay
  (visibility/enablement/limits/lifecycle) → price policy → breaker
```

Properties this preserves for free:

- The sync's tested overwrite behavior is untouched.
- Upstream changes remain visible by definition: a deploy updates the base
  row while the override persists, so "the upstream value moved underneath
  your override" is directly detectable with no baseline bookkeeping.
- Change-set preview/apply/rollback and audit already operate on
  policy-shaped state; overrides slot in with trivial inverse operations.
- Clearing an override instantly reverts to upstream truth.

This removes the narrowing-only constraint: an override can raise a limit,
turn a capability on, or correct a source price (which then feeds margin
computation and `source_cost`/`markup` pricing).

### 2. `source: 'static' | 'admin'` for created entities only

Admin-created providers, models, and mappings are new rows in the same three
source tables, tagged `source: 'admin'`. The sync's writes are scoped to
`source = 'static'` rows (a one-line guard per entity, not a behavior
change). The override overlay applies only to `static` rows; `admin` rows
are edited directly since no code counterpart exists.

### 3. Declared protocol plus existence unblocking

Add `protocol` to `ProviderDefinition` and the `provider` table:

```
protocol: "openai-chat" | "anthropic-messages" | "google-generative" | ...
```

Scope discipline, corrected from the draft: the goal is not to refactor all
~19 provider switches. Named providers (anthropic, google, bedrock, etc.)
exist in code and may keep provider-id branches indefinitely. The work is:

- convert the three transport-selection switches (endpoint path, auth
  headers, streaming transform) to protocol lookup so the OpenAI-compatible
  default becomes a named, declared protocol;
- remove the four existence blockers listed in fact 4 above, so a provider
  that exists only in the database can be parsed, credentialed, base-URLed
  (from its provider row / credential), and routed through the
  `openai-chat` protocol path;
- adopt a typing strategy at the routing boundary: transport helpers accept
  `{ providerId: string; protocol: Protocol }` and branch on protocol first,
  with static-union narrowing only inside named-provider special cases.

New wire protocols remain code changes. A new provider on an existing
protocol becomes data. Note the existing mapping-level
`apiFormat: "openai-chat-completions"` field as precedent.

### 4. No hard deletion — unchanged from the launch spec

Four tables cascade off `model_provider_mapping.id` (policy, price policy,
test runs, health/breaker summary); `log` and `video_job` reference mappings
and revisions with `set null`. An Admin "Delete" control is acceptable only
wired to retire (`deactivatedAt` / lifecycle `retired` /
`entity.archive_policy`), exactly as the launch spec defines.

### 5. Relay providers are a first-class use case

Third-party relays (OpenAI-compatible resellers or hosted gateway
instances) are ordinary providers under this design: `protocol:
"openai-chat"`, a base URL, a platform credential, and mappings attached to
existing root models (never duplicate model entries). Multi-provider
mappings per model are the normal case; the only uniqueness rule is one
mapping per `(providerId, region)` per model. Invisible-but-routable
providers are supported (the launch canary pattern), so a relay can serve
traffic without appearing in discovery — noting that per-request logs still
record the serving provider. Compliance gates fail closed on null
`dataPolicy`, so an unattested relay is automatically excluded from
compliance-gated organizations. Known residual risk: the mapping test is a
minimal-chat probe and cannot detect a relay silently substituting models;
a periodic quality canary is future work.

## What stays in code

1. **Protocol adapters** — request/response transformation logic.
2. **Compliance attestations** (`dataPolicy`, `headquarters`) — excluded
   from `sourceOverrides` while the console has a single operator role;
   revisit only with a second-approver mechanism.
3. **Gateway routing and error-classification logic**, including the
   deliberately conservative rules in
   `apps/gateway/src/chat/tools/get-finish-reason-from-error.ts`.

## Implementation phases

Each phase is independently shippable. Do not bundle Phase 3 with anything.

### Phase 1 — Protocol declaration and provider existence

Add `protocol` to provider definitions (all existing providers annotated);
convert the three transport switches to protocol lookup; remove the four
existence blockers. `PROVIDER_DEFAULT_BASE_URLS` stays keyed on provider id
for code providers; database providers carry their own base URL.

Exit gate: `pnpm test:unit` and `pnpm build` green; spot-check e2e per
protocol byte-identical; the `"Unknown provider using OpenAI fallback"`
streaming warning unreachable for declared providers.

### Phase 2 — Mirror completion and self-describing snapshot

Additive migration (via `pnpm migrations`, never hand-written):

- `model_provider_mapping`: `pricingTiers`, `serviceTierMultipliers`,
  `supportedToolChoices`, `reasoningEfforts` (all jsonb).
- `provider`: `protocol`, `priority`, `contentFilter`, `maxTemperature`,
  `headquarters`, `dataPolicy`, `serviceTiers`, `regionConfig`, `termsUrl`,
  `privacyPolicyUrl`, `statusPageUrl`, `apiKeyInstructions`,
  `modelCardBadge`, `additionalLinks`, plus `source` on all three tables
  (default `'static'`). Provider `env` config is deliberately NOT mirrored:
  platform credential resolution is database-first already, and admin
  providers never have env keys.

Extend `EffectiveModel`/`EffectiveMapping` and
`storedCatalogSnapshotSchema` to carry full base data (model `name`,
`family`, `aliases`, `output`, `free`; mapping `contextSize`, `maxOutput`,
positive capability flags, `supportedParameters`, `pricingTiers`,
`serviceTierMultipliers`, and the full source price set), populated from the
completed mirror. Nothing reads the new fields yet.

Checksum implication: adding snapshot fields changes every checksum
(`calculateCatalogChecksum` covers snapshot content). Plan one revision
bump; confirm `/v1/models` and `/internal/models` agree on the new ETag.

Exit gate: snapshot round-trips `parseStoredCatalogSnapshot`; an
equivalence test asserts every code-defined field has a matching database
value after one sync — this is the safety net for Phase 3.

### Phase 3 — Chat read-path inversion (the consequential change)

Introduce `resolveModelFromCatalog(modelId, snapshot)` returning the shape
today's consumers get from the static array. Migrate the chat hot path:
`parse-model-input.ts` first (it 400s from the static array before the
catalog is consulted), then `resolve-model-info.ts`, `chat.ts`, `costs.ts`,
`iam.ts`, `prepare-request-body.ts`, `get-provider-endpoint.ts`, and the
`/v1/models` listing. The full static-array census is 21+ runtime files in
gateway/actions plus API-server and worker call sites; everything outside
the chat path is explicitly tracked as the Phase 7 tail and keeps static
resolution until its surface migrates.

Rollout: resolve both ways under `PLATFORM_CATALOG_SHADOW_READ`, log any
divergence (model id, provider id, field), and require a clean soak covering
at least two worker syncs, one cache refresh, and one restart. Any pricing
divergence, by any amount, is an immediate abort — the same rule the Stage 5
billing proof used.

Exit gate: zero divergence over the soak; billing assertions on a canary
model match exactly.

### Phase 4 — Edit and create operations

1. `sourceOverrides` patch column + composition in `resolveEffectiveCatalog`
   (decision 1), exposed through new change-set operations
   `provider.set_source_override`, `model.set_source_override`,
   `mapping.set_source_override` (and `*.clear_source_override`).
2. `source: 'admin'` creation path: `provider.create`, `model.create`,
   `mapping.create` operations; sync writes scoped to `static` rows.
3. Contract-layer invariants rejected before preview: duplicate
   `(providerId, region)` per model (the table's unique constraint is the
   backstop, but note NULL regions are distinct in Postgres — the contract
   must catch region-NULL duplicates itself); reserved namespaces
   (`custom`, tenant prefixes) refused; compliance fields excluded from
   overrides.
4. Admission gates unchanged and non-negotiable: a new mapping is
   unroutable until policy exists, price policy is complete, a valid
   platform credential is available, and a fingerprint-bound mapping test
   passed.
5. `fixedPricesV2Schema`: independent `cacheRead`, `cachedImageInput`,
   `cachedAudioInput`, `audioInput` fields; version bump; v1 stays readable
   with its aliasing behavior.

Exit gate: the relay scenario end to end — create an OpenAI-compatible
provider, attach a credential, create mappings on existing models, pass the
mapping test, set a fixed price policy, enable (hidden or visible), and
serve a correctly billed request — with no code change and no deploy.

### Phase 5 — Upstream-change review

A post-sync report (worker job + Admin queue) listing every field where a
`sourceOverrides` entry exists AND the underlying mirrored value changed
since the override was set (detectable by comparing the override's recorded
base value at set-time, captured in the override payload, against the
current mirror). Operator resolves each by keeping or clearing the
override. New upstream entities and code-side retirements surface in the
same queue as informational entries. No proposal machinery, no three-way
merge — the overlay makes this a diff report.

### Phase 6 — Admin interface

Forms for provider/model/mapping create; a three-value editor (source /
override / effective) per field for edits; the Phase 5 review queue; a
"Delete" control wired to retire. Additive to
`ee/admin/src/app/catalog/catalog-client.tsx`.

### Phase 7 — Modality expansion to full coverage (committed scope)

This phase is required scope, not an optional tail: catalog authority must
cover every model on the platform, in every modality it serves.
Sequence after chat proves the machinery, roughly by traffic: embeddings →
images → videos → speech/transcriptions/OCR/rerank/moderations →
realtime/MCP. Per surface: (a) rewire model resolution to the shared
resolver; (b) open `isCatalogOperationEnabled` for that operation; (c)
verify modality pricing units flow through price policies (per-second video
pricing by resolution, audio-hour, OCR-page, character prices); (d) add a
test-console probe profile for the modality (only `minimal-chat` exists
today) or explicitly exempt the modality from the test gate with a recorded
reason; (e) scoped e2e. Videos are the largest item (async worker jobs,
duplicated provider switches in the worker). Each surface flips
independently behind the same shadow-compare billing gate, so blast radius
per flip is one modality.

## Risks

| Risk                                               | Mitigation                                                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Phase 3 changes billing inputs                     | Shadow-compare both resolution paths; any pricing divergence aborts                                 |
| Snapshot growth degrades request latency           | In-process `CatalogSnapshotCache` with bounded staleness; measure p99 before/after Phase 2          |
| Operator sets an unroutable combination            | Contract-layer invariants; fingerprint-bound mapping test must pass before routable                 |
| Override drifts silently from upstream             | Phase 5 review queue; overrides record their base value at set-time                                 |
| Snapshot unavailable at request time               | Existing fail-closed behavior unchanged (note: applies in shadow mode too — `CatalogUnavailableError` propagates) |
| Checksum churn from Phase 2                        | One planned revision bump, recorded in the audit ledger with cause                                  |
| Relay model substitution                           | Accepted residual risk; future quality canary                                                       |
| Admin-created entities lack e2e coverage           | Mapping test console is the gate; document as accepted for `admin` rows                             |

## Acceptance criteria

1. Operator creates an OpenAI-compatible provider (including a third-party
   relay), credential, model mappings, passes tests, sets pricing, enables,
   and serves a correctly billed request — no code change, no deploy.
2. Operator edits a mapping's base input price via a source override; the
   next request bills at the new price; clearing the override reverts to
   the upstream price; the prior state is recoverable from revision history.
3. Operator enables a capability previously off on a mapping whose
   deployment supports it (narrowing-only constraint removed).
4. An upstream price change under an override produces a review-queue entry
   and does not silently alter the effective price.
5. Retiring a model returns 410 with `replacementModelId`; historical `log`
   rows still resolve their mapping and billed cost.
6. No catalog row is ever hard-deleted by any Admin action.
7. Every serving modality resolves models and prices through the catalog —
   the program is not complete while any surface still bypasses it.

## Housekeeping

- Repo governance: once Phase 4 ships, update `CLAUDE.md`'s catalog rules
  (packages/models as sole catalogue, price-notation guidance) to describe
  the import-source role and the override workflow.
- Verification per phase: `pnpm format`, `pnpm lint`, `pnpm test:unit`,
  `pnpm build`, scoped `TEST_MODELS=... FULL_MODE=true pnpm test:e2e`,
  `scripts/check-brand.sh` (bash 4+).
- Database changes only via `packages/db/src/schema.ts` + `pnpm migrations`.

## Primary file reference

| Concern                          | Path                                                                     |
| -------------------------------- | ------------------------------------------------------------------------ |
| Provider definitions             | `packages/models/src/providers.ts`                                       |
| Model and mapping definitions    | `packages/models/src/models/*.ts`                                        |
| Endpoint and base URL resolution | `packages/actions/src/get-provider-endpoint.ts`                          |
| Auth headers                     | `packages/actions/src/get-provider-headers.ts`                           |
| Request body preparation         | `packages/actions/src/prepare-request-body.ts`                           |
| Streaming transform              | `apps/gateway/src/chat/tools/transform-streaming-to-openai.ts`           |
| Model string parsing             | `apps/gateway/src/chat/tools/parse-model-input.ts`                       |
| Cost calculation                 | `apps/gateway/src/lib/costs.ts`                                          |
| Catalog resolver                 | `packages/catalog/src/catalog.ts`                                        |
| Snapshot schema and runtime      | `packages/catalog/src/runtime.ts`                                        |
| Snapshot cache                   | `packages/catalog/src/snapshot-cache.ts`                                 |
| Change-set contract              | `packages/catalog/src/contracts.ts`                                      |
| Change-set application           | `packages/catalog/src/change-set.ts`                                     |
| Catalog store and refresh        | `packages/catalog/src/catalog-store.ts`                                  |
| Price policy resolution          | `packages/catalog/src/pricing.ts`                                        |
| Gateway catalog enforcement      | `apps/gateway/src/lib/catalog-policy.ts`                                 |
| Credential resolution            | `apps/gateway/src/chat/tools/get-provider-env.ts`                        |
| Feature flags                    | `packages/catalog/src/flags.ts`                                          |
| Worker sync                      | `apps/worker/src/services/sync-models.ts`                                |
| Catalog tables                   | `packages/db/src/schema.ts`                                              |
| Admin catalog API                | `apps/api/src/routes/platform-catalog.ts`                                |
| Platform credentials API         | `apps/api/src/routes/platform-providers.ts`                              |
| Admin catalog UI                 | `ee/admin/src/app/catalog/catalog-client.tsx`                            |
