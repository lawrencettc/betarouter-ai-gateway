# BetaRouter Admin Model Catalog Specification

Status: Ready for implementation planning

Date: 2026-07-22

Owner: BetaRouter platform operator

Scope: Launch catalog management and operational controls

## Problem statement

BetaRouter currently imports the full upstream catalog and exposes far more
providers and models than a new service should offer. Production contains 41
providers, 311 models, and 663 model-provider mappings; all are marked active as
of 2026-07-22. The existing Admin pages display catalog statistics but do not
control customer visibility or gateway routing.

The catalog also has two competing sources of truth:

- `@betarouter/models` defines providers, models, mappings, capabilities,
  upstream prices, and retirement dates in code.
- PostgreSQL receives a synchronized copy for analytics and internal UI.

The worker sync intentionally resets synchronized mappings to `active`, so
directly editing those rows from Admin would be unsafe. Meanwhile, the public
`/v1/models` endpoint still reads code definitions, while the website and
playground primarily read `/internal/models`. A model can therefore appear in
one surface, remain callable in another, and route despite an operator trying to
hide it.

BetaRouter needs a single operator-controlled catalog policy that determines
what customers see, what requests the gateway accepts, and which upstream
mappings may receive traffic, without deleting historical records or fighting
the upstream sync process.

## Goals

1. Allow the sole BetaRouter administrator to curate a small launch catalog.
2. Separate customer visibility, API availability, and routing eligibility.
3. Manage providers, models, and individual model-provider mappings from Admin.
4. Prevent invalid catalog states before they reach production.
5. Manage customer pricing and inspect expected margin.
6. Safely deprecate, retire, replace, test, schedule, and roll back catalog
   changes.
7. Use the same effective catalog policy in the website, playground, model-list
   APIs, gateway request validation, routing, fallbacks, and asynchronous jobs.
8. Preserve the existing encrypted Platform Providers credential system and
   all usage, billing, and audit history.

## Non-goals for this release

- Separate catalog-editor, credential-admin, and read-only roles. The existing
  platform-admin authorization remains sufficient while there is one operator.
- Organization-, project-, plan-, region-, or API-key-specific catalogs.
- A generic adapter for arbitrary third-party protocols or custom authentication
  headers. OpenAI-compatible relays continue to use the registered OpenAI
  adapter plus a custom base URL.
- Automatic ingestion of upstream provider catalogs without operator approval.
- Customer-created public catalog entries.
- Hard deletion of built-in providers, models, mappings, usage, or billing
  history.

## Product vocabulary

| Term            | Meaning                                                                                |
| --------------- | -------------------------------------------------------------------------------------- |
| Source catalog  | Provider/model/mapping metadata synchronized from `@betarouter/models`.                |
| Catalog policy  | BetaRouter operator overrides stored separately from source metadata.                  |
| Visible         | Discoverable on the website, playground, selectors, and model-list APIs.               |
| Available       | Accepted when a customer requests the model or provider explicitly.                    |
| Routable        | Eligible for selection after policy, credential, health, and capability checks.        |
| Mapping         | A canonical BetaRouter model connected to one upstream provider and external model ID. |
| Deprecated      | Still available during a warning period but carries a replacement notice.              |
| Retired         | Hidden, unavailable, and unroutable while history remains intact.                      |
| Change set      | One atomic collection of catalog changes, including bulk and scheduled changes.        |
| Circuit breaker | Runtime protection that temporarily removes an unhealthy mapping from routing.         |

## User stories

1. As the operator, I want to see every provider, model, and mapping with its
   effective state so I know what customers can actually use.
2. As the operator, I want to show or hide a provider without deleting its
   configuration or history.
3. As the operator, I want to show or hide a model independently of whether it
   is technically routable.
4. As the operator, I want to enable or disable API availability so hidden
   models cannot remain callable by ID accidentally.
5. As the operator, I want to enable or disable each model-provider mapping so I
   can remove one upstream while retaining another.
6. As the operator, I want the system to block invalid activation when no valid
   credential, mapping, price, or capability exists.
7. As the operator, I want to configure fallback priority and traffic weights
   among mappings for the same model.
8. As the operator, I want to edit the upstream external model ID without
   changing BetaRouter's stable customer-facing model ID.
9. As the operator, I want to see upstream cost, customer price, and expected
   margin before publishing.
10. As the operator, I want bulk actions so I can reduce the initial catalog
    from hundreds of models to a curated launch set efficiently.
11. As the operator, I want to test a mapping through the real gateway adapter
    and selected encrypted credential before enabling it.
