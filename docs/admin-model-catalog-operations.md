# BetaRouter Admin Model Catalog Operations

Date: 2026-07-22

This is the production rollout, verification, and rollback runbook for
`admin.betarouter.com/catalog` on the single DigitalOcean deployment behind the
Cloudflare Tunnel.

## Launch boundary

- The first launch catalog is curated by the operator in Admin.
- Text/chat mappings may activate after an exact `minimal-chat` test passes.
- Keep embeddings, moderation, image, audio/speech, OCR, and video mappings
  disabled until their operation-specific profiles in the future build plan
  are implemented.
- Catalog editor permissions are not separated in this release. Existing
  immutable platform-admin authorization remains the only admin gate.

## Required production configuration

The production `.env.production` must contain the provider-encryption and
platform-admin variables documented in `docs/platform-provider-operations.md`,
plus these rollout flags:

```dotenv
PLATFORM_CATALOG_SHADOW_READ=false
PLATFORM_CATALOG_DISCOVERY_ENABLED=false
PLATFORM_CATALOG_ROUTING_ENABLED=false
PLATFORM_CATALOG_BASE_READ_ENABLED=false
PLATFORM_CATALOG_BREAKER_MODE=off
```

The production Compose file forwards all five flags to the unified service.
Do not enable a later stage in Git or the image; change the deployment secret
file so emergency rollback remains independent of a new build.

## Predeploy gate

1. Confirm the PR checks, focused catalog tests, Admin production build, clean
   migration rehearsal, security review, and generated API types pass.
2. Confirm `/opt/betarouter-ai-gateway/.env.production` has the four safe
   defaults above.
3. Confirm at least one recent restorable database backup exists. The production
   workflow also creates `/opt/betarouter-backups/pre-deploy-<UTC>.sql.gz` before
   replacing a healthy container.
4. Record the current image digest and current public health for
   `betarouter.com`, `api.betarouter.com`, `platform-api.betarouter.com`, and
   `admin.betarouter.com`.
5. Measure the two existing tables that receive lineage indexes before running
   migrations:

   ```sql
   SELECT relname, n_live_tup
   FROM pg_stat_user_tables
   WHERE relname IN ('log', 'video_job');

   SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS total_size
   FROM pg_catalog.pg_statio_user_tables
   WHERE relname IN ('log', 'video_job');
   ```

   The migration uses normal `CREATE INDEX`, which takes a write-blocking lock
   while each index is built. Run it in a low-traffic window. If either table is
   large enough that the expected build time does not fit the maintenance
   window, stop the deploy and move those four lineage indexes to a separate
   non-transactional `CREATE INDEX CONCURRENTLY` maintenance operation.

6. Do not create the curated launch change set automatically during migration
   or container startup.
7. If the target already contains a catalog revision created by a prerelease
   build, bootstrap or publish one fresh revision after deploy so its stored
   snapshot includes provider lifecycle dates and mapping deactivation dates.

## Staged rollout

### Stage 1: additive deploy

Deploy and migrate with every catalog flag at its safe default. Confirm the
unified container, PostgreSQL, Redis, worker, and Cloudflare Tunnel are healthy.
Verify existing sign-in, API traffic, billing, and encrypted Platform Providers
before using the new catalog.

Open the Catalog overview and inspect **Revision state**. If it reports
**Refresh required**, compare the published and current counts, then use
**Publish source refresh**. This creates an immutable revision from synchronized
provider, model, mapping, credential-readiness, test, and price state without
rewriting operator policies. The action is idempotent and recorded as
`platform_catalog.source_refresh` in the platform audit log. Do not continue to
mapping tests or activation previews while the revision is stale.

### Stage 2: shadow reads

Set `PLATFORM_CATALOG_SHADOW_READ=true` and redeploy the same image. Keep
discovery, routing, and breaker enforcement off. Review shadow comparison logs
for model/mapping counts and route decisions. Investigate every unexplained
difference before continuing.

#### Shadow completion audit

Keep the shadow stage active for at least 24 hours from the current revision's
`created_at`. At the end of the window, perform these read-only checks before
closing the launch gate:

1. Require Gateway `/v1/models` and Platform `/internal/models` to return HTTP
   200 with the same catalog revision and checksum. A weak ETag is acceptable,
   but both surfaces must return the same value.
2. Confirm the latest revision ID, checksum, provider/model/mapping counts, and
   total revision-row count still match the recorded launch baseline.
