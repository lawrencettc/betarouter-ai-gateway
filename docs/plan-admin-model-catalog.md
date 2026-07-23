# BetaRouter Admin Model Catalog Build Plan

Status: Proposed

Date: 2026-07-22

Companion spec: `docs/spec-admin-model-catalog.md`

## Delivery strategy

Build the catalog as a revisioned policy layer over the existing synchronized
provider/model/mapping tables. Do not replace the source catalog, duplicate
routing logic in Admin, or mutate source statuses directly.

The work is split into independently reviewable phases. Each phase must leave
production deployable and must include tests before the next phase starts.

## Dependency graph

```text
Phase 0 Baseline and contracts
          |
          v
Phase 1 Schema + source/policy separation
          |
          v
Phase 2 Effective catalog resolver + revision cache
       /        |             \
      v         v              v
Phase 3 API   Phase 4 Gateway  Phase 5 Worker/jobs
      \         |              /
       \        v             /
        +--> Phase 6 Admin UI <+
                  |
                  v
        Phase 7 Pricing + impact preview
                  |
                  v
        Phase 8 Tests, health, circuit breaker
                  |
                  v
        Phase 9 Scheduling, deprecation, rollback
                  |
                  v
        Phase 10 Parity, canary, production rollout
```

## Phase 0: Baseline and contracts

### Outcomes

- Record production counts and current effective behavior.
- Define the effective-state truth table and versioned change-set union.
- Inventory every model-list and routing consumer.
- Define launch metrics, logging, and feature flags.

### Work

1. Add architecture decision documentation for source data versus operator
   policy and immutable catalog revisions.
2. Enumerate all consumers of `@betarouter/models`, `/internal/models`, and
   model/mapping database queries.
3. Capture golden fixtures for representative text, reasoning, embedding,
   image, audio, OCR, and video mappings.
4. Add feature flags:
   - `PLATFORM_CATALOG_SHADOW_READ`
   - `PLATFORM_CATALOG_DISCOVERY_ENABLED`
   - `PLATFORM_CATALOG_ROUTING_ENABLED`
   - `PLATFORM_CATALOG_BREAKER_MODE=off|observe|enforce`
5. Define structured decision logs containing request ID, catalog revision,
   canonical model, mapping, credential source, eligibility reasons, and final
   route without secrets.

### Verification gate

- Consumer inventory is complete.
- Truth-table fixtures are approved by tests before schema work begins.
- No production behavior changes.

## Phase 1: Schema and source-policy separation

### Outcomes

- Add policy, price, change-set, revision, and mapping-test tables.
- Preserve all existing rows and history.
- Ensure source sync never overwrites operator policy.

### Work

1. Extend `packages/db/src/schema.ts` with the tables and indexes from the spec.
2. Generate additive Drizzle migrations and verify forward migration against a
   production-sized database copy.
3. Add database constraints, optimistic concurrency fields, and typed operation
   payload schemas.
4. Update `apps/worker/src/services/sync-models.ts` tests to prove source sync
   updates metadata while preserving all policy records.
5. Add a bootstrap command that creates explicit hidden/disabled draft policies
   for every current provider and model, plus disabled policies for mappings.
   The command supports dry-run and is idempotent.
6. Add a separate compatibility seed mode matching legacy visibility for shadow
   comparison; never run curated bootstrap automatically during deployment.

### Verification gate

- Migration and rollback rehearsal completes without row loss.
- Repeated catalog sync leaves policy checksums unchanged.
- Existing provider credentials and historical logs still resolve.

## Phase 2: Effective catalog resolver and revision cache

### Outcomes

- Create the single authoritative catalog-policy package.
- Produce immutable, checksummed snapshots.
- Support Redis invalidation and bounded stale reads.

### Work

1. Add a shared package or DB service with:
   - source/policy hydration;
   - visibility, availability, and routing evaluation;
   - dependency-reason codes;
   - pricing and margin resolution;
   - lifecycle calculation;
   - capability checks; and
   - immutable snapshot serialization.
2. Join active, valid Platform Providers and explicit environment fallback
   availability without exposing credentials.
3. Cache by catalog revision, publish invalidation after database commit, and
   poll revision as a recovery path.
4. Add shadow comparison against current discovery and routing decisions.
5. Expose health/readiness signals for database, Redis, snapshot age, revision,
   and checksum.

### Verification gate

- Unit truth-table coverage includes every blocker and lifecycle transition.
- Identical input produces an identical checksum.
- A missed Redis event self-heals through revision polling.
- Resolver fails closed without a current or bounded-stale valid snapshot.

## Phase 3: Admin catalog API and atomic change sets

### Outcomes

- Add read endpoints, preview, apply, bulk, schedule storage, history, and
  rollback contracts.
- Reuse existing platform-admin authentication and platform audit logging.

### Work

1. Add `/admin/catalog/*` routes and OpenAPI schemas.
2. Implement paginated filters and summaries without N+1 queries.
3. Implement preview validation and impact-query interfaces.
4. Apply operations with a serializable transaction or revision/advisory lock.
5. Reject stale entity timestamps or base revisions atomically.
6. Write before/after audit metadata without customer secrets.
7. Generate the Admin OpenAPI client and add route authorization tests.