12. As the operator, I want health, latency, error rate, credential state, and
    last-success information beside each mapping.
13. As the operator, I want unhealthy mappings removed automatically while
    healthy fallbacks continue serving the model.
14. As the operator, I want to schedule publication, deprecation, and retirement
    instead of making every change manually at an exact time.
15. As the operator, I want to name a replacement model and warn customers
    before retirement.
16. As the operator, I want an impact preview showing recent traffic, affected
    customers and keys, fallback coverage, and margin changes.
17. As the operator, I want every change audited and reversible without deleting
    history.
18. As a customer, I want every BetaRouter model surface to show the same
    catalog so I do not discover a model that the API rejects.
19. As a customer, I want deterministic errors and replacement guidance when a
    model is deprecated or retired.
20. As a customer, I want active requests and asynchronous jobs to retain their
    exact resolved mapping so catalog edits do not redirect work mid-flight.

## Current-state audit

| Surface                  | Current source                                     | Mutation support          | Launch gap                                               |
| ------------------------ | -------------------------------------------------- | ------------------------- | -------------------------------------------------------- |
| Admin Providers          | PostgreSQL analytics tables                        | Read-only                 | Cannot curate or disable.                                |
| Admin Models             | PostgreSQL analytics tables                        | Read-only                 | Cannot curate, price, or retire.                         |
| Admin Model Mappings     | PostgreSQL analytics tables                        | Read-only                 | Cannot control routes or external IDs.                   |
| Admin Platform Providers | Encrypted PostgreSQL credentials                   | Full credential lifecycle | Does not control catalog visibility or mappings.         |
| Worker catalog sync      | `@betarouter/models`                               | Automatic upsert          | Would overwrite direct mapping status changes.           |
| `/internal/models`       | Active PostgreSQL model/mapping rows               | Read-only                 | Does not apply credential, lifecycle, or breaker policy. |
| `/v1/models`             | `@betarouter/models`                               | Read-only                 | Ignores PostgreSQL status and Admin policy.              |
| Website/playground       | `/internal/models`                                 | Read-only                 | Can disagree with `/v1/models` and routing.              |
| Gateway routing          | Code model definitions plus credentials and health | Runtime                   | Has no global operator catalog policy.                   |
| Async video worker       | Persisted provider credential for platform jobs    | Runtime                   | Must also preserve the selected mapping/revision.        |

## What's working well and must remain intact

- The source model package is a useful reviewed baseline for adapter metadata,
  capabilities, pricing, and provider-specific retirement dates. Keep syncing
  it rather than copying the catalog permanently into Admin-owned data.
- Platform Providers already encrypts shared credentials with AES-256-GCM,
  validates connection details, supports reveal auditing, and gives database
  credentials precedence over environment fallback. Catalog work consumes its
  safe availability result and does not redesign secret storage.
- Existing gateway fallback and modality-specific adapters already cover chat,
  responses, embeddings, moderation, image, audio, OCR, and video. Catalog
  policy supplies an eligible mapping set instead of creating a second router.
- Existing usage, billing, model/mapping history, health statistics, discounts,
  and organization provider keys remain authoritative for their domains.
- Accepted video jobs already persist the exact platform credential. Extend
  this pattern with mapping and revision IDs rather than replacing it.

## Core design decisions

### 1. Preserve source data and store operator policy separately

The worker continues synchronizing provider, model, and mapping metadata from
`@betarouter/models`. It must not overwrite operator policy. New policy tables
hold BetaRouter-specific visibility, availability, pricing, routing, lifecycle,
and ordering decisions.

This separation permits upstream updates while preventing a sync from silently
re-enabling a model the operator retired.

### 2. One effective-catalog resolver

Create a shared server-side catalog policy package used by API, gateway, and
worker. It combines:

- source provider/model/mapping rows;
- operator policies;
- current time and scheduled lifecycle dates;
- active, valid platform credentials or explicitly configured environment
  fallback credentials;
- mapping test state and live circuit-breaker state;
- customer pricing policy; and
- model capabilities and requested operation.

The resolver returns an immutable revisioned snapshot. No consumer may
independently reproduce the visibility or routing rules.

### 3. Visibility, availability, and routing remain separate

- A hidden model is absent from discovery surfaces.
- An unavailable model is rejected even when requested directly.
- An unroutable mapping is never selected, but another mapping may keep the
  model available.
- A deprecated model may remain visible and available until `retireAt`.
- A retired model is hidden, unavailable, and unroutable.

