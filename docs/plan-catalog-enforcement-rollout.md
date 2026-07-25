# Admin Model Catalog enforcement rollout plan

Date: 2026-07-24
Entry revision: 40
Entry checksum: `sha256:v2:772202412b45d5d416b1af6b49ae1aa62bf09b2d5318f5dd5d040fb7cb1086e7`
Entry image: `betarouter-ai-gateway-unified:845ab33-local`

This plan covers the pending stages of `docs/admin-model-catalog-operations.md`:
Stage 4 (discovery), Stage 5 (routing and billing), Stage 6a/6b (breaker
observation and enforcement). Stages 1–3 are closed; see
`docs/verification-admin-model-catalog-launch.md`.

Every stage requires separate explicit operator approval. Do not chain stages in
one session. Do not bake any flag change into an image or into Git.

## Blocking precondition: the catalog is not curated

Production holds exactly one row in each operator-policy table (the hidden
GPT-5.5 canary). `computeEffectiveCatalog` emits `provider_policy_missing`,
`model_policy_missing`, and `mapping_policy_missing` for every entity without a
policy row, and those reasons clear both `available` and `displayable`
(`packages/catalog/src/catalog.ts:279-349`).

Consequences if the stages are run against revision 40 as it stands:

| Flag flipped        | Effect at revision 40                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `DISCOVERY_ENABLED` | `/v1/models` and `/internal/models` filter to `visibleModelIds` — an empty or near-empty list   |
| `ROUTING_ENABLED`   | `evaluateCatalogRequest` returns `model_not_available` (404) for effectively every chat request |

Stage 3.5 below is therefore mandatory and blocking. Do not request Stage 4
approval until it is closed.

## Stage ordering and independence

`discoveryEnabled` and `routingEnabled` are orthogonal in code; neither reads the
other. That permits combining them. Do not combine them:

- Blast radius differs by an order of magnitude. Discovery only reshapes two
  read-only list surfaces. Routing rejects live requests with 404/410/503.
- Failure modes differ. Discovery introduces a **new fail-closed path**:
  `apps/gateway/src/models/models.ts:169-179` rethrows a snapshot error when
  `discoveryEnabled`, where shadow only logs a warning. A snapshot outage that
  was previously invisible becomes a 5xx on `/v1/models`. That deserves its own
  soak.
- Discovery-first makes the curated set observable in the real customer surfaces
  before it becomes authoritative for routing. Every divergence found in Stage 4
  is a routing rejection avoided in Stage 5.
- The cost of separation is one extra same-image redeploy (~2 min).

Stage 6 is **not** independent of Stage 5, despite the flags being orthogonal.
Breaker outcome recording requires `log.model_provider_mapping_id` and
`log.catalog_revision_id` (`apps/gateway/src/lib/logs.ts:290-317`), and those
columns are populated only from a non-null `enforceCatalogRequest` decision
(`apps/gateway/src/chat/chat.ts:5140-5143`), which returns `null` whenever
`routingEnabled` is false. **Breaker observe records nothing while routing is
off.** Stage 6a strictly follows Stage 5.

Required order: **3.5 → 4 → 5 → 6a → 6b**, each with its own approval and
redeploy.

## Soak duration policy under zero organic traffic

Wall clock proves nothing without traffic. Do not treat elapsed hours as
evidence. Each stage's soak is defined by the **events it must cover**, with a
wall-clock floor only large enough to contain them:

| Event to cover                          | Why it matters                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| ≥2 worker source-synchronization cycles | Proves the flag survives a source `updated_at` advance without policy drift        |
| ≥1 bounded-stale snapshot refresh       | Exercises `runtime.ts` polling, not just the invalidation fast path                |
| ≥1 catalog invalidation (revision bump) | Exercises the Redis pub/sub path under the new flag                                |
| ≥1 container restart                    | Proves cold start under the flag; a warm cache can mask a fail-closed snapshot bug |
| Full synthetic evidence set (per stage) | The only positive/negative correctness proof available                             |

Floors: Stage 4 ≥ 2 h. Stage 5 ≥ 4 h. Stage 6a ≥ 24 h (breaker windows are
count- and time-based; a shorter window cannot show cooldown/half-open
behaviour). Stage 6b ≥ 1 h plus a fully exercised transition cycle.

**What synthetic traffic cannot prove**: concurrency behaviour, the
`claimBreakerProbes` race under parallel requests, snapshot-cache stampede under
load, real failure-rate distributions, and whether the curated set matches actual
customer demand. Record these as accepted residual risk in the closure audit
rather than claiming coverage.

---

## Stage 3.5: curate the launch set (blocking, no flag change)

No `.env.production` edit. No redeploy. Admin change sets only.

### Entry gate

1. Revision is 40, checksum matches the entry value, counts are 41/312/664.
2. All four policy fingerprints match the recorded baseline (runbook SQL,
   "Shadow completion audit" step 3; baselines in the launch dossier).
3. Catalog overview reports **Current**, not **Refresh required**.
4. A restorable backup newer than the last policy write exists under
   `/opt/betarouter-backups`; gzip integrity verified.

### Procedure

1. Choose the launch model set. Constraint from
   `catalog-policy.ts:23-27`: only `chat` is catalog-governed, so curate
   text/chat models only. Every other modality stays on legacy routing whatever
   the flags say.
