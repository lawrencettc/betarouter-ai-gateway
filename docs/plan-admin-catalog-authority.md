# Admin Catalog Authority: Moving Provider, Model, and Pricing Control Into Admin

Status: Design proposal — not yet approved for implementation

Date: 2026-08-05

Owner: BetaRouter platform operator

Scope: Make the operator console the authority for creating, editing, and
retiring providers, models, and mappings, including all pricing — replacing the
current arrangement where `packages/models` is the only place these can be
defined.

Relates to: `docs/spec-admin-model-catalog.md` (the launch spec this extends),
`docs/future-build-plan-admin-model-catalog.md` (items 1, 2, and 4 under
"Provider and model expansion" are subsumed by this plan),
`docs/plan-catalog-enforcement-rollout.md` (the flag ladder this depends on).

---

## Problem statement

The launch Admin Model Catalog gave the operator authority over catalog
**policy**: visibility, enablement, lifecycle, customer pricing, routing
priority, and circuit breaking. It deliberately did not give the operator
authority over the catalog **source**: which providers, models, and mappings
exist at all, and what their base capabilities and upstream prices are.

That split is spec decision #1 ("Preserve source data and store operator policy
separately"). It was correct for launch. It is now the primary source of
operational friction:

1. Adding a provider requires editing switch statements across three packages,
   then a release.
2. Adding or correcting a model mapping — including a price the upstream vendor
   changed this morning — requires a pull request and a deploy.
3. Operator overrides can only narrow. `disabledCapabilities` can turn `vision`
   off; nothing can turn it on. Limits cap; they never raise.
4. As a result the operator cannot respond to routine upstream changes without
   an engineer.

This plan removes that constraint while preserving every property the launch
design was built to protect: no hard deletion, atomic audited change sets,
billing integrity, and staged rollback.

## Key finding that sizes this work

**PostgreSQL already contains the complete catalog.** The worker sync
(`apps/worker/src/services/sync-models.ts`) writes every provider, model, and
mapping — with all prices and capability flags — into the `provider`, `model`,
and `model_provider_mapping` tables. Regions are already expanded into distinct
rows via `expandAllProviderRegions`.

`model_provider_mapping` today carries: `externalId`, `region`, `inputPrice`,
`outputPrice`, `cachedInputPrice`, `cacheReadInputPrice`, `cacheWriteInputPrice`,
`cacheWriteInputPrice1h`, `imageInputPrice`, `imageOutputPrice`,
`inputAudioPrice`, `cachedImageInputPrice`, `cachedInputAudioPrice`,
`outputAudioPrice`, `inputCharacterPrice`, `ocrPagePrice`, `inputAudioHourPrice`,
`perSecondPrice`, `requestPrice`, `webSearchPrice`, `contextSize`, `maxOutput`,
`streaming`, `vision`, `reasoning`, `reasoningMaxTokens`, `reasoningOutput`,
`tools`, `jsonOutput`, `jsonOutputSchema`, `webSearch`, `stability`,
`supportedParameters`, `test`, `deprecatedAt`, `deactivatedAt`, `status`.

The data is already there. The gateway simply does not read it: request-time
resolution goes through the statically imported `models` array from
`@betarouter/models`. This is a read-path and authority problem, not a data
migration problem.

## Goals

1. Operator can create a new provider, model, or mapping from Admin, without a
   code change, for any upstream that speaks an already-implemented protocol.
2. Operator can edit any catalog field from Admin, including base capabilities
   and upstream prices — not only narrowing overrides.
3. Operator has complete control of customer-facing pricing from Admin.
4. Upstream catalog changes in `packages/models` arrive as reviewable proposals
   rather than silent overwrites.
5. Every property of the launch design is preserved: no hard deletion, atomic
   change sets with preview and rollback, full audit, billing lineage intact.

## Non-goals

1. Deleting catalog entities. "Delete" remains archive or retire (see
   "Deletion" below). This is not a limitation to be fixed later.
2. Authoring new wire protocols from Admin. New protocol adapters stay in code.
3. Moving compliance attestations (`dataPolicy`, `headquarters`) to
   unrestricted Admin editing. See "What stays in code".
4. Multi-operator approval workflows. Still deferred per the future build plan.
5. Removing `packages/models`. It becomes an import source, not the authority.

---

## Core design decisions

### 1. The database becomes authoritative; code becomes an import source

`packages/models` stops being the source of truth and becomes a seed and
upstream-change feed. The `provider`, `model`, and `model_provider_mapping`
tables become authoritative. The catalog snapshot, already published and cached,
becomes what the gateway reads at request time.