Global catalog policy applies to built-in model traffic in credits, API-key, and
hybrid modes. Organization custom-model records remain outside this release.

### 4. No hard deletion

“Delete” in Admin means archive or retire. Built-in source entries cannot be
removed. Operator-created policy records may be cleared only when doing so does
not remove audit/history records. Usage and billing foreign keys remain valid.

### 5. Changes publish through atomic change sets

Admin edits build a draft change set. Preview validates the entire resulting
catalog and computes customer impact. Applying a change set writes all policy
changes and increments the global catalog revision in one database transaction.

Rollback creates and applies an inverse change set; it never deletes the audit
record. Scheduled changes use the same apply path and idempotency rules.

### 6. Request and job stability

Every accepted request records the effective catalog revision and selected
mapping ID. Long-running jobs persist these values with the existing platform
credential ID. A later catalog change prevents new routing but does not redirect
an already accepted job. A hard emergency disable may cancel queued work through
an explicit operator action; it does not happen implicitly.

## Effective state rules

### Provider state

A provider's configured state comes directly from its policy. Its effective
visibility requires configured visibility, a non-retired lifecycle, and at
least one model whose own configured visibility is true and whose mapping may be
displayed. Its effective availability requires the provider policy to be enabled
and at least one valid credential source. These calculations use configured
child states rather than recursively reading effective parent/child states, so
the resolver has no visibility cycle.

### Model state

A model is visible when its configured policy is visible, it is not retired, at
least one parent provider is configured visible and non-retired, and at least
one mapping may be displayed. A model is available when its policy is enabled
and at least one mapping is routable or temporarily breaker-open with a healthy
configured fallback.

### Mapping state

A mapping is statically eligible when:

1. source provider, model, and mapping exist;
2. provider, model, and mapping policies are enabled;
3. current time is before any retirement/deactivation deadline;
4. an active and valid credential source exists;
5. required adapter options exist;
6. customer pricing is complete for the mapping's billing units; and
7. the last required preflight test passed for the current mapping and
   credential configuration.

It is currently routable when statically eligible and the circuit breaker is
not open. Half-open mappings receive probe traffic only.

### Public model listing

Website, playground, selectors, `/internal/models`, and `/v1/models` return the
same visible snapshot revision. Deprecated entries include warning dates and a
replacement ID. Hidden and retired entries do not appear.

### Direct requests

- Hidden but available is permitted only when an explicit `allowDirect=true`
  policy is set; the launch default is false.
- Unavailable returns `404 model_not_available` to avoid advertising private
  catalog entries.
- Deprecated returns normal output plus deprecation response headers.
- Retired returns `410 model_retired` with replacement metadata when available.

## Data model

The exact Drizzle names may follow repository naming conventions, but the
logical fields and constraints are required.

### `platform_catalog_revision`

```sql
CREATE TABLE platform_catalog_revision (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  change_set_id text NOT NULL UNIQUE,
  applied_by text NOT NULL,
  checksum text NOT NULL UNIQUE
);
```

### `platform_provider_policy`

```sql
CREATE TABLE platform_provider_policy (
  provider_id text PRIMARY KEY REFERENCES provider(id),
  visible boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT false,
  display_name_override text,
  description_override text,
  website_override text,
  sort_order integer NOT NULL DEFAULT 1000,
  lifecycle text NOT NULL DEFAULT 'draft'
    CHECK (lifecycle IN ('draft','active','deprecated','retired')),
  deprecated_at timestamptz,
  retire_at timestamptz,
  replacement_provider_id text REFERENCES provider(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  CHECK (retire_at IS NULL OR deprecated_at IS NULL OR retire_at > deprecated_at)
);
```

### `platform_model_policy`

```sql
CREATE TABLE platform_model_policy (
  model_id text PRIMARY KEY REFERENCES model(id),
  visible boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT false,
  allow_direct boolean NOT NULL DEFAULT false,
  display_name_override text,
  description_override text,
  aliases_override jsonb,
  sort_order integer NOT NULL DEFAULT 1000,
  lifecycle text NOT NULL DEFAULT 'draft'
    CHECK (lifecycle IN ('draft','active','deprecated','retired')),
  deprecated_at timestamptz,
  retire_at timestamptz,
  replacement_model_id text REFERENCES model(id),
  retirement_message text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  CHECK (replacement_model_id IS NULL OR replacement_model_id <> model_id),
  CHECK (retire_at IS NULL OR deprecated_at IS NULL OR retire_at > deprecated_at)
);
```

### `platform_mapping_policy`