2. For each launch entity publish provider policy, model policy, mapping policy,
   and mapping price policy such that the mapping has: active source rows, an
   enabled+visible provider policy, an enabled+visible model policy, an enabled
   mapping policy, a validated platform credential, complete prices, and a
   **currently passing mapping test**. Any one missing clears `available`.
3. Preview before apply. Reject any preview reporting blockers, fallback loss,
   negative margin, scheduled conflict, or customer impact.
4. Apply as one atomic change set. Confirm exactly one revision increment.

### Verification

- New revision N > 40; record ID, checksum, and the new ETag
  `W/"catalog-N-<last16>"`.
- Recompute all four fingerprints; row counts must have grown by exactly the
  curated entity counts and the new values become the **Stage 4 baseline**.
- In Admin, confirm each launch mapping shows `displayable: true`,
  `available: true`, `routable: true`, and empty `reasons`.
- `platform_catalog.preview` and `platform_catalog.apply` audit rows present and
  successful.

### Abort / rollback

Admin rollback preview → audited inverse revision. No flag change, no image
change.

### Risks

- Curating a mapping whose credential later fails validation silently drops it
  from `available`; Stage 5 then 404s a model that Stage 4 still listed as
  visible (`displayable` does not require credential readiness, `available`
  does). Re-verify readiness immediately before the Stage 5 flip.
- Curating a model whose `packages/models` definition has no matching provider
  mapping produces a catalog entry that `findProviderMappingForCatalogMapping`
  cannot resolve, silently yielding zero providers for that model in discovery.

---

## Stage 4: discovery

Target: `PLATFORM_CATALOG_DISCOVERY_ENABLED=true`. Shadow stays `true`; routing
stays `false`; breaker stays `off`.

### Entry gate

1. Stage 3.5 closed and approved.
2. Revision and checksum equal the Stage 3.5 recorded values; the two discovery
   surfaces already agree on that ETag under shadow.
3. All four fingerprints match the Stage 3.5 baseline.
4. Backup freshness: a full dump newer than the Stage 3.5 apply, gzip-verified,
   with recorded SHA-256. Rollback image marker file present.
5. Running-container flag audit (both the compose environment and the live
   process, so a partially restarted supervisor cannot hide a stale value):

   ```bash
   cd /opt/betarouter-ai-gateway
   docker compose -f infra/docker-compose.betarouter.yml --env-file .env.production \
     exec betarouter env | grep '^PLATFORM_CATALOG'
   docker compose -f infra/docker-compose.betarouter.yml --env-file .env.production \
     exec betarouter sh -c \
     'for p in /proc/[0-9]*; do grep -l gateway $p/cmdline >/dev/null 2>&1 && \
        tr "\0" "\n" < $p/environ | grep ^PLATFORM_CATALOG; done'
   ```

   Expected: `SHADOW_READ=true`, `DISCOVERY_ENABLED=false`,
   `ROUTING_ENABLED=false`, `BREAKER_MODE=off`.

6. Record the pre-flip legacy model list for diffing:

   ```bash
   curl -s https://api.betarouter.com/v1/models | jq -r '.data[].id' | sort > /tmp/models-legacy.txt
   ```

### Change procedure

```bash
cd /opt/betarouter-ai-gateway
cp .env.production .env.production.bak.$(date -u +%Y%m%dT%H%M%SZ)
sed -i 's/^PLATFORM_CATALOG_DISCOVERY_ENABLED=.*/PLATFORM_CATALOG_DISCOVERY_ENABLED=true/' .env.production
grep '^PLATFORM_CATALOG' .env.production

BETAROUTER_IMAGE=betarouter-ai-gateway-unified:845ab33-local \
BETAROUTER_PULL_POLICY=never \
docker compose -f infra/docker-compose.betarouter.yml --env-file .env.production \
  up -d --no-build betarouter
```

Same image. If `sed` matched nothing, the key is absent — add it explicitly
rather than relying on the compose default.

### Verification

1. Health: unified container healthy, all ten Supervisor processes running,
   PostgreSQL, Redis, worker, Cloudflare Tunnel up, and all four public roots
   returning HTTP 200.
2. Flag audit repeated with the command above; only `DISCOVERY_ENABLED` changed.
3. Revision/ETag convergence — both must be HTTP 200 with the identical weak
   ETag:

   ```bash
   curl -sI https://api.betarouter.com/v1/models | grep -i '^etag'
   curl -sI https://platform-api.betarouter.com/internal/models | grep -i '^etag'
   ```

   Expected `W/"catalog-N-<last16 of checksum>"` on both.

4. Curated-set agreement:

   ```bash
   curl -s https://api.betarouter.com/v1/models | jq -r '.data[].id' | sort > /tmp/models-catalog.txt
   diff /tmp/models-legacy.txt /tmp/models-catalog.txt
   ```

   Every removed ID must be an intentional non-curation. Zero unexplained
   removals. Zero additions.

5. Gateway/platform set equality:

   ```bash
   curl -s https://platform-api.betarouter.com/internal/models | jq -r '.data[].id' | sort \
     | diff - /tmp/models-catalog.txt
   ```

   Must be empty.

