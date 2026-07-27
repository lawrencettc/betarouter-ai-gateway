# Enforcement-complete closure audit (template)

Status: TEMPLATE — fill every `____` during the audit; do not declare the
rollout complete while any field is blank or any Recorded value deviates from
Expected without a written explanation.
Implements: the closure audit defined in
`docs/plan-catalog-enforcement-rollout.md`; launch set per
`docs/proposal-catalog-launch-set.md`; operations per
`docs/change-set-catalog-launch.md`.

Audit date (UTC): ____
Auditor: ____
Approving operator: ____

All checks are read-only. Perform after the Stage 6b observation window
closes.

## 1. Flag state

Verify in BOTH the compose environment and the live gateway process (commands
in the rollout plan, Stage 4 entry gate).

| Flag                                 | Expected  | Compose env | Live process |
| ------------------------------------ | --------- | ----------- | ------------ |
| `PLATFORM_CATALOG_SHADOW_READ`       | `true`\*  | ____        | ____         |
| `PLATFORM_CATALOG_DISCOVERY_ENABLED` | `true`    | ____        | ____         |
| `PLATFORM_CATALOG_ROUTING_ENABLED`   | `true`    | ____        | ____         |
| `PLATFORM_CATALOG_BREAKER_MODE`      | `enforce` | ____        | ____         |

\* Shadow stays `true` through Stage 5 for decision logs. If the operator
turned it off after Stage 6b, record `false` and the decision reference.

## 2. Revision identity

| Item                              | Expected                                                             | Recorded |
| --------------------------------- | -------------------------------------------------------------------- | -------- |
| Final revision ID                 | ≥ 45 (see revision ledger below)                                     | ____     |
| Checksum (`sha256:v2:`)           | matches both surfaces                                                | ____     |
| Provider / model / mapping counts | 41 / 312 / 664 unless a source sync added entries; explain any delta | ____     |
| Total immutable revision rows     | 8 (launch baseline) + one per ledger row below                       | ____     |
| Gateway `/v1/models` ETag         | `W/"catalog-<N>-<last16>"`, HTTP 200                                 | ____     |
| Platform `/internal/models` ETag  | identical to gateway                                                 | ____     |

Revision ledger — every revision after 40 must appear here with its audited
cause. Expected minimum sequence (source syncs that publish revisions add
more; list them all):

| Revision | Expected cause                                                        | Audit action                      | Recorded |
| -------- | --------------------------------------------------------------------- | --------------------------------- | -------- |
| 41       | Stage 3.5 launch change set (59 ops)                                  | `platform_catalog.apply`          | ____     |
| 42       | Stage 5 entry: canary republication (enabled + `allowDirect`, hidden) | `platform_catalog.apply`          | ____     |
| 43       | Stage 5 fallback-test prep (enable one sibling mapping — see §6 note) | `platform_catalog.apply`          | ____     |
| 44       | Stage 5 step 7: disable routability of the pinned-test mapping        | `platform_catalog.apply`          | ____     |
| 45       | Stage 5 step 14: audited inverse restore of that mapping              | `platform_catalog.rollback`       | ____     |
| +        | Stage 6a/6b throwaway-mapping curation and cleanup, retired-test prep | `platform_catalog.apply`/rollback | ____     |

## 3. Policy fingerprints

Recompute with the canonical SQL in `docs/admin-model-catalog-operations.md`
(shadow completion audit step 3). Expected row counts after the launch change
set (canary rows + launch operations), before any 6a/6b throwaway additions:

| Table                           | Launch-baseline rows (rev 40) | Expected after Stage 3.5 | Recorded rows | Recorded fingerprint |
| ------------------------------- | ----------------------------: | -----------------------: | ------------- | -------------------- |
| `platform_provider_policy`      |                             1 |                       24 | ____          | ____                 |
| `platform_model_policy`         |                             1 |                       13 | ____          | ____                 |
| `platform_mapping_policy`       |                             1 |                       13 | ____          | ____                 |
| `platform_mapping_price_policy` |                             1 |                       13 | ____          | ____                 |

Each count delta beyond these (fallback enables, throwaway mapping, retired
test target) must map to a ledger row in §2. Every fingerprint change since
revision 40 must be explained by an audited change set — none by drift.

## 4. Curated set

| Item                                | Expected                                                                                                                    | Recorded |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------- |
| Visible models                      | the 12 launch models; +gpt-5.5 if its post-Stage-5 change set was applied                                                   | ____     |
| Available models                    | same as visible (every launch mapping `available: true`)                                                                    | ____     |
| Routable mappings                   | 12 primaries (+canary, +any enabled fallbacks per §2 ledger)                                                                | ____     |
| Single-mapping models (no fallback) | 11 on the minimum-viable path (all but the §6 fallback-test model) — record each; these are the Stage 6b exposure inventory | ____     |