```sql
CREATE TABLE platform_mapping_policy (
  mapping_id text PRIMARY KEY REFERENCES model_provider_mapping(id),
  enabled boolean NOT NULL DEFAULT false,
  external_id_override text,
  context_size_limit integer CHECK (context_size_limit > 0),
  max_output_limit integer CHECK (max_output_limit > 0),
  disabled_capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  priority integer NOT NULL DEFAULT 100,
  weight integer NOT NULL DEFAULT 100 CHECK (weight BETWEEN 0 AND 10000),
  breaker_enabled boolean NOT NULL DEFAULT true,
  required_test_revision text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL
);
```

### `platform_mapping_price_policy`

```sql
CREATE TABLE platform_mapping_price_policy (
  mapping_id text PRIMARY KEY REFERENCES model_provider_mapping(id),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  mode text NOT NULL CHECK (mode IN ('source_cost','markup','fixed')),
  markup_bps integer CHECK (markup_bps BETWEEN -10000 AND 100000),
  fixed_prices jsonb,
  allow_negative_margin boolean NOT NULL DEFAULT false,
  negative_margin_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  CHECK (mode <> 'markup' OR markup_bps IS NOT NULL),
  CHECK (mode <> 'fixed' OR fixed_prices IS NOT NULL),
  CHECK (allow_negative_margin = false OR negative_margin_reason IS NOT NULL)
);
```

`fixed_prices` accepts only a versioned schema containing the billing units
already supported by model mappings: input, output, cached input, cache write,
image input/output, request, web search, audio, OCR page, character, and
per-second resolution prices. Unknown keys fail validation.

```ts
type FixedPricesV1 = {
  version: 1;
  inputPerMillionTokens?: string;
  outputPerMillionTokens?: string;
  cachedInputPerMillionTokens?: string;
  cacheWritePerMillionTokens?: string;
  cacheWrite1hPerMillionTokens?: string;
  imageInput?: string;
  imageOutput?: string;
  request?: string;
  webSearch?: string;
  audioOutputPerMillionTokens?: string;
  ocrPage?: string;
  inputPerMillionCharacters?: string;
  perSecondByResolution?: Record<string, string>;
};
```

All price strings are non-negative base-10 decimals. A fixed policy must
provide every unit that the selected mapping can bill. Zero is valid and must
be explicit.

Display-name, description, alias, and website overrides affect BetaRouter
presentation only; source metadata remains available for comparison and reset.
Mapping limits and `disabled_capabilities` may only narrow the source mapping's
declared capabilities. Launch Admin cannot claim a larger context window,
higher output limit, new modality, tools, streaming, or other capability the
source adapter does not declare. Expanding capabilities requires a source-code
catalog update and adapter tests.

### `platform_catalog_change_set`

```sql
CREATE TABLE platform_catalog_change_set (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  title text NOT NULL,
  reason text NOT NULL,
  state text NOT NULL
    CHECK (state IN ('draft','scheduled','applying','applied','failed','cancelled','rolled_back')),
  base_revision bigint REFERENCES platform_catalog_revision(id),
  operations jsonb NOT NULL,
  impact_snapshot jsonb,
  effective_at timestamptz,
  applied_at timestamptz,
  applied_revision bigint REFERENCES platform_catalog_revision(id),
  inverse_of text REFERENCES platform_catalog_change_set(id),
  error_code text,
  idempotency_key text NOT NULL UNIQUE
);
```

### `platform_mapping_test_run`

```sql
CREATE TABLE platform_mapping_test_run (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  mapping_id text NOT NULL REFERENCES model_provider_mapping(id),
  credential_id text REFERENCES platform_provider_credential(id),
  catalog_revision bigint REFERENCES platform_catalog_revision(id),
  status text NOT NULL CHECK (status IN ('running','passed','failed','error')),
  test_profile text NOT NULL,
  latency_ms integer,
  upstream_status integer,
  error_class text,
  sanitized_message text,
  finished_at timestamptz
);
```

Test records never store plaintext credentials, raw customer prompts, or full
upstream responses.

### Audit and runtime state

Catalog mutations append to the existing platform audit log using new actions
for preview, apply, schedule, cancel, rollback, test, circuit-open, and
circuit-close. Impact snapshots and before/after values are retained.

Circuit-breaker runtime state lives in Redis by mapping ID and catalog revision:
`closed`, `open`, or `half_open`, plus failure count, opened time, retry time,
and last probe result. Periodic summaries are persisted for the Admin health
view; Redis loss safely resets breakers to closed while static eligibility still
applies.