6. Customer pricing present and equal to the published policy for each curated
   model; per-token fields are per-unit (policy `$/M` ÷ 1e6, per
   `applyCatalogCustomerPrices`).
7. Lifecycle metadata: deprecated models expose deprecation/retirement/
   replacement fields; retired models are **absent** from both lists.
8. Provider list on `/internal/providers` restricted to `visibleProviderIds`.
9. UI and playground selectors load, populate, and can select a curated model.
   Confirm no empty-state or client error.
10. Snapshot fail-closed check — restart the container and immediately re-poll
    `/v1/models` until 200. A sustained 5xx here is the discovery-specific
    fail-closed path and is an abort.
11. Recompute all four fingerprints; must equal the Stage 3.5 baseline.
    Discovery must not write policy.
12. Audit log: no new `platform_catalog.*` rows should appear from the flip
    itself. Any unexplained row is an abort.

### Observation window

Minimum 2 h, and must contain: ≥2 worker sync cycles, ≥1 bounded-stale refresh,
≥1 container restart, and the hourly read-only monitor's paired
`/v1/models` + `/internal/models` GETs returning matching ETags throughout.

Watch: catalog availability warnings, catalog-specific errors, `/v1/models`
non-200 rate, ETag divergence between the two surfaces, and fingerprint
stability across each sync.

Synthetic traffic here is genuinely sufficient: discovery is a deterministic
pure filter over a snapshot, so a single correct response plus cache-refresh and
cold-start coverage exercises every branch. Volume adds nothing.

Minimum synthetic evidence set: the pre/post list diff, the two-surface set
equality, one price/lifecycle spot check per curated model, one retired-model
absence check, one selector load in UI and playground, one post-restart 200.

### Abort criteria

- `/v1/models` or `/internal/models` returns non-200, or the two disagree.
- Any unexplained model missing from the curated list, or any unexpected model
  present.
- Prices in discovery disagree with the published policy.
- A retired model appears.
- Any policy fingerprint changes.
- UI or playground selector breaks.
- Any catalog availability warning or catalog-specific error without a
  determined benign cause.

### Rollback

Smallest safe rollback, in order:

1. `PLATFORM_CATALOG_DISCOVERY_ENABLED=false`, redeploy same image. Restores the
   legacy list immediately; nothing else changes.
2. If the shadow comparison logging is implicated, also
   `PLATFORM_CATALOG_SHADOW_READ=false`.
3. If the defect is an operator policy (wrong visibility, wrong price), use
   Admin rollback preview and the audited inverse revision — do **not** flip the
   flag for a curation mistake.
4. Redeploy the previous image only for an application fault.

### Stage-specific risks

| Risk                                                                                        | Reasoning                                                                                            | Mitigation                                       |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Catalog-visible set diverges from the legacy list; playground/website selectors lose models | Discovery replaces `modelsList` with a `visibleModelIds` filter                                      | Pre/post diff (step 4) is the gate               |
| `/v1/models` starts failing closed on snapshot unavailability                               | `models.ts:169-179` rethrows under `discoveryEnabled` where shadow warned                            | Post-restart 200 check; abort criterion          |
| Model present but zero providers                                                            | `findProviderMappingForCatalogMapping` cannot resolve a catalog mapping to a `packages/models` entry | Assert non-empty `providers` per curated model   |
| Discovery/routing skew becomes user-visible                                                 | Routing is still legacy, so a model hidden from discovery is still callable                          | Accepted and expected for this stage; documented |

---

## Stage 5: routing and billing

Target: `PLATFORM_CATALOG_ROUTING_ENABLED=true`. Discovery stays `true`; shadow
stays `true` (keep the decision logs); breaker stays `off`.

### Billing canary selection

Reuse the GPT-5.5 mapping `ceOirxBoDfCo74ShWIMZ` (provider `openai`) as the
Stage 5 billing canary, re-published as **enabled + `allowDirect: true`, still
customer-hidden**.

Justification:

- `evaluateCatalogRequest` admits `!model.visible && model.allowDirect`, and
  `routable` does not require `displayable`. So the canary is callable for
  billing proof while remaining absent from discovery — it cannot contaminate
  the Stage 4 curated set or reach customers.
- Its credential is validated and its mapping test already passed through the
  production adapter path.
- It carries **fixed** customer prices (input `$5/M`, output `$30/M`, cached
  input `$0.5/M`, request `$0`, web search `$0.01`), so expected billed cost is
  hand-computable and independent of source-cost drift. A markup-mode or
  source-cost mapping would make the billed-cost assertion depend on values that
  can move under a worker sync.
- Its apply → audited rollback → reapply path is already production-proven for
  this exact entity, so the abort path is known-good.

Do not promote a launch-set model to canary: rolling back the canary must not
disturb the curated set. Cap `max_tokens` to keep spend trivial.

### Entry gate

1. Stage 4 closed and approved; its observation window met with zero abort
   criteria triggered.
2. Revision/checksum/ETag equal the Stage 4 closing values on both surfaces.
3. All four fingerprints equal the Stage 4 baseline (or the canary-republication
   baseline if the canary policy was re-applied — record which).
4. Fresh full backup taken **after** the canary republication, gzip-verified,
   SHA-256 recorded. Rollback image marker confirmed.
