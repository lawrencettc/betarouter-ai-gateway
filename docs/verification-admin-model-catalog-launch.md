# Admin Model Catalog launch verification

Date: 2026-07-23
Production revision: 40
Production image: `betarouter-ai-gateway-unified:845ab33-local`

This dossier records the launch evidence for the Admin Model Catalog and source-revision reconciliation work. It is intentionally scoped to the deployed shadow stage. Customer discovery, catalog routing, and breaker enforcement must remain disabled until a separate operator-approved rollout.

## Rollout invariants

| Control                              | Required state | Verified state                                                                      |
| ------------------------------------ | -------------- | ----------------------------------------------------------------------------------- |
| `PLATFORM_CATALOG_SHADOW_READ`       | `true`         | `true`                                                                              |
| `PLATFORM_CATALOG_DISCOVERY_ENABLED` | `false`        | `false`                                                                             |
| `PLATFORM_CATALOG_ROUTING_ENABLED`   | `false`        | `false`                                                                             |
| `PLATFORM_CATALOG_BREAKER_MODE`      | `off`          | `off`                                                                               |
| Non-chat modalities                  | Legacy routing | Covered by `catalog-policy.spec.ts` and unchanged production flags                  |
| Multi-operator permissions           | Deferred       | No new role-management UI; existing platform-admin middleware remains authoritative |

The planned shadow window started with revision 40 at `2026-07-22T19:42:54Z`. At `2026-07-22T20:58:44Z`, the operator approved closing the wall-clock observation early because BetaRouter has no production users generating representative traffic. The accepted evidence is therefore controlled read-only discovery traffic, one controlled shadow routing decision, repeated worker synchronization cycles, and the final production audit below. This exception does not authorize discovery, routing, or breaker enforcement.

## Deployed reconciliation evidence

- PR #13 fixed persisted inverse-operation compatibility for audited rollback.
- PR #14 deployed canonical key-sorted `sha256:v2:` checksums and guarded legacy JSONB compatibility.
- Worker source synchronization, source-revision publication, and invalidation execute in one transaction under an advisory lock.
- Revision 40 contains 41 providers, 312 models, and 664 mappings at checksum `sha256:v2:772202412b45d5d416b1af6b49ae1aa62bf09b2d5318f5dd5d040fb7cb1086e7`.
- A manual authenticated Admin source refresh returned `changed=false`, stayed on revision 40, and wrote a successful `platform_catalog.source_refresh` audit row with `beforeRevision=40` and `resource_id=revision:40`.
- A later production worker sync advanced source `updated_at` to `2026-07-22T20:23:04Z` while revision stayed at 40 and all policy fingerprints remained unchanged.

### Reconciliation implementation traceability

- `packages/catalog/src/catalog-store.ts` computes published/current checksums, source-ahead status, source timestamps, and published/current provider/model/mapping counts. Its drift cases are covered by `packages/catalog/src/catalog.spec.ts`.
- The same store publishes source changes under the catalog advisory lock, uses a checksum-bound idempotency key, creates one immutable revision, and publishes cache invalidation only after transaction commit.
- `apps/worker/src/services/sync-models.ts` performs source synchronization and revision publication in one transaction under the same advisory lock. `apps/worker/src/services/sync-models.spec.ts` proves new provider/model/mapping rows enter a newer revision, existing policies survive, and a repeated identical sync is idempotent.
- `apps/api/src/routes/platform-catalog.ts` exposes revision status and `POST /admin/catalog/source/refresh`. The refresh route records successful audit metadata inside the publication transaction and makes a best-effort failure audit without hiding the original error; route security coverage rejects anonymous and untrusted operators.
- `ee/admin/src/app/catalog/catalog-client.tsx` renders **Current** versus **Refresh required**, blocks the refresh button while current, warns against tests/activation on stale state, invokes the authenticated refresh route, and reloads the effective catalog after completion.
- Production closes the successful-route evidence seam: the authenticated no-op refresh returned the expected response and persisted the matching successful audit row without changing revision 40.