## Change-set operation contract

Operations use a versioned discriminated union. Supported launch operations:

- `provider.set_policy`
- `model.set_policy`
- `mapping.set_policy`
- `mapping.set_price_policy`
- `mapping.set_external_id`
- `entity.archive_policy`

Every operation includes entity ID, expected current `updatedAt`, and desired
fields. Optimistic concurrency conflicts fail the complete change set.

```ts
type CatalogOperationV1 =
  | {
      version: 1;
      type: "provider.set_policy";
      providerId: string;
      expectedUpdatedAt: string | null;
      patch: Partial<ProviderPolicyInput>;
    }
  | {
      version: 1;
      type: "model.set_policy";
      modelId: string;
      expectedUpdatedAt: string | null;
      patch: Partial<ModelPolicyInput>;
    }
  | {
      version: 1;
      type: "mapping.set_policy";
      mappingId: string;
      expectedUpdatedAt: string | null;
      patch: Partial<MappingPolicyInput>;
    }
  | {
      version: 1;
      type: "mapping.set_price_policy";
      mappingId: string;
      expectedUpdatedAt: string | null;
      policy: MappingPricePolicyInput;
    }
  | {
      version: 1;
      type: "entity.archive_policy";
      entityType: "provider" | "model" | "mapping";
      entityId: string;
      expectedUpdatedAt: string;
    };
```

`ProviderPolicyInput`, `ModelPolicyInput`, `MappingPolicyInput`, and
`MappingPricePolicyInput` are generated from the constrained table schemas
above. Unknown fields and unknown operation versions fail with HTTP 400.

## Admin API

All routes use the existing platform-admin middleware and audit metadata.

| Method | Route                                        | Purpose                                                                         |
| ------ | -------------------------------------------- | ------------------------------------------------------------------------------- |
| GET    | `/admin/catalog/summary`                     | Counts and launch-readiness problems.                                           |
| GET    | `/admin/catalog/providers`                   | Providers with source, policy, credential, health, and effective state.         |
| GET    | `/admin/catalog/models`                      | Models with policy, mappings, lifecycle, pricing, traffic, and effective state. |
| GET    | `/admin/catalog/mappings`                    | Mapping-level routing, price, margin, credential, and health data.              |
| GET    | `/admin/catalog/revisions/{revision}`        | Immutable effective snapshot metadata.                                          |
| POST   | `/admin/catalog/change-sets/preview`         | Validate operations and calculate impact without mutation.                      |
| POST   | `/admin/catalog/change-sets`                 | Save a draft or scheduled change set.                                           |
| POST   | `/admin/catalog/change-sets/{id}/apply`      | Atomically apply a current draft.                                               |
| POST   | `/admin/catalog/change-sets/{id}/cancel`     | Cancel a draft or scheduled change.                                             |
| POST   | `/admin/catalog/change-sets/{id}/rollback`   | Create and apply an inverse change set.                                         |
| GET    | `/admin/catalog/change-sets`                 | Search history and scheduled work.                                              |
| POST   | `/admin/catalog/mappings/{id}/test`          | Run a sanitized preflight test.                                                 |
| GET    | `/admin/catalog/mappings/{id}/health`        | Health, breaker, credential, and recent test state.                             |
| POST   | `/admin/catalog/mappings/{id}/breaker/reset` | Close a breaker after validation.                                               |

Mutation responses include `changeSetId`, `catalogRevision`, affected entities,
and cache invalidation status. Preview responses include blockers, warnings,
affected request/customer/key counts for a configurable lookback, fallback
coverage, price deltas, and margin deltas.

```json
{
  "title": "Curate launch catalog",
  "reason": "Publish the initial supported model set",
  "baseRevision": 12,
  "effectiveAt": null,
  "idempotencyKey": "client-generated-unique-value",
  "operations": []
}
```

```json
{
  "valid": true,
  "baseRevision": 12,
  "resultingChecksum": "sha256:...",
  "blockers": [],
  "warnings": [],
  "affected": {
    "providers": 0,
    "models": 0,
    "mappings": 0,
    "requests": 0,
    "organizations": 0,
    "projects": 0,
    "apiKeys": 0,
    "queuedJobs": 0
  },
  "fallbackLosses": [],
  "priceChanges": [],
  "marginEstimate": null
}
```

## Admin interface

Add a top-level **Catalog** section while preserving the existing analytics
pages. The section has five tabs:

1. **Overview**: visible/available/routable counts, blocked launch items,
   credential coverage, health, scheduled changes, and recent revisions.