5. Flag audit in the running container: `DISCOVERY_ENABLED=true`,
   `ROUTING_ENABLED=false`, `BREAKER_MODE=off`.
6. **Shadow decision review** — the de-risking step. From the shadow logs since
   Stage 4, extract every `Catalog routing decision` with `mode:"shadow"` and
   confirm zero `allowed:false` entries for any curated model:

   ```bash
   docker compose -f infra/docker-compose.betarouter.yml --env-file .env.production \
     logs betarouter --since 4h 2>&1 \
     | grep 'Catalog routing decision' \
     | jq -c 'select(.allowed==false) | {modelId,code,status}' | sort | uniq -c
   ```

   Every `allowed:false` line is a request the legacy path served and routing
   will reject. Resolve each before flipping.

   Be honest about the limit: with no organic traffic this log covers only the
   requests you generated. It converts _observed_ traffic into a guarantee; it
   says nothing about unobserved shapes. Compensate by generating one shadow
   request per curated model, per pinned provider, before the flip — that is the
   only way the shadow log carries real weight here.

7. Every curated mapping re-confirmed `available: true` and `routable: true`
   immediately before the flip (credentials can expire between stages).

### Change procedure

```bash
cd /opt/betarouter-ai-gateway
cp .env.production .env.production.bak.$(date -u +%Y%m%dT%H%M%SZ)
sed -i 's/^PLATFORM_CATALOG_ROUTING_ENABLED=.*/PLATFORM_CATALOG_ROUTING_ENABLED=true/' .env.production
grep '^PLATFORM_CATALOG' .env.production

BETAROUTER_IMAGE=betarouter-ai-gateway-unified:845ab33-local \
BETAROUTER_PULL_POLICY=never \
docker compose -f infra/docker-compose.betarouter.yml --env-file .env.production \
  up -d --no-build betarouter
```

### Verification

The gateway caches responses **including errors** in Redis keyed on the request
body. Vary the prompt string in every check below; reusing one masks the result.

1. Health and flag audit as in Stage 4; only `ROUTING_ENABLED` changed.
2. ETag/revision convergence on both surfaces, unchanged from entry.
3. **Positive billing canary** — one controlled chat request:

   ```bash
   curl -s https://api.betarouter.com/v1/chat/completions \
     -H "Authorization: Bearer $CANARY_KEY" -H 'content-type: application/json' \
     -d '{"model":"gpt-5.5","max_tokens":16,
          "messages":[{"role":"user","content":"stage5 canary '"$(date -u +%s)"'"}]}'
   ```

   Then assert on the log row (snake_case columns):

   ```sql
   SELECT model_provider_mapping_id, catalog_revision_id, used_provider,
          input_tokens, output_tokens, cost, unified_finish_reason, cached
   FROM log ORDER BY created_at DESC LIMIT 1;
   ```

   Required: `model_provider_mapping_id = 'ceOirxBoDfCo74ShWIMZ'`,
   `catalog_revision_id` = the current revision, provider `openai`, `cached =
false`, and `cost` equal to the hand-computed fixed-price total
   (`input_tokens × 5e-6 + output_tokens × 30e-6`, cached input at `0.5e-6`).
   Any disagreement between the catalog customer price and the billed cost is an
   immediate abort — that is the one thing this stage exists to prove.

4. **Curated-model positive** — one request per curated model; each must return
   200, log a mapping ID belonging to the catalog, and carry the current
   revision.
5. **Negative: hidden model rejected.** Pick a model with `visible:false` and
   `allowDirect:false`. Expect HTTP 404, body `error.code =
"model_not_available"`, `retryable:false`.
6. **Negative: retired model returns 410.** Expect `error.code = "model_retired"`
   with `replacementModelId` and `retireAt` populated, plus `Deprecation`/
   `Sunset`/`BetaRouter-Replacement-Model` semantics on the deprecated (not
   retired) equivalent.
7. **Negative: pinned unavailable provider → retryable 503.** Requires a mapping
   that is `available: true` but not `routable` — with the breaker off, produce
   this by disabling the mapping's _routability_ while leaving a sibling mapping
   available on the same model, then:

   ```bash
   curl -si https://api.betarouter.com/v1/chat/completions \
     -H "Authorization: Bearer $CANARY_KEY" -H 'x-no-fallback: true' \
     -H 'content-type: application/json' \
     -d '{"model":"<curated>","max_tokens":16,
          "messages":[{"role":"user","content":"stage5 pin '"$(date -u +%s)"'"}]}'
   ```

   Expect 503, `error.code = "model_temporarily_unavailable"`,
   `retryable: true`, and a `retry-after: 60` header. Note the distinction:
   if **no** candidate is `available`, the correct response is 404, not 503
   (`request-policy.ts`). Assert the code, not just the status class.

8. **Fallback selection.** Repeat step 7 **without** `x-no-fallback`. Expect 200
   served by the sibling mapping; confirm the logged
   `model_provider_mapping_id` is the fallback, not the primary.
9. **Deprecation headers.** For a deprecated curated model confirm
   `Deprecation: true`, `Sunset: <UTC>`, `BetaRouter-Replacement-Model: <id>`.
10. **Non-chat unaffected.** Issue one embeddings and one moderation request;
    both must succeed on legacy routing with `model_provider_mapping_id` null.
    This proves the `isCatalogOperationEnabled` guard held.