## 5. Billing proof (Stage 5 canary)

| Item                  | Expected                                     | Recorded |
| --------------------- | -------------------------------------------- | -------- |
| Model / mapping       | `gpt-5.5` / `ceOirxBoDfCo74ShWIMZ`           | ____     |
| Provider              | `openai`                                     | ____     |
| `catalog_revision_id` | revision current at request time             | ____     |
| Input / output tokens | from the log row                             | ____     |
| Expected cost formula | `input×5e-6 + output×30e-6` (+cached×0.5e-6) | ____     |
| Billed `cost`         | equals the formula EXACTLY                   | ____     |
| `cached`              | `false`                                      | ____     |

## 6. Negative matrix results

Record the observed `error.code` (assert codes, not status classes):

| Test                | Target                                                                                                           | Expected                                                                  | Recorded |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------- |
| Hidden model        | any uncurated model (e.g. `mistral-large-latest`)                                                                | 404 `model_not_available`, `retryable: false`                             | ____     |
| Retired model       | `gemini-3-pro-preview` (requires a change set setting its model policy `lifecycle: "retired"` first — ledger it) | 410 `model_retired` with `replacementModelId`, `retireAt`                 | ____     |
| Pinned unavailable  | curated model, `x-no-fallback`, mapping made non-routable                                                        | 503 `model_temporarily_unavailable`, `retryable: true`, `retry-after: 60` | ____     |
| Fallback selection  | same model, no `x-no-fallback`                                                                                   | 200 via sibling; logged mapping ID = sibling                              | ____     |
| Deprecation headers | a deprecated curated model (if none, mark N/A with reason)                                                       | `Deprecation: true`, `Sunset`, `BetaRouter-Replacement-Model`             | ____     |

NOTE (pre-filled from the launch design): on the minimum-viable path every
launch model has ONE routable mapping, so the pinned-503 and fallback-200
tests are impossible until at least one sibling mapping is enabled. Expected
prep: enable `deepseek-v4-pro/deepinfra` (deepinfra credential is already in
the minimum-viable set) as revision 43 in the §2 ledger, and run both tests
against `deepseek-v4-pro`.

## 7. Breaker cycle evidence (Stage 6a/6b drill, throwaway mapping)

| Step             | Expected                                                              | Audit row                                       | Recorded |
| ---------------- | --------------------------------------------------------------------- | ----------------------------------------------- | -------- |
| Open             | ≥5 consecutive upstream failures → key `state:"open"`                 | `platform_catalog.circuit_open` (`system`)      | ____     |
| Removed          | pinned request → 503, `retry-after: 60`                               | —                                               | ____     |
| Fallback         | unpinned → 200 via sibling                                            | —                                               | ____     |
| Half-open probe  | past `retryAt`: exactly one probe claimed (`probeOnly: true`)         | —                                               | ____     |
| Close            | two successful probes → `closed`, `openCount: 0`                      | `platform_catalog.circuit_close`                | ____     |
| Operator reset   | re-open, passing mapping test, POST reset → 200                       | `platform_catalog.circuit_close` `manual: true` | ____     |
| Reset guard      | reset without passing test → 409                                      | — (rejected)                                    | ____     |
| Pre-enforce gate | zero non-closed keys at flip time; post-flip: every curated model 200 | —                                               | ____     |

## 8. Audit-log inventory (whole rollout window)

| Action                                  | Expected                                    | Count |
| --------------------------------------- | ------------------------------------------- | ----- |
| `platform_catalog.preview`              | ≥1 per applied change set                   | ____  |
| `platform_catalog.apply`                | = apply rows in the §2 ledger               | ____  |
| `platform_catalog.rollback`             | = rollback rows in the §2 ledger            | ____  |
| `platform_catalog.source_refresh`       | per operator refreshes                      | ____  |
| `platform_catalog.mapping_test`         | ≥13 (12 launch + canary; more with retests) | ____  |
| `platform_catalog.circuit_open`         | every row explained (no "unknown")          | ____  |
| `platform_catalog.circuit_close` system | drill closes                                | ____  |
| `platform_catalog.circuit_close` manual | operator resets (`manual: true`)            | ____  |

## 9. Stage timeline