2. **Providers**: visibility, availability, credentials, active model count,
   health, and bulk actions.
3. **Models**: canonical model metadata, lifecycle, replacement, mapping
   coverage, price range, traffic, and bulk actions.
4. **Mappings**: provider/model/external ID, region, credential source,
   priority, weight, price, margin, tests, breaker, and fallback coverage.
5. **Changes**: drafts, previews, schedules, applied revisions, audit details,
   and rollback actions.

```text
+ Catalog ---------------------------------------------------------------+
| Revision 12  Visible 12  Available 12  Routable 11  Blockers 1         |
| [Overview] [Providers] [Models] [Mappings] [Changes]                   |
|-------------------------------------------------------------------------|
| Search...  State [All]  Provider [All]  Health [All]   [Bulk actions]  |
| [ ] Model              Visible  API  Routes  Price      Health  Reason |
| [ ] flagship-model       on     on     2      $...      healthy        |
| [ ] legacy-model         off    off    0      missing   blocked  [why] |
|-------------------------------------------------------------------------|
| 2 selected                      [Edit] [Preview change]                 |
+-------------------------------------------------------------------------+

Preview change
  Blockers (must fix) -> Warnings (acknowledge) -> Impact -> Apply/Schedule
```

The default table emphasizes the effective customer outcome. Source metadata,
policy values, credentials, tests, and runtime health remain inspectable but do
not compete visually with the three primary state columns.

### Interaction requirements

- Filters for visible, hidden, available, unavailable, deprecated, retired,
  unhealthy, unpriced, uncredentialed, untested, and source/provider/modalities.
- Persistent bulk selection across pagination with a visible selected count.
- Sticky action bar for bulk show/hide, enable/disable, lifecycle, priority, and
  price-mode changes.
- Every save opens the impact preview before Apply or Schedule.
- Dangerous operations require typed confirmation containing the affected
  entity count, not a generic confirmation dialog.
- Admin distinguishes source metadata from BetaRouter overrides and offers
  “reset to source” only for overrideable metadata.
- Effective-state badges explain why an item is not visible, available, or
  routable.
- Empty and error states identify the missing dependency and link to Platform
  Providers when credentials are missing.
- Health and test errors remain sanitized; no credential or upstream response
  body is displayed accidentally.

## Pricing and margin rules

1. Source mapping prices remain the upstream cost source.
2. Customer prices resolve from fixed override, markup, or source-cost mode.
3. Discounts apply after customer price calculation and are displayed in the
   impact preview.
4. Activation is blocked if required billing units lack a customer price.
5. Negative expected margin is blocked unless the operator explicitly enables
   it and supplies a reason captured in audit history.
6. Routing uses upstream cost and configured priorities; billing uses the
   effective customer price associated with the selected mapping.
7. Impact preview evaluates margin against recent usage mix when data exists and
   labels estimates when traffic is insufficient.

## Testing console

The launch test console selects a mapping and credential and runs the
`minimal-chat` profile. It sends a minimal non-sensitive request through the
same adapter, URL-safety validation, credential resolution, and response
normalization used by production. Non-chat mappings remain disabled at launch;
operation-specific profiles for embeddings, moderation, image, audio, OCR, and
video are tracked in the future build plan and are required before those
mappings can activate.

Activation requires a passing test after changes to external ID, credential,
base URL, provider options, or capability-critical mapping fields. Price-only,
visibility-only, and sort-order changes do not invalidate a test.

## Health and circuit breaker

Health aggregates recent gateway outcomes by mapping ID, excluding customer
4xx errors from upstream-failure calculations. Defaults are configurable but
launch behavior is:

- open after at least 5 eligible requests and either 5 consecutive upstream
  failures or a 50% upstream-failure rate over the last 20 eligible requests;
- remain open for 60 seconds;
- half-open with one probe at a time;
- close after 2 successful probes;
- extend cooldown exponentially to a capped 15 minutes on repeated failure.

Opening a breaker removes only that mapping. The model remains available when a
healthy fallback exists. If no fallback exists, new requests receive a
retryable `503 model_temporarily_unavailable`; the model remains visible with
live status unless the operator separately hides it.

## Deprecation and customer migration

- `deprecatedAt` begins the warning period.
- `retireAt` ends new request acceptance.
- A replacement model must be active and available before a retirement with a
  replacement can be scheduled.
- Deprecated responses include `Deprecation`, `Sunset`, and BetaRouter
  replacement headers where protocol-safe.