This amends spec decision #1 rather than discarding it. Source and policy remain
separate records; the difference is that the source record becomes editable by
the operator instead of being import-only.

### 2. Row ownership is explicit

Add `source: 'static' | 'admin'` to all three catalog tables.

- `static` rows originate from `packages/models`.
- `admin` rows are operator-created and are never touched by the sync.
- The sync **inserts** new `static` rows. For an existing `static` row whose
  upstream definition has diverged from the stored row, the sync does **not**
  overwrite: it records a proposed change set for operator review.

This subsumes future-build-plan item 4 ("automatic source-catalog diff
suggestions … every suggestion remains operator-approved") and is the mechanism
that makes 664 mappings maintainable. It is more valuable than any Admin form:
upstream price and capability changes arrive as a review queue instead of as
authoring work.

### 3. Provider transport behavior is declared, not switched

Introduce an explicit `protocol` discriminator on the provider definition and on
the `provider` table:

```
protocol: "openai-chat" | "anthropic-messages" | "google-generative"
        | "aws-bedrock" | "azure-openai" | ...
```

Today the majority of providers reach the `default:` branch of three separate
switch statements, which is an unnamed "OpenAI-compatible" protocol. Naming it
converts provider onboarding from "find and edit every switch" into "declare a
protocol". It is also a hard prerequisite for creating providers from Admin: a
provider cannot be created from a form while its behavior lives in a switch keyed
on provider id.

### 4. No hard deletion — unchanged

Spec decision #4 stands without modification. Reasons, all independently
sufficient:

- Four tables reference `model_provider_mapping.id` with `onDelete: "cascade"`
  (`platform_mapping_policy`, `platform_mapping_price_policy`,
  `platform_mapping_test_run`, and breaker state). Deleting a mapping destroys
  its price history, test evidence, and audit trail.
- Catalog lineage foreign keys exist on `log` and `video_job`. A deleted mapping
  means historical requests can no longer resolve what they were billed at.
- Repository policy: catalog entries are retired with `deactivatedAt`, never
  removed.

An Admin "Delete" control is acceptable provided it is wired to retire. The
operator-facing outcomes are:

| Operator intent                 | Mechanism                                           | Effect                                                             |
| ------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------ |
| Stop serving now                | `enabled: false`                                    | Unroutable immediately                                             |
| Hide from customers             | `visible: false`                                    | Absent from `/v1/models` and UI                                    |
| Sunset with notice              | `lifecycle: deprecated` then `retired` + `retireAt` | `Deprecation`/`Sunset` headers, then 410 with `replacementModelId` |
| Retire an upstream deployment   | `deactivatedAt` on the mapping                      | Permanently out of routing                                         |
| Clear an operator policy record | `entity.archive_policy`                             | Removes policy, keeps entity                                       |

### 5. Pricing authority is already mostly built

Customer pricing is already fully operator-controlled through
`platform_mapping_price_policy` in `source_cost`, `markup`, or `fixed` mode.
`fixed` mode sets the complete customer price table per mapping with no code
involvement. **This works today the moment `PLATFORM_CATALOG_ROUTING_ENABLED` is
true.**

Two gaps remain, both additive:

- `fixedPricesV1Schema` omits `cacheReadInputPrice`, `cachedImageInputPrice`,
  `cachedInputAudioPrice`, and `inputAudioPrice`. Add them (as
  `fixedPricesV2Schema` with a version bump, keeping v1 readable).
- Source cost — used for margin computation and `source_cost` mode — still
  originates in code. Step 5 makes it operator-editable.

---

## Precondition: finish the enforcement rollout

**Nothing in this plan is meaningful until the catalog is load-bearing.**

`filterProviderMappingsByCatalog` (`apps/gateway/src/lib/catalog-policy.ts:258`)
returns its input unchanged when the decision is null, which is what
`enforceCatalogRequest` returns whenever `PLATFORM_CATALOG_ROUTING_ENABLED` is
false. In that state every catalog policy and price the operator configures is
silently bypassed and requests bill at the raw `packages/models` price.

Verify actual state before any work begins (from
`docs/plan-catalog-enforcement-rollout.md:158`):

```bash
cd /opt/betarouter-ai-gateway
grep '^PLATFORM_CATALOG' .env.production
docker compose -f infra/docker-compose.betarouter.yml --env-file .env.production \
  exec betarouter env | grep '^PLATFORM_CATALOG'
docker compose -f infra/docker-compose.betarouter.yml --env-file .env.production \
  exec betarouter sh -c \
  'for p in /proc/[0-9]*; do grep -l gateway $p/cmdline >/dev/null 2>&1 && \
     tr "\0" "\n" < $p/environ | grep ^PLATFORM_CATALOG; done'
```

Note that `PLATFORM_CATALOG_*` keys are absent from `.env.production.example`,
and `infra/docker-compose.betarouter.yml:72-75` defaults all four to
`false`/`off`. If `grep` on `.env.production` prints nothing, the flags are off
and `docs/operator-guide-enforcement-rollout.md` must be completed first.

---

## Implementation steps

Each step is independently shippable and independently valuable. Steps 1-4 carry
low risk. Step 5 is the consequential one.

### Step 1 — Declare provider protocols

**Type:** pure refactor. No schema change, no behavior change, no flag.

1. Add `protocol` to `ProviderDefinition` in
   `packages/models/src/providers.ts` and set it on all existing providers.
2. Replace switch-on-provider-id with lookup-by-protocol in:
   - `packages/actions/src/get-provider-endpoint.ts` (request path selection,
     around `:790-830`)
   - `packages/actions/src/get-provider-headers.ts` (auth header shape, the
     bearer bucket around `:135-152`)
   - `apps/gateway/src/chat/tools/transform-streaming-to-openai.ts` (chunk
     transform, the OpenAI-compatible bucket around `:1415-1450`)
3. Keep `PROVIDER_DEFAULT_BASE_URLS` keyed on provider id — base URL is
   per-provider data, not per-protocol.

**Exit gate:** `pnpm test:unit` green; `pnpm build` green; a spot-check e2e run
against one provider per protocol shows byte-identical behavior. The
`"Unknown provider using OpenAI fallback"` warning path becomes unreachable for
declared providers.

**Value delivered:** adding an OpenAI-compatible provider drops from four files
across three packages to one declared field.

### Step 2 — Mirror the remaining catalog fields into the database

**Type:** additive migration plus sync writes.

Fields present in code but not yet in the tables:

- `model_provider_mapping`: `pricingTiers`, `serviceTierMultipliers`,
  `supportedToolChoices`, `reasoningEfforts`
- `provider`: `protocol`, `priority`, `contentFilter`, `maxTemperature`,
  `headquarters`, `dataPolicy`, `serviceTiers`, `regionConfig`, `env`,
  `termsUrl`, `privacyPolicyUrl`, `statusPageUrl`, `apiKeyInstructions`,
  `modelCardBadge`, `additionalLinks`

Generate with `pnpm migrations`; never hand-write migration SQL or edit
snapshot/journal files.

**Exit gate:** after `pnpm run setup` plus one worker sync, every field in the
static catalog has a matching non-null database value wherever the code defines
one. Add a test asserting this equivalence — it is the safety net for Step 4.

### Step 3 — Extend the catalog snapshot to be self-describing

**Type:** additive, behaviorally inert.

Extend `EffectiveModel` and `EffectiveMapping` (`packages/catalog/src/catalog.ts`)
and `storedCatalogSnapshotSchema` (`packages/catalog/src/runtime.ts:16`) to carry
base catalog data, not only the narrowing overlay: model `name`, `family`,
`aliases`, `output`, `free`; mapping `contextSize`, `maxOutput`, positive
capability flags, `supportedParameters`, `pricingTiers`,
`serviceTierMultipliers`, and the full source price set.

Populate from the database rows Step 2 completed. Nothing reads the new fields
yet — this is deliberately redundant so it can ship without risk.

Note the checksum implication: `calculateCatalogChecksum` covers snapshot
content, so adding fields changes every checksum. Plan one revision bump and
confirm both discovery surfaces (`/v1/models` and `/internal/models`) agree on
the new ETag before proceeding.

**Exit gate:** snapshot round-trips through `parseStoredCatalogSnapshot`;
checksums agree across both surfaces; no request-path behavior change observable.

### Step 4 — Invert the request-time read path

**Type:** the consequential change. Runs behind the existing shadow ladder.

Introduce a resolver — `resolveModelFromCatalog(modelId, snapshot)` — returning
the same shape today's consumers get from the static `models` array, so call
sites change their source rather than their logic.

18 files call `models.find(...)` / `.filter(...)` / `.some(...)`. Seven are on
the request hot path and must migrate:

1. `apps/gateway/src/chat/tools/parse-model-input.ts` — currently throws
   `400 Requested model X not supported` from the static array, before the
   catalog is consulted. This is the file that makes database-only models
   unreachable; migrate it first.
2. `apps/gateway/src/chat/tools/resolve-model-info.ts`
3. `apps/gateway/src/chat/chat.ts`
4. `apps/gateway/src/lib/costs.ts`
5. `apps/gateway/src/lib/iam.ts`
6. `packages/actions/src/prepare-request-body.ts`
7. `packages/actions/src/get-provider-endpoint.ts`

The remainder (`videos.ts`, `images.ts`, `moderations.ts`, `end-user-session.ts`,
`validate-provider-key.ts`, and test harnesses) can follow or keep static
resolution until their own operations are catalog-gated.

**Rollout:** resolve both ways under `PLATFORM_CATALOG_SHADOW_READ`, log any
divergence with model id, provider id, and differing field, and require a clean
observation window under real traffic before switching the authoritative source.
Any pricing divergence, by any amount, is an immediate abort — this mirrors the
Stage 5 billing rule in the enforcement rollout plan.

**Exit gate:** zero divergence over a full soak covering at least two worker
syncs, one cache refresh, and one restart. Billing assertions on a canary model
must match exactly.

### Step 5 — Create and edit operations

**Type:** contract plus migration. Only meaningful after Step 4.

1. Add `source: 'static' | 'admin'` to `provider`, `model`, and
   `model_provider_mapping`; default `'static'` for existing rows.
2. Scope every write in `syncProvidersAndModels()` to `source = 'static'`.
3. Extend `catalogOperationV1Schema` (`packages/catalog/src/contracts.ts:147`):
   - `provider.create`, `provider.update`
   - `model.create`, `model.update`
   - `mapping.create`, `mapping.update`

   `*.update` mutates source fields (base prices, positive capability flags,
   `contextSize`, source `externalId`). This is what removes the narrowing-only
   constraint. Existing `*.set_policy` operations are unchanged and continue to
   express operator overlay on top.

4. Enforce catalog invariants at the contract layer, not only in tests. In
   particular: a model must never hold two mappings with the same
   `(providerId, region)` — mapping resolution keys on that pair throughout the
   gateway, so a duplicate is unaddressable and would bill at the wrong
   mapping's prices. The existing unique constraint on
   `(modelId, providerId, region)` covers the table; the contract must reject it
   before preview so the operator gets a usable error.
5. New mappings enter as `draft` and remain unroutable until the existing
   admission gates pass: price policy complete, credential available, and a
   passing `platform_mapping_test_run` against the exact credential fingerprint.
   Do not weaken this.

**Exit gate:** an operator can create a provider, model, and mapping end to end
through change-set preview and apply, drive it through the test console, enable
it, and serve a billed request — with no code change and no deploy.

### Step 6 — Upstream diff proposals

**Type:** worker plus review UI.

When the sync finds a `static` row whose upstream definition has diverged, it
creates a proposed change set rather than overwriting. New upstream entities
arrive as proposed creates; removed ones as proposed retirements.

This is where the day-to-day maintenance burden actually goes away at 664
mappings. Every proposal remains operator-approved.

### Step 7 — Admin interface

Forms for provider, model, and mapping create/edit; a proposal review queue; and
a "Delete" control wired to retire. Additive to the existing catalog client
(`ee/admin/src/app/catalog/catalog-client.tsx`), which already renders mapping
policy editing and change-set assembly.

---

## What stays in code

1. **Protocol adapters.** Request/response transformation is logic. A new
   protocol is a code change; a new provider using an existing protocol is data.
2. **Compliance attestations** — `dataPolicy` and `headquarters`. These drive
   enterprise routing gates that fail closed on null. An unreviewed edit can
   silently invalidate a customer's contractual guarantee. Options, in order of
   preference: keep in code; or make editable but require the second-approver
   mechanism from the future build plan before the field takes effect. Do not
   ship them as ordinary Admin fields while the console has a single operator
   role.
3. **Gateway routing and error-classification logic**, including the
   deliberately conservative rules in
   `apps/gateway/src/chat/tools/get-finish-reason-from-error.ts`.

---

## Risks

| Risk                                                    | Mitigation                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Step 4 changes billing inputs                           | Shadow-compare both resolution paths; any pricing divergence aborts                                                |
| Snapshot growth degrades request latency                | Snapshot is cached in-process with bounded staleness (`CatalogSnapshotCache`); measure p99 before and after Step 3 |
| Operator sets an unroutable capability combination      | Contract-layer invariant checks in Step 5; mapping test run must pass before routable                              |
| Sync and Admin fight over a row                         | `source` column plus proposal-not-overwrite in Step 6                                                              |
| Snapshot unavailable at request time                    | Existing fail-closed behavior and bounded-stale cache are unchanged; Step 3 must not alter them                    |
| Checksum churn from Step 3 confuses the revision ledger | One planned revision bump, recorded in the audit ledger with cause                                                 |

## Acceptance criteria

1. Operator creates a new OpenAI-compatible provider from Admin, attaches a
   platform credential, creates a model and mapping, passes the mapping test,
   sets a `fixed` price policy, enables it, and serves a correctly billed
   request — with no code change and no deploy.
2. Operator edits an existing mapping's base input price from Admin; the next
   request bills at the new price; the prior price remains recoverable from the
   revision history.
3. Operator enables a capability that was previously off, on a mapping where the
   deployment supports it. (Narrowing-only constraint removed.)
4. An upstream price change in `packages/models` produces a reviewable proposal
   and does not silently alter a live price.
5. Retiring a model returns 410 with `replacementModelId`; all historical `log`
   rows still resolve their mapping and billed cost.
6. No catalog row is ever hard-deleted by any Admin action.

## Verification commands

```bash
pnpm format
pnpm lint
pnpm test:unit
pnpm build
# scope e2e to affected mappings only
TEST_MODELS="<provider>/<model>" FULL_MODE=true pnpm test:e2e
scripts/check-brand.sh   # requires bash 4+
```

Database schema changes: edit `packages/db/src/schema.ts`, then `pnpm migrations`.
Never hand-write migration SQL and never edit snapshot or journal files. If
migrations conflict during a merge with main, restore them from origin/main
before merging and regenerate after.

## Primary file reference

| Concern                          | Path                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Provider definitions             | `packages/models/src/providers.ts`                                                                             |
| Model and mapping definitions    | `packages/models/src/models/*.ts`                                                                              |
| Endpoint and base URL resolution | `packages/actions/src/get-provider-endpoint.ts`                                                                |
| Auth headers                     | `packages/actions/src/get-provider-headers.ts`                                                                 |
| Streaming transform              | `apps/gateway/src/chat/tools/transform-streaming-to-openai.ts`                                                 |
| Model string parsing             | `apps/gateway/src/chat/tools/parse-model-input.ts`                                                             |
| Cost calculation                 | `apps/gateway/src/lib/costs.ts`                                                                                |
| Catalog resolver                 | `packages/catalog/src/catalog.ts`                                                                              |
| Snapshot schema and runtime      | `packages/catalog/src/runtime.ts`                                                                              |
| Change-set contract              | `packages/catalog/src/contracts.ts`                                                                            |
| Change-set application           | `packages/catalog/src/change-set.ts`                                                                           |
| Catalog store and refresh        | `packages/catalog/src/catalog-store.ts`                                                                        |
| Price policy resolution          | `packages/catalog/src/pricing.ts`                                                                              |
| Gateway catalog enforcement      | `apps/gateway/src/lib/catalog-policy.ts`                                                                       |
| Feature flags                    | `packages/catalog/src/flags.ts`                                                                                |
| Worker sync                      | `apps/worker/src/services/sync-models.ts`                                                                      |
| Catalog tables                   | `packages/db/src/schema.ts` (`provider`, `model`, `model_provider_mapping` and the `platform_*` policy tables) |
| Admin catalog API                | `apps/api/src/routes/platform-catalog.ts`                                                                      |
| Platform credentials API         | `apps/api/src/routes/platform-providers.ts`                                                                    |
| Admin catalog UI                 | `ee/admin/src/app/catalog/catalog-client.tsx`                                                                  |

## Suggested sequencing for an implementing session

1. Confirm the enforcement flags are on in the target environment. If not, stop
   and complete `docs/operator-guide-enforcement-rollout.md` first — everything
   below is inert otherwise.
2. Step 1 (protocol declaration) as a standalone pull request. Small, safe,
   independently valuable.
3. Steps 2 and 3 together as a second pull request — additive schema and
   snapshot work, no behavior change.
4. Step 4 as its own pull request with a dedicated soak. Do not bundle it.
5. Steps 5-7 once Step 4 has held under production traffic.

Do not start Step 5 before Step 4 is enforcing. Create operations against a
catalog the gateway does not read would produce entities that appear in Admin
and are unreachable by any request — the most confusing possible failure mode.
