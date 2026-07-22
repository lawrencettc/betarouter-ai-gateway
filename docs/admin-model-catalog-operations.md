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
PLATFORM_CATALOG_BREAKER_MODE=off
```

The production Compose file forwards all four flags to the unified service.
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

### Stage 2: shadow reads

Set `PLATFORM_CATALOG_SHADOW_READ=true` and redeploy the same image. Keep
discovery, routing, and breaker enforcement off. Review shadow comparison logs
for model/mapping counts and route decisions. Investigate every unexplained
difference before continuing.

### Stage 3: hidden canary

In Admin, choose one low-risk text/chat model with at least one validated
Platform Provider credential. Keep it hidden and disabled, run its mapping test,
then preview an atomic change that enables its provider, model, mapping, and
source-cost or approved customer pricing. Confirm the preview has no blockers,
unexpected fallback loss, negative margin, scheduled conflict, or customer
impact.

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

## Emergency rollback

Apply the smallest safe rollback in this order:

1. Set `PLATFORM_CATALOG_BREAKER_MODE=off`.
2. Set `PLATFORM_CATALOG_ROUTING_ENABLED=false`.
3. If discovery is affected, set
   `PLATFORM_CATALOG_DISCOVERY_ENABLED=false` and
   `PLATFORM_CATALOG_SHADOW_READ=false`.
4. Use Admin rollback preview and audited inverse revision when the issue is an
   operator policy change.
5. Redeploy the previous image when the application is faulty. Keep additive
   catalog tables and audit history.
6. Restore the predeploy database backup only for proven data corruption and
   after recording an incident decision. A normal feature rollback does not
   require schema reversal.

## Handoff: Cloudflare Zero Trust

Cloudflare Tunnel provides the public routes, but Cloudflare Zero Trust Access
for `admin.betarouter.com` is not complete because the Cloudflare account's plan
activation/balance payment flow was unavailable. The Admin application still
requires its own platform-admin login; it does not yet have a second edge-access
login layer. Return to this after the Cloudflare billing issue is resolved and
test it without breaking the application sign-in redirect/cookies.