### Verification gate

- Unauthorized and ordinary admin-email-only users cannot mutate catalog policy;
  current immutable platform-admin IDs remain required.
- A 500-operation bulk change applies atomically.
- Duplicate idempotency keys cannot create two revisions.
- Failed preview and apply attempts are audited safely.

## Phase 4: Discovery and gateway enforcement

### Outcomes

- Make customer discovery and direct requests obey the same revision.
- Exclude disabled mappings from primary and fallback routing.
- Preserve billing linkage to the selected mapping.

### Work

1. Replace independent `/v1/models` filtering with the effective snapshot.
2. Update `/internal/models` to use the same snapshot and ETag.
3. Add a central request guard before chat, responses, embeddings, moderation,
   image, audio, OCR, and video-specific handlers.
4. Pass eligible mapping IDs into existing routing/fallback code instead of
   reimplementing the router.
5. Return specified 404, 410, and retryable 503 error contracts.
6. Record catalog revision and mapping ID on usage/billing logs.
7. Verify environment credentials cannot bypass a disabled provider or mapping.

### Verification gate

- Golden parity tests cover every gateway modality.
- Hidden/unavailable/retired IDs behave consistently across endpoints.
- Disabled mappings never appear in route-selection traces.
- Pricing and usage remain attached to the exact selected mapping.

## Phase 5: Worker and asynchronous job stability

### Outcomes

- Persist catalog revision and mapping ID for long-running work.
- Prevent later catalog changes from redirecting accepted jobs.

### Work

1. Add nullable mapping/revision fields to relevant async job tables before
   making them required for new platform jobs.
2. Persist the selected mapping, catalog revision, and existing credential ID
   when the gateway accepts a job.
3. Resolve exact persisted records in workers and reject unsafe fallback to a
   different mapping.
4. Add explicit emergency-cancel behavior for queued jobs as a separate audited
   operation.
5. Include queued-job counts in impact previews.

### Verification gate

- Jobs accepted before a catalog revision complete on the persisted mapping.
- Retiring a mapping blocks new jobs without silently rerouting queued jobs.
- Worker retries are idempotent.

## Phase 6: Admin Catalog interface

### Outcomes

- Deliver Overview, Providers, Models, Mappings, and Changes tabs.
- Support filtering, bulk selection, dependency explanations, preview, apply,
  schedule, and rollback.

### Work

1. Add Catalog navigation and route structure under `ee/admin`.
2. Build a server-filtered data table shared across catalog entity pages.
3. Add effective-state badges with accessible reason popovers.
4. Add bulk selection that survives pagination and shows the exact affected
   count.
5. Build policy editors for visibility, availability, lifecycle, replacement,
   display metadata, aliases, capability restrictions, priority, weight,
   external ID, and pricing.
6. Build a preview drawer showing blockers, warnings, traffic, customers, keys,
   jobs, fallback coverage, and margin delta.
7. Require typed confirmation for high-impact apply, retirement, and rollback.
8. Add scheduled-change and revision-history views.
9. Link missing credentials to Admin Platform Providers.
10. Add responsive, keyboard, focus, loading, empty, and error states.

### Verification gate

- Component tests cover selection, filters, stale previews, confirmations, and
  sanitized error rendering.
- Keyboard-only operation reaches every catalog mutation.
- No plaintext credential enters catalog page props, cache, logs, or browser
  storage.

## Phase 7: Pricing, margin, and impact preview

### Outcomes

- Make source cost, customer price, discounts, and margin explicit.
- Prevent accidental loss-making or uncovered catalog changes.

### Work

1. Implement price schemas for every existing billing unit.
2. Add source-cost, markup, and fixed-price calculations using `decimal.js`.
3. Integrate current discounts after sell-price calculation.
4. Block missing prices and negative margin unless explicitly overridden with a
   reason.
5. Build impact aggregation for a configurable recent window using existing
   rollups rather than raw-log scans where possible.
6. Report unknown/insufficient traffic rather than fabricating estimates.

### Verification gate

- Decimal calculations are deterministic and never use binary floating point.
- Every supported modality has price and margin fixtures.
- Preview queries stay within an agreed production latency budget; target p95 is
  under 2 seconds for the current 311-model/663-mapping catalog.

## Phase 8: Mapping tests, health, fallbacks, and circuit breaker

### Outcomes

- Validate mappings before activation.
- Surface operational health and enforce automatic mapping-level protection.

### Work

1. Add the sanitized `minimal-chat` mapping test through the production adapter
   and block non-chat mappings until their operation-specific future profile is
   implemented.
2. Invalidate required test revisions after connection-critical changes.
3. Aggregate mapping health from existing request metrics while excluding
   customer-caused 4xx responses.
4. Apply configured priority and weight inside the existing routing system.
5. Implement Redis circuit state and atomic transitions.
6. Start in observe mode, compare would-open events, then enable enforcement.
7. Add operator breaker reset after a passing probe/test.