11. **`auto` and `custom` unaffected as direct model strings** — both short-circuit
    before flag evaluation.
12. Recompute all four fingerprints; must match the entry baseline. Routing must
    not write policy.
13. Audit log: no unexpected `platform_catalog.*` rows.
14. Restore the mapping mutated in step 7 via audited inverse revision and
    re-verify the model routes normally.

### Observation window

Minimum 4 h containing ≥2 worker syncs, ≥1 bounded-stale refresh, ≥1
invalidation, ≥1 container restart, with the full negative matrix re-run once
after the restart.

Watch: rate of 404/410/503 from `error.code` values in the catalog decision
logs, `mode:"enforce"` decision lines with `allowed:false`, catalog availability
warnings, snapshot-cache warnings, and any log row where
`catalog_revision_id` is null on a chat request for a curated model (indicates
the decision path was skipped).

What synthetic traffic proves: that each decision branch (allow, 404, 410, 503,
fallback) behaves correctly and that billed cost equals catalog price for the
canary. What it cannot prove: that the curated set covers real demand, or how
enforcement behaves under concurrent load and cache contention. Accept and
record both.

Minimum synthetic evidence set: one canary billing request with a full column
assertion; one success per curated model; one each of hidden-404, retired-410,
pinned-503, fallback-200; one deprecated-headers check; one embeddings and one
moderation legacy check; the full set repeated once post-restart.

### Abort criteria

- Billed cost disagrees with the catalog customer price by any amount.
- Logged mapping ID or revision disagrees with the selected mapping.
- Any curated model returns 404/410/503.
- A negative test returns the wrong code (for example 404 where 503 is required,
  or a non-retryable 503).
- Fallback is not selected when a healthy sibling exists, or an ineligible
  mapping is routed to.
- A non-chat modality changes behaviour.
- Any policy fingerprint changes.
- Overall gateway error rate rises above the pre-flip baseline.

### Rollback

1. `PLATFORM_CATALOG_ROUTING_ENABLED=false`, redeploy same image. Restores
   legacy routing within one deploy; discovery survives.
2. If discovery is also implicated, then `DISCOVERY_ENABLED=false` and, if the
   shadow logging is implicated, `SHADOW_READ=false`.
3. For an operator-policy defect (wrong price, wrong visibility, wrong
   priority), use Admin rollback preview and the audited inverse revision.
   Prefer this over the flag flip: it is targeted and audited.
4. Previous image only for an application fault.
5. Database restore only for proven corruption, with a recorded incident
   decision.

### Stage-specific risks

| Risk                                                        | Reasoning                                                                                                                             | Mitigation                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Enforcement rejects requests the legacy path allowed        | Any uncurated model becomes 404. Shadow logs quantify this **only for observed traffic** — currently synthetic and operator-generated | Pre-flip shadow sweep: one request per curated model and pinned provider  |
| Billing disagreement between catalog price and charged cost | `applyCatalogCustomerPrices` divides policy `$/M` by 1e6 and rewrites tiers; a wrong pricing mode silently changes cost               | Fixed-price canary with hand-computed expected cost                       |
| 404/503 confusion on pinned requests                        | 503 requires a candidate that is `available` but not `routable`; policy-missing mappings yield 404                                    | Assert `error.code`, not status class                                     |
| Capability restriction surprises                            | `disabledCapabilities` is applied as `false` flags onto the provider mapping, so routing can strip a capability legacy allowed        | Include a capability-sensitive request per curated model where applicable |
| Context/output silently clamped                             | `contextSizeLimit`/`maxOutputLimit` take the `min` with the source values                                                             | Verify the effective limits for each curated model against intent         |
| Auto-routing narrows unexpectedly                           | `filterAutoCandidateByCatalog` swallows 404/410/503 into an empty candidate list                                                      | Issue one `auto` request and confirm a curated mapping is selected        |

---

## Stage 6a: breaker observe

Target: `PLATFORM_CATALOG_BREAKER_MODE=observe`. Discovery and routing stay
`true`.

Observe is not inert. `reportCatalogOutcome` fires whenever `breakerMode !==
"off"`, so observe **accumulates real circuit state in Redis** and writes
`platform_catalog.circuit_open` / `circuit_close` audit rows plus
`platform_mapping_health_summary` rows. It simply does not apply that state to
routing (`runtime.ts:152-159` returns the snapshot untouched unless
`enforce`).

### Entry gate

1. Stage 5 closed and approved with a clean window.
2. Revision/checksum/ETag stable and equal on both surfaces.
3. Fingerprints match the Stage 5 baseline.
4. Fresh gzip-verified backup; rollback image marker confirmed.
5. Flag audit: `DISCOVERY_ENABLED=true`, `ROUTING_ENABLED=true`,
   `BREAKER_MODE=off`.
6. Confirm no residual breaker keys exist for the current revision:

   ```bash
   docker compose -f infra/docker-compose.betarouter.yml --env-file .env.production \
     exec betarouter redis-cli --scan --pattern "platform-catalog:breaker:*"
   ```

   Expect empty. Keys are revision-scoped
   (`platform-catalog:breaker:{revision}:{mappingId}`, 7-day TTL), so any hit
   from an older revision is inert but should be recorded.

### Change procedure