3. Recompute operator-policy fingerprints with the canonical aggregation below.
   Compare every row count and fingerprint with the values recorded at the
   beginning of the window:

   ```sql
   SELECT count(*),
          md5(jsonb_agg(to_jsonb(policy) ORDER BY provider_id)::text)
   FROM platform_provider_policy AS policy;

   SELECT count(*),
          md5(jsonb_agg(to_jsonb(policy) ORDER BY model_id)::text)
   FROM platform_model_policy AS policy;

   SELECT count(*),
          md5(jsonb_agg(to_jsonb(policy) ORDER BY mapping_id)::text)
   FROM platform_mapping_policy AS policy;

   SELECT count(*),
          md5(jsonb_agg(to_jsonb(policy) ORDER BY mapping_id)::text)
   FROM platform_mapping_price_policy AS policy;
   ```

4. Confirm `PLATFORM_CATALOG_SHADOW_READ=true`, discovery and routing remain
   `false`, and breaker mode remains `off` in the running container.
5. Review logs from the recorded UTC start time. Record the number of Gateway
   model-list comparisons, Platform discovery comparisons, routing decisions,
   snapshot/breaker availability warnings, and catalog-specific errors.
6. Confirm the unified container, PostgreSQL, Redis, worker, and Cloudflare
   Tunnel are healthy. Recheck the production backup integrity and the saved
   rollback image reference.

Stop and investigate if a policy fingerprint changes, the revision changes
without an audited catalog action or source-content change, the two discovery
surfaces disagree, any required process is unhealthy, or an unexplained catalog
warning/error remains. Do not enable discovery, routing, or breaker enforcement
as part of this audit; each later stage requires separate operator approval.

### Stage 3: hidden canary

In Admin, choose one low-risk text/chat model with at least one validated
Platform Provider credential. Keep it hidden and disabled, run its mapping test,
then preview an atomic change that enables its provider, model, mapping, and
source-cost or approved customer pricing. Confirm the preview has no blockers,
unexpected fallback loss, negative margin, scheduled conflict, or customer
impact.

Catalog search accepts model ID, provider ID, mapping ID, upstream external ID,
and region. Use the exact model ID from the provider validation result when
selecting the canary.

Publish the canary, verify the revision in Admin, then verify the cache revision
reaches API, gateway, and worker. Hide/disable it again and perform the audited
rollback preview and rollback. Do not continue unless both directions converge
on one catalog revision.

### Stage 4: discovery

Set `PLATFORM_CATALOG_DISCOVERY_ENABLED=true`. Confirm the website/playground
selectors, `/internal/models`, and `/v1/models` expose the same curated model and
mapping set, customer pricing, lifecycle, retirement, and replacement metadata.
Retired models must remain absent.

### Stage 5: routing and billing

Set `PLATFORM_CATALOG_ROUTING_ENABLED=true`. Call an enabled canary model and
verify selected mapping ID, catalog revision, provider, customer price, usage,
and billed cost agree. Verify a hidden/unavailable direct request is rejected,
a retired model returns 410, and a healthy fallback is selected when the
primary mapping is unavailable.

### Stage 6: breaker observation and enforcement

Set `PLATFORM_CATALOG_BREAKER_MODE=observe` first. Review would-open events and
health summaries without changing routes. Only after the observation window is
clean set it to `enforce`, then exercise open, half-open, successful probes,
close, and an operator reset backed by a current passing mapping test.

### Stage 7: chat read-path inversion

With `PLATFORM_CATALOG_SHADOW_READ=true`, the gateway dual-resolves chat-path
model base data (capabilities, limits, source prices) from the catalog
snapshot alongside the static arrays and logs any difference as
`Catalog model resolution divergence` (field-level detail; pricing fields log
as `Catalog model resolution pricing divergence` at error level). Require a
clean soak covering at least two worker syncs, one cache refresh, and one
restart. Any pricing divergence, by any amount, aborts the stage. Only then
set `PLATFORM_CATALOG_BASE_READ_ENABLED=true`, which makes the snapshot the
primary source for chat model resolution (static remains the fallback for
revisions that predate the base-data mirror).

### Stage 8: source authority (create and edit operations)

No flag gates this stage; it ships as new change-set operations that only take
effect through applied revisions.

Creating a provider without a deploy (the relay flow, in order):