### Verification gate

- Test runs store no prompt, raw response, or credential.
- Circuit state-machine unit tests cover concurrency and Redis loss.
- A failed primary falls back; failure of every mapping produces retryable 503.
- Observe-mode data is reviewed before enforce mode is enabled.

## Phase 9: Scheduling, lifecycle, migration, and rollback

### Outcomes

- Apply due change sets once.
- Support deprecation warnings, retirement errors, replacement guidance, and
  inverse revisions.

### Work

1. Add scheduled change-set claiming to the worker using row locks and
   idempotency keys.
2. Revalidate base revision and dependencies at execution time.
3. Add deprecation and sunset response metadata.
4. Add HTTP 410 replacement response and customer-facing warning UI.
5. Implement inverse-operation generation and rollback preview/apply.
6. Test scheduling around UTC/daylight-saving display boundaries.

### Verification gate

- Concurrent workers cannot apply one schedule twice.
- Invalid scheduled changes fail without partial mutation.
- Rollback restores the prior checksum and remains fully audited.

## Phase 10: Parity, canary, and production rollout

### Outcomes

- Move from shadow reads to full enforcement safely.
- Publish the curated launch catalog.

### Work

1. Run legacy-versus-policy shadow comparison until unexplained divergence is
   zero for at least 24 hours of representative traffic.
2. Create a production backup and catalog-policy export without secrets.
3. Deploy discovery enforcement, then routing enforcement, then scheduled
   changes, then circuit breakers.
4. Exercise a hidden canary model through show, test, enable, route, bill,
   deprecate, retire, and rollback.
5. Apply the curated launch change set selected by the operator.
6. Verify website, playground, `/internal/models`, `/v1/models`, direct API,
   fallbacks, usage, billing, worker jobs, and Admin revision history.
7. Monitor errors, stale snapshots, circuit events, margin, and route-selection
   reasons after each flag transition.

### Verification gate

- Every acceptance criterion in the companion spec has fresh evidence.
- Production health remains green after each staged flag change.
- A rollback rehearsal completes before declaring the release done.

## Test execution matrix

| Component  | Commands/coverage expectation                                                                |
| ---------- | -------------------------------------------------------------------------------------------- |
| Database   | DB package build, migration validation, schema/integration tests.                            |
| API        | Focused Admin catalog tests, OpenAPI generation, API lint/build.                             |
| Gateway    | Resolver/routing unit tests plus modality-focused integration suites, lint/build.            |
| Worker     | Sync, scheduler, breaker summary, and job persistence tests, lint/build.                     |
| Admin      | Component tests if available, generated types, lint/build, browser E2E.                      |
| Whole repo | `git diff --check`, secret scan, focused unit/e2e suites, low-memory production build path.  |
| Production | Container health, migrations, supervisor processes, public endpoints, catalog parity canary. |

## Rollback plan

1. Disable circuit enforcement.
2. Disable catalog routing enforcement while preserving discovery policy if
   safe; otherwise disable discovery policy too.
3. Pin consumers to the last verified catalog revision.
4. Redeploy the prior image if resolver or migration code is faulty.
5. Keep additive tables and audit history; do not drop them during emergency
   rollback.
6. Restore the database only for proven data corruption, using the predeploy
   backup and a written incident decision.

## Estimated implementation slices

This is a substantial platform feature. Plan for 10 reviewable slices rather
than one large PR. Suggested AI-assisted elapsed effort, excluding external
review wait and production observation windows:

| Slice                                 |       Estimated focused effort |
| ------------------------------------- | -----------------------------: |
| Baseline, schemas, migrations         |                       1-2 days |
| Resolver and revision cache           |                       2-3 days |
| Admin API and change sets             |                       2-3 days |
| Discovery and gateway enforcement     |                       3-5 days |
| Worker/job persistence                |                       1-2 days |
| Admin interface                       |                       3-5 days |
| Pricing and impact preview            |                       2-3 days |
| Tests, health, breaker                |                       3-4 days |
| Scheduling, lifecycle, rollback       |                       2-3 days |
| Full QA and staged production rollout | 2-4 days plus observation time |

## Explicit future backlog

Track, but do not implement in this build. Detailed scope and entry gates live
in `docs/future-build-plan-admin-model-catalog.md`:

- operator role separation and multi-operator approvals;
- scoped catalogs by organization/project/plan/region/key;
- generic custom provider protocols, headers, and proxy configuration;
- shared custom models absent from the source catalog;
- automatic upstream discovery and approval workflow;
- curated collections, personalized ordering, and recommendations;
- multi-currency/tax/contract pricing;
- capacity reservations and quota balancing;
- customer maintenance subscriptions and notifications;
- environment promotion/export/import; and
- automated replacement recommendations.

## Start gate

Do not begin implementation until the operator supplies the goal prompt and
confirms this spec and plan. Once started, implementation must use a new
`codex/` feature branch/worktree, retain the existing production deployment,
and ship through reviewed pull requests and staged feature flags.