### Operator-policy fingerprints

| Table                           | Rows | Baseline fingerprint               |
| ------------------------------- | ---: | ---------------------------------- |
| `platform_provider_policy`      |    1 | `0b0e461b1a50232c02705fe4df56ae55` |
| `platform_model_policy`         |    1 | `cc9a2fc7016fadf47dfa2392bf9f9f42` |
| `platform_mapping_policy`       |    1 | `03ed0c4cac53ff3a6d08113ccf69e74c` |
| `platform_mapping_price_policy` |    1 | `6ef8eeb1c4bed3fa08bd0587ab0295fe` |

The closing audit must recompute these fingerprints at the end of the observed
shadow period, including when the remaining wall-clock duration is explicitly
waived by the operator.
The canonical SQL now documented in the operations runbook was executed verbatim against production and returned all four baseline values above.

## Shadow observation snapshots

| Observed at (UTC)      | Revision | Gateway model comparisons | Internal discovery comparisons | Routing decisions | Catalog availability warnings | Catalog-specific errors | Policy fingerprints  |
| ---------------------- | -------: | ------------------------: | -----------------------------: | ----------------: | ----------------------------: | ----------------------: | -------------------- |
| `2026-07-22T20:33:22Z` |       40 |                         3 |                             51 |                 1 |                             0 |                       0 | Exact baseline match |
| `2026-07-22T20:41:04Z` |       40 |                         5 |                             58 |                 1 |                             0 |                       0 | Exact baseline match |
| `2026-07-22T20:58:44Z` |       40 |                         6 |                             76 |                 1 |                             0 |                       0 | Exact baseline match |

The snapshot above covers the preceding 60 minutes. At the same observation, all ten Supervisor processes were running, the unified container was healthy, all four public service roots returned HTTP 200, and the catalog remained at checksum `sha256:v2:772202412b45d5d416b1af6b49ae1aa62bf09b2d5318f5dd5d040fb7cb1086e7` with 41 providers, 312 models, and 664 mappings. These are interval observations, not a substitute for the final full-window audit.

The hourly shadow monitor also performs exactly one unauthenticated, read-only GET against Gateway `/v1/models` and Platform `/internal/models`. Both surfaces must return HTTP 200 and the same revision-40 ETag; the monitor sends no credential and performs no state mutation. This supplies continuous cache-propagation evidence without enabling catalog discovery enforcement or creating billable model traffic.

At the second observation, the worker had advanced the latest synchronized-source timestamp to `2026-07-22T20:41:04Z`. Revision count remained eight, latest revision remained 40, and every policy fingerprint still matched. This is a second production synchronization cycle that updated source metadata without rewriting operator policy or emitting a duplicate immutable revision.

At the final early-close observation, source synchronization advanced again to `2026-07-22T20:58:04Z`. Revision count remained eight, latest revision remained 40, and every policy fingerprint still matched. All ten Supervisor processes and both containers were running, all public service checks returned HTTP 200, and Gateway plus Platform returned the same `W/"catalog-40-5d040fb7cb1086e7"` ETag.

## Canary evidence

- Model: `gpt-5.5`
- Provider: `openai`
- Mapping: `ceOirxBoDfCo74ShWIMZ`
- Saved encrypted credential: configured, validated, and referenced by immutable credential ID only
- Mapping test: passed through the production adapter path using the exact saved credential configuration
- Policy: customer-hidden, direct access disabled, mapping priority 100, weight 0
- Fixed customer prices: input `$5/M`, output `$30/M`, cached input `$0.5/M`, request `$0`, web search `$0.01`
- Negative margin override: disabled
- Hidden-canary revision 37 was audited, rolled back into revision 38, and reapplied into revision 39. Source reconciliation then produced revision 40 without changing operator policy.
- API, Gateway `/v1/models` ETag, and Platform `/internal/models` converge on revision 40 and the same checksum.