- The public catalog and dashboard show warning text and replacement links.
- Retired direct requests return HTTP 410 with machine-readable replacement and
  retirement metadata.
- Existing asynchronous jobs continue against their persisted mapping unless
  explicitly cancelled by an emergency action.

## Cache and propagation contract

- Applying a change increments the catalog revision transactionally.
- API publishes a Redis invalidation event after commit.
- API, gateway, and worker subscribe and discard older snapshots.
- Consumers also compare the current revision periodically so a missed event
  self-heals.
- Public model responses include `ETag` derived from revision/checksum.
- A mutation reports success only after the database commit; propagation status
  is observable but cannot roll back a committed revision automatically.
- Request-time policy fails closed when the resolver cannot load any valid
  snapshot. It may use the last verified snapshot for a bounded five-minute
  stale window during transient Redis/DB errors.

## Scheduled changes

The worker claims due change sets with database row locking and an idempotency
key. It re-runs validation against the current revision immediately before
apply. A stale or invalid schedule moves to `failed` without partial mutation
and appears prominently in Admin. Scheduled changes use UTC internally and show
the operator's local timezone in the UI.

## Impact preview

Preview must report:

- providers, models, mappings, and credentials affected;
- recent requests, unique organizations, projects, and API keys affected;
- queued asynchronous jobs affected;
- models losing all fallback coverage;
- visibility/API/routing state before and after;
- customer-price and estimated-margin changes;
- replacement model readiness;
- scheduled-change conflicts; and
- hard blockers versus acknowledged warnings.

No impact report returns customer secrets, request bodies, or plaintext keys.

## Acceptance criteria

1. An operator can reduce the visible catalog without changing source model
   definitions or deploying code.
2. Worker catalog synchronization preserves every operator policy and applied
   catalog revision.
3. Website, playground, selectors, `/internal/models`, and `/v1/models` return
   the same visible model and mapping set for the same revision.
4. A hidden, unavailable model cannot be called directly unless
   `allowDirect=true`; the launch default is false.
5. A disabled provider prevents all of its mappings from routing even when an
   environment credential exists.
6. A disabled mapping is never selected in primary or fallback routing.
7. Applying a multi-entity change set is atomic and increments the catalog
   revision exactly once.
8. Stale optimistic-concurrency versions reject a change set without mutation.
9. A rollback creates an audited inverse revision and restores the prior
   effective catalog.
10. Activation is blocked when credentials, pricing, external IDs, required
    options, or required tests are missing or invalid.
11. Fixed and markup pricing produce deterministic customer prices and margin
    calculations for every supported billing unit.
12. Negative margin requires an explicit audited override and reason.
13. A mapping test traverses the production adapter path and stores no secret,
    prompt, or raw response body.
14. Circuit opening removes only the affected mapping; healthy fallbacks remain
    eligible.
15. A model with no healthy fallback returns a retryable 503 and is not routed
    to an ineligible mapping.
16. Scheduled changes apply once, or fail without partial mutation when their
    base revision or validation becomes stale.
17. Deprecated responses and catalog entries include retirement and replacement
    metadata.
18. Retired models return HTTP 410 and never appear in discovery surfaces.
19. Accepted asynchronous jobs retain their catalog revision, mapping, and
    credential IDs across later catalog changes.
20. Every preview, apply, schedule, cancel, rollback, test, and breaker reset is
    auditable by actor and request metadata.
21. Bulk actions support at least 500 selected rows without partial application.
22. Cache invalidation reaches API, gateway, and worker, and missed events
    self-heal through revision polling.
23. Existing organization provider keys, encrypted Platform Providers, usage
    logs, billing records, and historical analytics remain intact.
24. Admin contains no new role-management UI and continues using the current
    single platform-admin authorization.

## Testing decisions

Tests assert external behavior at the highest stable seam and add focused unit
coverage for pure policy logic.

| Layer               | Required coverage                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                | Effective-state truth table, lifecycle dates, price/margin calculation, change-set validation, inverse operations, breaker transitions, cache revision handling. |
| Database            | Constraints, migrations, sync preserving policies, atomic revision apply, stale revision rejection, scheduled claim idempotency, rollback history.               |
| API integration     | List/filter endpoints, preview blockers, apply/schedule/cancel/rollback, audit records, sanitized mapping tests, impact aggregation.                             |
| Gateway integration | Hidden/unavailable/retired request behavior, mapping exclusion, fallback order/weight, circuit behavior, pricing/billing linkage, revision reload.               |
| Worker integration  | Source sync coexistence, scheduled application, persisted job mapping/revision, missed-event self-healing.                                                       |
| Admin component     | Filters, bulk selection, dependency explanations, preview confirmation, scheduling, rollback, accessibility and error states.                                    |
| E2E                 | Curate catalog in Admin, verify all public lists, call active model, reject disabled model, trigger fallback, deprecate/retire, rollback.                        |
| Production canary   | Seed a hidden canary model/mapping, test direct rejection, publish it, validate routing/billing, hide it, and confirm propagation.                               |