1. `provider.create` (declares an existing protocol, e.g. `openai-chat`) plus
   `mapping.create` against existing root models in one change set. Created
   entries land as `source='admin'` with draft, disabled policies — they are
   invisible and unroutable until every admission gate passes.
2. Attach a platform credential (its base URL is the relay endpoint) through
   the credential API and run the mapping test from the console; the passed
   test is fingerprint-bound to that exact credential configuration.
3. Set a price policy (fixed policies use the V2 shape, which can price
   `cacheRead`, `cachedImageInput`, `cachedAudioInput`, and `audioInput`
   independently; stored V1 policies keep their aliasing) and enable the
   mapping, provider, and model policies.

Admin-created providers carry no compliance attestations (`dataPolicy`,
`headquarters` stay code-only), so compliance-gated organizations exclude
them automatically. The worker sync never writes `source='admin'` rows; if
code later ships a mapping for a slot an admin mapping occupies, the sync
logs `Skipping sync for admin-owned mapping slot` and the admin row keeps
serving until it is retired.

Editing code-defined (static) entries uses `*.set_source_override` /
`*.clear_source_override`: the mirror row is never mutated — the override is
a per-field patch stored on the policy row, composed as
`mirror → override → policy → price → breaker`, and it records the mirrored
value at set-time for the upstream-change review. Values use mirror units
(per-token `e-6` price strings, exactly the code catalogue's notation).
Clearing an override instantly reverts to upstream truth. NOTE: while a
source override is active, Stage 7 shadow logging reports an expected
divergence between the static array and the snapshot for the overridden
field — the zero-divergence soak interpretation applies to the pre-override
world, so flip `PLATFORM_CATALOG_BASE_READ_ENABLED` before relying on
overrides, or account for them when reading the soak.

### Stage 9: upstream-change review

No flag gates this stage either. The worker reconciles the review queue right
after the startup catalog sync; the queue is served by the Admin API under
`/platform/catalog/review` (list, `/refresh` to reconcile on demand,
`/{id}/acknowledge` for informational entries).

- **Drift entries** (`override_drift`): open while an active source
  override's recorded base value no longer matches the mirrored row — i.e.
  upstream moved a value the operator has pinned. The override keeps serving
  either way; the entry is only a prompt. Resolve it by **keeping** the
  override (re-apply `*.set_source_override` with the same value — any set
  re-captures the base value) or **clearing** it (`*.clear_source_override`,
  which reverts to the new upstream value). Applying either change set
  reconciles the queue in the same transaction and labels the entry
  `override_kept` or `override_cleared`; drift entries cannot be
  acknowledged away.
- **Informational entries** (`entity_added`, `entity_retired`): new static
  entities and code-side retirements observed after the queue's first run.
  Acknowledge them from the queue; a retirement reverted upstream before
  review closes itself as `superseded`.

The first reconcile ever seeds the existing catalog as pre-resolved
`baseline` rows, so deploying this stage does not flood the queue with
history. A field can drift again after a keep — each recurrence opens a new
entry and the resolved rows remain as the audit trail.

## Emergency rollback

Apply the smallest safe rollback in this order:

1. Set `PLATFORM_CATALOG_BREAKER_MODE=off`.
2. Set `PLATFORM_CATALOG_BASE_READ_ENABLED=false`.
3. Set `PLATFORM_CATALOG_ROUTING_ENABLED=false`.
4. If discovery is affected, set
   `PLATFORM_CATALOG_DISCOVERY_ENABLED=false` and
   `PLATFORM_CATALOG_SHADOW_READ=false`.
5. Use Admin rollback preview and audited inverse revision when the issue is an
   operator policy change. The inverse of a creation retires the created
   entry (no catalog row is ever hard-deleted); the inverse of a source
   override restores the previous override values.
6. Redeploy the previous image when the application is faulty. Keep additive
   catalog tables and audit history.
7. Restore the predeploy database backup only for proven data corruption and
   after recording an incident decision. A normal feature rollback does not
   require schema reversal.

## Handoff: Cloudflare Zero Trust

Cloudflare Tunnel provides the public routes, but Cloudflare Zero Trust Access
for `admin.betarouter.com` is not complete because the Cloudflare account's plan
activation/balance payment flow was unavailable. The Admin application still
requires its own platform-admin login; it does not yet have a second edge-access
login layer. Return to this after the Cloudflare billing issue is resolved and
test it without breaking the application sign-in redirect/cookies.