Routing-enforcement billing is deliberately not exercised in this stage. Billing metadata and linkage are verified in the revision snapshot and schema: the exact mapping, catalog revision, credential ID, customer prices, and margin are present; usage logs have `model_provider_mapping_id` and `catalog_revision_id` foreign-key columns.

## Fresh focused test evidence

| Area                                                                                |         Result |
| ----------------------------------------------------------------------------------- | -------------: |
| Catalog policy, contracts, pricing, cache, request policy, runtime, Admin APIs      |   66/66 passed |
| Database-backed worker source synchronization and policy preservation               |   10/10 passed |
| Gateway policy/discovery, scheduler, health summary, Admin canary operation builder |   30/30 passed |
| Total                                                                               | 106/106 passed |

The database-backed reconciliation regression proves that a new provider, model, and mapping enter a newer immutable revision, existing provider/model/mapping policies retain their operator values, and an identical next sync is idempotent.

## Acceptance-criteria matrix

Status meanings:

- **Production proven**: exercised against the deployed system.
- **Regression proven**: directly covered by a fresh focused test at a stable seam.
- **Held for rollout**: implementation is covered, but customer-facing enforcement is intentionally disabled by the active launch instruction.
- **Pending**: more evidence is required before this shadow-stage goal can be closed.

|   # | Criterion                                                             | Status                                       | Evidence / remaining gate                                                                                                                                             |
| --: | --------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Curate visibility without source edits or deploy                      | Production proven                            | Admin change sets published and rolled back GPT-5.5 policy without source changes.                                                                                    |
|   2 | Worker sync preserves policy and applied revisions                    | Production + regression proven               | 10/10 sync tests; post-sync production fingerprints unchanged; no duplicate revision.                                                                                 |
|   3 | All customer discovery surfaces use one effective revision            | Held for rollout                             | API/Gateway metadata converge on revision 40 in shadow; discovery enforcement remains off by instruction.                                                             |
|   4 | Hidden/unavailable direct requests are rejected unless `allowDirect`  | Regression proven; production shadow only    | `request-policy.spec.ts`; production shadow decision returned `model_not_available` while legacy remained authoritative.                                              |
|   5 | Disabled provider blocks mappings despite environment credentials     | Regression proven                            | `catalog.spec.ts` effective-state truth table.                                                                                                                        |
|   6 | Disabled mapping is excluded from primary and fallback routing        | Regression proven                            | `catalog.spec.ts` and `catalog-policy.spec.ts`.                                                                                                                       |
|   7 | Multi-entity apply is atomic and increments once                      | Production + regression proven               | Four-operation hidden canary produced one revision; change-set atomicity tests pass.                                                                                  |
|   8 | Stale optimistic versions reject without mutation                     | Regression proven                            | `change-set.spec.ts`.                                                                                                                                                 |
|   9 | Rollback creates an audited inverse revision                          | Production proven                            | Revision 37 -> audited rollback revision 38 -> reapply revision 39.                                                                                                   |
|  10 | Activation blocks missing credentials, prices, IDs, options, or tests | Production + regression proven               | GPT-5.5 Pro/Azure remain blocked; activation and mapping-readiness tests pass.                                                                                        |
|  11 | Fixed/markup pricing and margin are deterministic                     | Regression proven                            | Decimal pricing, fixed-unit, markup, and schema tests pass; production fixed metadata verified.                                                                       |
|  12 | Negative margin requires audited override and reason                  | Regression proven                            | Pricing validation test; production canary has override disabled.                                                                                                     |
|  13 | Mapping test uses production adapter and stores no secret/body        | Production proven                            | Exact saved-credential probe passed; audit/test rows contain sanitized metadata only.                                                                                 |
|  14 | Breaker removes only affected mapping and preserves fallback          | Regression proven; held for rollout          | Breaker and catalog fallback tests pass; breaker remains off.                                                                                                         |
|  15 | No fallback returns retryable 503 without ineligible routing          | Regression proven; held for rollout          | `request-policy.spec.ts`; routing enforcement remains off.                                                                                                            |
|  16 | Scheduled changes apply once or fail atomically when stale            | Regression proven; held for rollout          | Scheduler apply/failure audit tests pass; scheduled rollout not enabled.                                                                                              |
|  17 | Deprecation exposes retirement and replacement metadata               | Regression proven; held for rollout          | Runtime and request-policy lifecycle tests pass.                                                                                                                      |
|  18 | Retired models return 410 and disappear from discovery                | Regression proven; held for rollout          | Request-policy retirement test and discovery filtering code; discovery enforcement remains off.                                                                       |
|  19 | Accepted async jobs retain revision, mapping, and credential IDs      | Regression/code proven; legacy path retained | Video jobs persist all three IDs; non-chat routing remains legacy.                                                                                                    |
|  20 | Preview/apply/schedule/cancel/rollback/test/reset are audited         | Production subset + regression proven        | Preview/apply/rollback/test/source-refresh audits verified; scheduler audits tested; breaker reset held for rollout.                                                  |
|  21 | Bulk actions support 500 rows atomically                              | Regression proven                            | An exactly-500 operation batch validates and applies completely; 501 is rejected; a conflict at operation 500 leaves the input state unchanged.                       |
|  22 | Invalidation reaches consumers and missed events self-heal            | Production + regression proven               | API/Gateway/internal responses converge on revision 40; snapshot-cache polling and missed-event tests pass. Final worker observation remains part of the shadow gate. |
|  23 | Credentials, usage, billing, and history remain intact                | Production proven                            | Encrypted credential still validates; price/history rows retained; fresh full backup and policy export captured.                                                      |
|  24 | No role-management UI; current platform-admin authorization remains   | Production + regression proven               | Existing allowlisted email + immutable user-ID middleware; anonymous/untrusted access tests pass.                                                                     |