## Rollout and rollback

1. Deploy additive tables and resolver in shadow mode while existing behavior
   remains authoritative.
2. Seed policies from current behavior, then create a curated launch change set
   with all entries hidden/disabled except the operator-selected launch set.
3. Compare shadow and legacy decisions in logs without customer impact.
4. Switch discovery endpoints to the resolver.
5. Switch request validation, routing, billing, and workers to the resolver.
6. Enable Admin mutation and scheduled changes after parity and canary checks.
7. Enable circuit breakers last, initially in observe-only mode.

Rollback switches consumers to the last verified catalog revision. Schema
migrations are additive and remain in place. Reverting the application image
restores legacy catalog behavior, while policy tables and audit history are
preserved for a later retry.

## Future build plan

The following are intentionally deferred and must not be accidentally folded
into the launch implementation. The maintained execution backlog is
`docs/future-build-plan-admin-model-catalog.md`:

1. Role-based separation for catalog editors, credential administrators,
   approvers, and read-only operators.
2. Organization-, project-, subscription-plan-, region-, and API-key-specific
   catalog policies.
3. Generic custom provider adapters, arbitrary headers, non-bearer
   authentication, and HTTP/SOCKS proxy configuration.
4. Fully custom shared platform models that do not exist in the source catalog.
5. Automatic upstream model discovery and catalog-diff suggestions with manual
   approval.
6. Curated customer collections, tags, favorites, recommended defaults, and
   personalized ordering.
7. Multi-currency pricing, taxes, negotiated provider rates, and contract-term
   management.
8. Per-provider capacity quotas, reservation management, and cost-aware global
   capacity balancing.
9. Approval workflows requiring a second operator for high-impact changes.
10. Customer-visible maintenance windows and subscription-based catalog-change
    notifications.
11. Export/import between environments and full configuration promotion from
    staging to production.
12. Automated replacement recommendations based on quality, cost, capability,
    and historical customer behavior.

## Definition of done

The release is done when all acceptance criteria pass, the operator can publish
a curated launch catalog through Admin without a deploy, all customer-facing
and routing surfaces resolve the same catalog revision, rollback has been
exercised in staging and production canary, and deferred items remain documented
in the future build plan.

## Primary file reference

| Path                                                                         | Planned responsibility                                                                                                       |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/schema.ts`                                                  | Add catalog policy, revision, change-set, price, test, audit references, and job linkage.                                    |
| `packages/db/drizzle/`                                                       | Add forward-only additive migrations.                                                                                        |
| `packages/catalog/`                                                          | New internal server package containing the effective resolver, schemas, revision cache, pricing, impact, and breaker policy. |
| `apps/worker/src/services/sync-models.ts`                                    | Preserve source synchronization while proving policy independence.                                                           |
| `apps/worker/src/services/`                                                  | Add scheduled change application and persisted health summaries.                                                             |
| `apps/api/src/routes/catalog.ts`                                             | New platform-admin catalog API, previews, revisions, tests, scheduling, and rollback.                                        |
| `apps/api/src/routes/internal-models.ts`                                     | Return effective revisioned discovery data.                                                                                  |
| `apps/gateway/src/models/models.ts`                                          | Make `/v1/models` use the effective snapshot.                                                                                |
| `apps/gateway/src/chat/tools/resolve-provider-context.ts`                    | Enforce the eligible mapping set at the central chat routing seam.                                                           |
| `apps/gateway/src/embeddings/`, `moderations/`, `ocr/`, `speech/`, `videos/` | Enforce the same central policy for non-chat modalities and jobs.                                                            |
| `ee/admin/src/app/catalog/`                                                  | New Overview, Providers, Models, Mappings, and Changes interface.                                                            |
| `ee/admin/src/components/`                                                   | Shared catalog tables, policy editors, preview, health, test, and revision components.                                       |
| `ee/admin/src/lib/api/v1.d.ts`                                               | Regenerated API contract.                                                                                                    |
| `docs/`                                                                      | Operator runbook, lifecycle semantics, rollout, rollback, and future backlog.                                                |