```bash
cd /opt/betarouter-ai-gateway
cp .env.production .env.production.bak.$(date -u +%Y%m%dT%H%M%SZ)
sed -i 's/^PLATFORM_CATALOG_BREAKER_MODE=.*/PLATFORM_CATALOG_BREAKER_MODE=observe/' .env.production
grep '^PLATFORM_CATALOG' .env.production

BETAROUTER_IMAGE=betarouter-ai-gateway-unified:845ab33-local \
BETAROUTER_PULL_POLICY=never \
docker compose -f infra/docker-compose.betarouter.yml --env-file .env.production \
  up -d --no-build betarouter
```

### Verification

1. Health and flag audit; only `BREAKER_MODE` changed.
2. Routing behaviour byte-identical to Stage 5: re-run the Stage 5 canary
   billing request and the full negative matrix. Observe must change nothing on
   the request path.
3. Success accumulation: after the canary request, confirm a key exists with
   `state: "closed"` and a growing `window`:

   ```bash
   docker compose -f infra/docker-compose.betarouter.yml --env-file .env.production \
     exec betarouter redis-cli GET "platform-catalog:breaker:<N>:ceOirxBoDfCo74ShWIMZ"
   ```

4. Customer errors do not count: send a deliberately malformed request
   (client 4xx) against a curated model and confirm `consecutiveFailures` does
   not increase — `customer_error` is skipped by the Lua script.
5. Cached responses do not count: repeat an identical body and confirm the
   window does not grow (`logs.ts` skips `cached`).
6. **Controlled would-open drill** on a dedicated throwaway mapping — never on a
   curated launch mapping. Induce ≥5 consecutive upstream failures (revoke or
   point the credential at an unreachable endpoint), confirm the key reaches
   `state: "open"` with `openedAt`/`retryAt`/`openCount`, confirm a
   `platform_catalog.circuit_open` audit row with `user_id = 'system'` and a
   `platform_mapping_health_summary` row, and confirm **routing to that mapping
   is unchanged** because enforce is off.
7. Health summaries render in Admin for the affected mapping.
8. Fingerprints unchanged. Breaker state is Redis + audit/health rows only; it
   must not touch policy tables.

### Observation window

Minimum 24 h containing ≥2 worker syncs, ≥1 invalidation, ≥1 restart, and the
would-open drill plus its recovery. The 24 h floor exists because cooldown is
exponential (`baseCooldownMs` 60 s, `maxCooldownMs` 15 min) and half-open
requires `successfulProbesToClose = 2` — a shorter window cannot demonstrate the
full cycle.

Watch: every `circuit_open` audit row (each must have an explained cause), the
set of mappings with non-closed state, `openCount` growth, and any open circuit
on a curated launch mapping — the last is an abort for Stage 6b readiness, not
necessarily for 6a.

What synthetic traffic proves: the state machine transitions and the recording
path. What it cannot prove: whether the thresholds (5 consecutive failures, 0.5
failure rate over a 20-request window, `minimumRequests` 5) are correctly tuned
for real traffic. With a handful of synthetic requests per mapping, a single
transient upstream blip can trip a circuit that real volume would have absorbed.
Record this as the principal residual risk of Stage 6b.

Minimum synthetic evidence set: one closed-state accumulation; one customer-error
non-count; one cached non-count; one full open → cooldown → half-open →
two successful probes → closed cycle on the throwaway mapping; one audited
operator reset; unchanged routing throughout.

### Abort criteria

- Routing behaviour changes at all under observe.
- A circuit opens on a curated launch mapping without an explained upstream
  cause.
- `circuit_open` audit rows or health summaries are missing after a proven
  transition.
- Breaker recording raises errors in the gateway logs
  (`Failed to record catalog breaker outcome`).
- Any policy fingerprint changes.

### Rollback

1. `PLATFORM_CATALOG_BREAKER_MODE=off`, redeploy same image. Recording stops
   immediately; accumulated Redis state ages out on its 7-day TTL and is inert
   while off.
2. Then routing off, then discovery/shadow off, if the fault is broader.

### Stage-specific risks

| Risk                                                          | Reasoning                                                                                           | Mitigation                                              |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Observe silently builds state that becomes live at 6b         | Recording is unconditional above `off`; `withRuntimeBreakers` applies it the instant enforce is set | Mandatory pre-enforce state review and reset (Stage 6b) |
| Drill leaves a durable open circuit with inflated `openCount` | `openCount` persists and multiplies cooldown up to 15 min; it clears only on a full close or reset  | Drill on a throwaway mapping; reset before 6b           |
| Audit-log volume from flapping circuits                       | Every open/close transition writes an audit row and a health-summary row                            | Watch transition counts; investigate any flapping       |

---

## Stage 6b: breaker enforce

Target: `PLATFORM_CATALOG_BREAKER_MODE=enforce`.

### Mandatory pre-enforce breaker-state reset

**A breaker-state review and reset is required before the enforce flip.** This
is a hard gate, not a recommendation.