## Backup and rollback artifacts

Stored under `/opt/betarouter-backups` on the production Droplet:

- `revision40-20260722T201500Z.full.sql.gz` (42 MB), SHA-256 `a98e857b0f6c28ba06d3c2770320b25d10a7894f9d6c95e89cb4503d549e989a`
- `revision40-20260722T201500Z.catalog-policy.sql.gz` (279 KB), SHA-256 `b9165c6067fb74e4d1a98b8f3adde1960ee4748e34f80b628de299270093bcea`
- `revision40-20260722T201500Z.image.txt`, recording `betarouter-ai-gateway-unified:845ab33-local`

Both gzip archives pass integrity checks. The full dump is the authoritative restore artifact. The policy-only data export intentionally excludes encrypted Platform Provider credentials and emits expected circular-FK restore warnings for revision/change-set tables.

## Shadow-stage completion decision

- The operator waived the remaining wall-clock duration because there is no representative user traffic to observe. Waiting longer would only add more synthetic discovery reads.
- The reproducible **Shadow completion audit** in `docs/admin-model-catalog-operations.md` passed at `2026-07-22T20:58:44Z`.
- Revision 40 remained at checksum `sha256:v2:772202412b45d5d416b1af6b49ae1aa62bf09b2d5318f5dd5d040fb7cb1086e7`, with eight immutable revision rows and 41/312/664 source counts.
- All four operator-policy fingerprints matched the baseline after multiple worker synchronization cycles.
- Catalog logs contained six Gateway model comparisons, 76 Platform discovery comparisons, one controlled routing decision, zero availability warnings, and zero catalog-specific errors.
- Successful preview, apply, rollback, mapping-test, and source-refresh audit history remained present.
- Both database backup archives passed gzip integrity checks and retained their recorded SHA-256 values. The rollback image marker remained `betarouter-ai-gateway-unified:845ab33-local`.
- The Droplet retained 8.8 GB free at 85% disk use; no cleanup or build was required.
- Discovery, routing, and breaker enforcement remain disabled. A later enforcement rollout requires separate operator approval.