| Stage | Flip time (UTC) | Approving operator | Soak duration | Events covered (syncs / invalidations / restarts) | Aborts triggered |
| ----- | --------------- | ------------------ | ------------- | ------------------------------------------------- | ---------------- |
| 3.5   | ____            | ____               | n/a           | n/a                                               | ____             |
| 4     | ____            | ____               | ≥2 h          | ≥2 / ≥1 / ≥1: ____                                | ____             |
| 5     | ____            | ____               | ≥4 h          | ≥2 / ≥1 / ≥1: ____                                | ____             |
| 6a    | ____            | ____               | ≥24 h         | ≥2 / ≥1 / ≥1: ____                                | ____             |
| 6b    | ____            | ____               | ≥1 h + 24 h   | ≥2 / ≥1 / ≥1: ____                                | ____             |

## 10. Non-chat invariance

One request per modality during the window; expected: success on legacy
routing with `model_provider_mapping_id` NULL in the log row.

| Modality   | Expected                                             | Recorded |
| ---------- | ---------------------------------------------------- | -------- |
| Embeddings | 200, mapping ID null                                 | ____     |
| Moderation | 200, mapping ID null                                 | ____     |
| Speech     | legacy path, unchanged                               | ____     |
| OCR        | legacy path, unchanged                               | ____     |
| Image      | legacy path, unchanged                               | ____     |
| Video      | job runs; breaker recording only (no routing change) | ____     |

## 11. Infrastructure health

| Check                                           | Expected        | Recorded |
| ----------------------------------------------- | --------------- | -------- |
| Supervisor processes                            | all 10 up       | ____     |
| Unified container / PostgreSQL / Redis / worker | healthy         | ____     |
| Cloudflare Tunnel                               | healthy         | ____     |
| betarouter.com / api. / platform-api. / admin.  | all HTTP 200    | ____     |
| Droplet disk headroom                           | recorded GB / % | ____     |

## 12. Backup and rollback artifacts

One backup per stage entry gate, under `/opt/betarouter-backups`:

| Stage | Filename | Size | SHA-256 | gzip -t |
| ----- | -------- | ---- | ------- | ------- |
| 3.5   | ____     | ____ | ____    | ____    |
| 4     | ____     | ____ | ____    | ____    |
| 5     | ____     | ____ | ____    | ____    |
| 6a    | ____     | ____ | ____    | ____    |
| 6b    | ____     | ____ | ____    | ____    |

Rollback image reference at closure: expected `betarouter-ai-gateway-unified:845ab33-local`
unless a deploy superseded it mid-rollout (which the plan forbids without
restarting the affected stage — explain any change): ____

## 13. Residual risk statement (pre-filled; sign, don't soften)

The entire enforcement rollout was validated on synthetic, operator-generated
traffic. The following remain UNPROVEN and are accepted as residual risk:

- Concurrency behaviour of catalog enforcement under parallel request load.
- The breaker probe-claim path under racing concurrent requests.
- Snapshot-cache behaviour under contention/stampede.
- Breaker threshold calibration (`minimumRequests: 5`, 5 consecutive
  failures, 0.5 failure rate over a 20-request window) against real traffic
  distributions — synthetic volumes trip these far more easily than
  production volume would.
- Fit of the 12-model curated set to actual customer demand.
- Single-mapping exposure: ____ of 12 launch models have no routable
  fallback until further credentials are validated (§4).

First-organic-traffic review — trigger: ____ (define a threshold, e.g. first
7 consecutive days with ≥100 organic chat requests/day). Re-check: breaker
open/close counts vs traffic, 404 rate on uncurated model requests (demand
signal for fast-follows), decision-log volume, snapshot-cache warning rate,
margin on real usage mix.

Signed (operator): ____ Date: ____

## 14. Acceptance-criteria matrix update

Move these rows in `docs/verification-admin-model-catalog-launch.md` from
"Held for rollout" to their final status with the evidence recorded above:

| #   | Criterion                                                    | Expected final status                                          | Evidence section |
| --- | ------------------------------------------------------------ | -------------------------------------------------------------- | ---------------- |
| 3   | All customer discovery surfaces use one effective revision   | Production proven                                              | §2               |
| 14  | Breaker removes only affected mapping, preserves fallback    | Production proven                                              | §7               |
| 15  | No fallback returns retryable 503 without ineligible routing | Production proven                                              | §6               |
| 16  | Scheduled changes apply once or fail atomically when stale   | Held or proven — record which (scheduled rollout was optional) | §8               |
| 17  | Deprecation exposes retirement and replacement metadata      | Production proven                                              | §6               |
| 18  | Retired models return 410 and disappear from discovery       | Production proven                                              | §6               |

Also update criterion 20's breaker-reset clause (operator reset audited) from
"held for rollout" using §7.