Reasoning from the code: breaker state persists in Redis for 7 days keyed by
revision, and observe accumulates it with no request-path effect. At the moment
`enforce` is set, `withRuntimeBreakers` (`runtime.ts:152-159`) reads that state
and sets `routable: false` for every non-closed mapping in the same request.
A circuit opened hours earlier — including by the Stage 6a drill — instantly
removes its mapping with no failing request having occurred after the flip. If
that mapping is a model's only candidate, the model goes from 200 to 503 the
instant the container comes up, and the exponential `openCount` cooldown means
it can stay that way for up to 15 minutes before the first probe is even
claimed. Under synthetic-only traffic the accumulated sample is tiny and
unrepresentative, so the probability that an open circuit reflects a real
persistent fault is low and the probability it reflects a drill or a transient
is high.

Reset procedure — for every mapping whose state is not `closed`:

1. Re-run its mapping test in Admin and confirm it passes.
2. Reset via the audited endpoint
   `POST /admin/catalog/mappings/{id}/breaker/reset`, which returns 409 unless a
   currently passing mapping test exists and the mapping has no
   `mapping_test_required` reason, and which writes
   `platform_catalog.circuit_close` with `manual: true`.

Do **not** clear state with a bare `redis-cli DEL`. That bypasses the
mapping-test re-proof and leaves no audit row; the 409 guard exists precisely to
stop a circuit from being cleared on a mapping that is still broken.

A revision bump also orphans all prior keys, since they are revision-scoped.
Treat that as an incidental effect, not the reset mechanism — it is untargeted
and gives no per-mapping health evidence.

### Entry gate

1. Stage 6a closed and approved; window clean.
2. Revision/checksum/ETag stable and equal on both surfaces.
3. Fingerprints match baseline.
4. Fresh gzip-verified backup; rollback image marker confirmed.
5. Flag audit: `BREAKER_MODE=observe`, routing and discovery `true`.
6. **Zero non-closed breaker keys at the current revision**, verified:

   ```bash
   docker compose -f infra/docker-compose.betarouter.yml --env-file .env.production \
     exec betarouter sh -c \
     'for k in $(redis-cli --scan --pattern "platform-catalog:breaker:<N>:*"); do \
        echo "$k $(redis-cli GET $k)"; done'
   ```

   Every entry must report `"state":"closed"`, or the key must be absent.

7. Every curated launch mapping has a currently passing mapping test.
8. The Stage 6a review is written down: every `circuit_open` audit row in the
   window is explained, and no explanation is "unknown".

### Change procedure

```bash
cd /opt/betarouter-ai-gateway
cp .env.production .env.production.bak.$(date -u +%Y%m%dT%H%M%SZ)
sed -i 's/^PLATFORM_CATALOG_BREAKER_MODE=.*/PLATFORM_CATALOG_BREAKER_MODE=enforce/' .env.production
grep '^PLATFORM_CATALOG' .env.production

BETAROUTER_IMAGE=betarouter-ai-gateway-unified:845ab33-local \
BETAROUTER_PULL_POLICY=never \
docker compose -f infra/docker-compose.betarouter.yml --env-file .env.production \
  up -d --no-build betarouter
```

### Verification

1. Health and flag audit; only `BREAKER_MODE` changed.
2. **Immediately** after the container is healthy, one request per curated model
   plus the canary. All must return 200. Any 503 here means residual state was
   applied — abort and go to rollback.
3. Re-run the Stage 5 negative matrix; all codes unchanged.
4. Full cycle drill on the throwaway mapping:

   | Step           | Action                                         | Expected                                                                          |
   | -------------- | ---------------------------------------------- | --------------------------------------------------------------------------------- |
   | Open           | Induce ≥5 consecutive upstream failures        | Key `state: "open"`; `circuit_open` audit row                                     |
   | Removed        | Pin that provider with `x-no-fallback`         | 503 `model_temporarily_unavailable`, `retry-after: 60`                            |
   | Fallback       | Same model without `x-no-fallback`             | 200 from the sibling mapping; logged mapping ID is the sibling                    |
   | Half-open      | Wait past `retryAt`, send one request          | `probeClaimed`, `probeOnly: true`; exactly one probe admitted                     |
   | Close          | Two successful probes                          | Key resets to `closed`, `openCount: 0`; `circuit_close` audit row                 |
   | Operator reset | Open again, pass a mapping test, POST reset    | 200; `platform_catalog.circuit_close` with `manual: true`; mapping routable again |
   | Reset guard    | POST reset on a mapping without a passing test | 409                                                                               |

5. Confirm `filterProviderMappingsByCatalog` preserved fallback ordering:
   priority ascending, then weight descending, then mapping ID.
6. Confirm a breaker-open mapping does **not** remove the model from discovery
   — `displayable` is independent of `routable`, so `/v1/models` should still
   list it. Verify this is the intended behaviour before closing.
7. Non-chat unaffected; video-job outcome recording is recording-only and must
   not alter video routing.
8. Fingerprints unchanged.

### Observation window

Minimum 1 h post-flip plus the completed cycle drill, then a further 24 h at
steady state containing ≥2 worker syncs, ≥1 invalidation, ≥1 restart.

Watch: every `circuit_open` on a curated mapping, 503 rate, probe-claim
warnings, `openCount` above 1 on any curated mapping, and any mapping that
remains non-closed for more than one cooldown period.

Synthetic traffic here is at its weakest. It can demonstrate the state machine
but it cannot calibrate the thresholds, and with tiny request counts a single
upstream blip reaches `minimumRequests: 5` and `consecutiveFailureThreshold: 5`
far more easily than it would under real volume. Treat any curated-mapping open
during this window as a tuning signal, not noise.

### Abort criteria

- Any curated model returns 503 immediately after the flip.
- A circuit opens on a curated mapping without a confirmed upstream fault.
- A breaker-open mapping removes a model that has a healthy sibling mapping
  (fallback failure).
- Probes are admitted in unbounded numbers rather than one per lease.
- The operator reset endpoint fails on a mapping with a currently passing test,
  or succeeds on one without.
- Any policy fingerprint changes.

### Rollback

1. `PLATFORM_CATALOG_BREAKER_MODE=off` (not `observe` — off stops recording as
   well), redeploy same image. Breaker state stops being applied immediately.
2. Then `ROUTING_ENABLED=false` if routing is implicated.
3. Then `DISCOVERY_ENABLED=false` and `SHADOW_READ=false` if discovery is
   implicated.
4. Audited inverse revision for an operator-policy defect.
5. Previous image for an application fault.
6. Database restore only for proven corruption, with a recorded incident
   decision.

### Stage-specific risks

| Risk                                                           | Reasoning                                                                                                             | Mitigation                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Stale open circuits remove mappings the instant enforce is set | `withRuntimeBreakers` applies persisted Redis state on the first request after the flip                               | Mandatory pre-enforce reset gate; immediate post-flip 200 check |
| Thresholds mis-tuned for low volume                            | `minimumRequests: 5` and a 20-request window are trivially satisfied by synthetic traffic                             | Treat any curated open as a tuning signal; keep 6a data         |
| Single-mapping models have no fallback                         | An open circuit on a sole mapping yields 503 for the whole model                                                      | Inventory single-mapping curated models before the flip         |
| Probe re-fetch only under `routing && enforce`                 | `catalog-policy.ts:169-177` claims probes only in this combination; testing probes at any earlier stage is impossible | Probe behaviour is verified here for the first time             |
| Breaker failures degrade silently                              | `withRuntimeBreakers` swallows errors and returns the unmodified snapshot; recording errors are logged only           | Alert on `Failed to record catalog breaker outcome`             |

---

## Enforcement-complete closure audit

Perform once, after the Stage 6b window closes, before declaring the rollout
complete. Mirrors the shadow completion audit in
`docs/admin-model-catalog-operations.md`. All checks are read-only.

Record, in `docs/verification-admin-model-catalog-launch.md` or a successor
dossier:

1. **Flag state.** `SHADOW_READ`, `DISCOVERY_ENABLED=true`,
   `ROUTING_ENABLED=true`, `BREAKER_MODE=enforce`, verified in the running
   container by both the compose environment and the live gateway process.
2. **Revision identity.** Final revision ID, checksum, provider/model/mapping
   counts, total immutable revision-row count, and the identical weak ETag from
   Gateway `/v1/models` and Platform `/internal/models`.
3. **Policy fingerprints.** All four recomputed with the canonical runbook SQL,
   with the row counts and values as of closure, plus the delta from the
   revision-40 launch baseline and the change-set that explains each delta.
4. **Curated set.** The final list of visible models, available models, and
   routable mappings, and the count of single-mapping models with no fallback.
5. **Billing proof.** The canary request's mapping ID, catalog revision,
   provider, token counts, catalog customer price, billed cost, and the
   hand-computed expected cost, shown to agree exactly.
6. **Negative matrix results.** Hidden-404, retired-410, pinned-503 with
   `retry-after`, fallback-200, deprecation headers — each with the observed
   `error.code`.
7. **Breaker cycle evidence.** Open, removal, fallback, half-open probe claim,
   two-probe close, audited operator reset, and the 409 reset guard, each with
   its audit row.
8. **Audit-log inventory** for the whole rollout: counts of
   `platform_catalog.preview`, `apply`, `rollback`, `source_refresh`,
   `mapping_test`, `circuit_open`, `circuit_close` (system and manual), with
   every `circuit_open` explained.
9. **Stage timeline.** Per stage: UTC flip time, approving operator, soak
   duration, events covered (worker syncs, invalidations, restarts), and abort
   criteria triggered.
10. **Non-chat invariance.** Confirmation that embeddings, moderation, OCR,
    speech, image, and video remained on legacy routing throughout, with the
    supporting requests.
11. **Infrastructure health.** Container, all ten Supervisor processes,
    PostgreSQL, Redis, worker, Cloudflare Tunnel, all four public roots at 200,
    and Droplet disk headroom.
12. **Backup and rollback artifacts.** Per-stage backup filenames, sizes,
    SHA-256 values, gzip integrity results, and the recorded rollback image
    reference.
13. **Residual risk statement.** Explicit, signed: the entire rollout was
    validated on synthetic operator-generated traffic. Concurrency behaviour,
    probe-claim races under parallel load, snapshot-cache behaviour under
    contention, breaker threshold calibration, and curated-set fit to real
    demand are **unproven**. Define the first-organic-traffic review that closes
    them, including the trigger volume and the metrics to re-check.
14. **Acceptance-criteria matrix update.** Every criterion currently marked
    "Held for rollout" (3, 14, 15, 16, 17, 18) moved to a final status with its
    production evidence.
