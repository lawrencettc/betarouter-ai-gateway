# BetaRouter Admin Model Catalog Operations

Date: 2026-07-22

This is the production rollout, verification, and rollback runbook for
`admin.betarouter.com/catalog` on the single DigitalOcean deployment behind the
Cloudflare Tunnel.

## Launch boundary

- The first launch catalog is curated by the operator in Admin.
- Text/chat mappings may activate after an exact `minimal-chat` test passes.
  This includes text+image chat models (e.g. the Gemini image previews):
  their output contains text, so they derive the chat profile.
- Embeddings mappings may activate after an exact `minimal-embeddings` test
  passes (Stage 11).
- Image-only mappings (model output `["image"]` without text) may activate
  after an exact `minimal-images` test passes (Stage 12).
- Video mappings may activate after an exact `minimal-videos` test passes
  (Stage 13); serving additionally requires the videos enforcement flag.
- Speech mappings (model output `["audio"]` without text) may activate after
  an exact `minimal-speech` test passes (Stage 14); serving additionally
  requires the speech enforcement flag. Text+audio chat models (native-audio
  / realtime deployments) stay on `minimal-chat`.
- Transcription mappings (model output `["transcription"]`) may activate
  after an exact `minimal-transcriptions` test passes (Stage 15); OCR
  mappings (output `["ocr"]`) after `minimal-ocr` (Stage 16); rerank
  mappings (output `["rerank"]`) after `minimal-rerank` (Stage 17); the
  moderation mapping (output `["moderation"]`) after `minimal-moderations`
  (Stage 18). Serving each additionally requires that modality's
  enforcement flag.
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
PLATFORM_CATALOG_EMBEDDINGS_ROUTING_ENABLED=false
PLATFORM_CATALOG_VIDEOS_ROUTING_ENABLED=false
PLATFORM_CATALOG_SPEECH_ROUTING_ENABLED=false
PLATFORM_CATALOG_TRANSCRIPTIONS_ROUTING_ENABLED=false
PLATFORM_CATALOG_OCR_ROUTING_ENABLED=false
PLATFORM_CATALOG_RERANK_ROUTING_ENABLED=false
PLATFORM_CATALOG_MODERATIONS_ROUTING_ENABLED=false
PLATFORM_CATALOG_BREAKER_MODE=off
```

The production Compose file forwards all twelve flags to the unified service.
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

Modality routing flags (`embeddings`, `imageGenerations`, `videoGenerations`,
`speechGenerations`, `transcriptions`, `realtime`, `realtimeTranscription`,
`ocr`, `rerank`), the modality serving-config (`supportedVideoSizes`,
`supportedVideoDurationsSeconds`, `supportedVideoDurationsSecondsImageToVideo`,
`supportsVideoAudio`, `supportsVideoWithoutAudio`, `supportedVoices`,
`contentFilterPrice`), and the model-level `imageInputRequired` /
`maxVideoDurationSeconds` are mirrored, snapshot-carried, and settable on
`*.create` / `*.update` / source-override operations, so admin-created
non-chat mappings route, validate requests, and bill content-filter charges
from the snapshot alone. `contentFilterPrice` is base data, not a price-policy
unit: markup/fixed policies do not transform it. Revisions published before
these mirrors existed lack the fields; reconstruction grafts them from the
static array there, which means an admin-created non-chat mapping only serves
correctly from revisions published after this build's first sync.

Provider base data (`name`, `description`, `protocol`, `streaming`,
`cancellation`, `color`, `website`, `announcement`, `priority`,
`contentFilter`, `maxTemperature`, `serviceTiers`, `regionConfig`, the policy
links, `apiKeyInstructions`, `modelCardBadge`, `additionalLinks`, and the
code-only compliance attestations) rides the snapshot the same way:
`resolveProviderFromCatalog` reconstructs a provider definition with
snapshot-wins / null-mirror-is-authoritative / graft-for-older-revisions
semantics, and the gateway consumes it catalog-first under
`PLATFORM_CATALOG_BASE_READ_ENABLED` for routing priority, content-filter
rerouting, region config (locks, pinned defaults, key regions), temperature
clamping, cancellation, and the wire protocol of database-defined providers.
Two deliberate carve-outs: `env` is deployment config and never mirrors
(admin-created providers get an empty env config and are credentialed only
through platform credentials), and a `protocol` override on a _static_
provider does not switch transports — code-declared protocols and id-keyed
bespoke transports stay authoritative for code providers; protocol-as-data
only drives providers without a code declaration (admin-created ones).
Compliance gates keep reading the static attestations (not overridable, so
never divergent) and fail closed for admin-created providers.

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

### Stage 10: Admin console workflows

No flag gates this stage; it is UI over the Stage 8/9 operations, so every
write still lands as a previewed, applied, revisioned change set. The Admin
Catalog page adds:

- **Create** buttons on the Providers/Models/Mappings tabs staging
  `provider.create` / `model.create` / `mapping.create`. Created entries are
  admin-owned drafts; the relay flow continues with credentials, mapping
  test, and price policy exactly as in Stage 8.
- **Source fields** (layers icon) per row. On a static entry it is the
  three-value editor — source (mirror), override, and effective per field —
  staging `*.set_source_override` (a cleared field reverts to upstream) or
  `*.clear_source_override` for the whole entry. A field whose recorded base
  value no longer matches the mirror shows an "Upstream moved" badge. On an
  admin-created entry the same dialog edits the source row directly through
  the `provider.update` / `model.update` / `mapping.update` operations —
  admin rows have no code counterpart, so there is no mirror to override;
  the inverse operation captures the previous values for rollback. Direct
  updates refuse static targets (`update_targets_static_entity`), and
  overrides still refuse admin targets (`override_targets_admin_entity`).
- **Review** tab: the Stage 9 queue with open counts, on-demand reconcile,
  acknowledge for informational entries, and Keep/Clear actions that stage
  the corresponding override change set for a drift entry.
- **Retire** (trash icon) wired to `entity.archive_policy` — hide, disable,
  and retire the policy. Nothing is ever hard-deleted.

### Stage 11: Embeddings modality rollout

The first Phase 7 modality slice. `/v1/embeddings` now resolves model base
data through the same shared resolver as chat (static by default,
catalog-first under `PLATFORM_CATALOG_BASE_READ_ENABLED`, dual-resolve
divergence logging under `PLATFORM_CATALOG_SHADOW_READ` — the same
zero-pricing-divergence abort rule applies), and passes
`operation: "embeddings"` to catalog request enforcement.

Enforcement is gated separately so this stage cannot break embeddings
traffic on deploy: embeddings requests enforce catalog decisions only when
BOTH `PLATFORM_CATALOG_ROUTING_ENABLED` and
`PLATFORM_CATALOG_EMBEDDINGS_ROUTING_ENABLED` are true. Until the second
flag flips, embeddings stay on legacy routing while shadow reads log every
decision.

1. Deploy with `PLATFORM_CATALOG_EMBEDDINGS_ROUTING_ENABLED` unset (off).
   With shadow reads on, `Catalog routing decision` log lines with
   `operation: "embeddings"` appear immediately; expect `allowed: false`
   (`model_not_available`) until embeddings mappings are activated — that is
   the soak signal, not a fault.
2. Activate each embeddings mapping exactly as in Stage 8: credential, a
   passed mapping test, price policy, enablement. The test console derives
   the `minimal-embeddings` probe from the model's output modalities; a
   passed `minimal-chat` run never satisfies an embeddings mapping (and the
   activation validator blocks enabling until the right probe passed).
   Pricing units for this modality are the per-token `inputPrice` and the
   flat `requestPrice`; `inputCharacterPrice` also flows through price
   policies, though no current embeddings mapping uses it.
3. When the shadow decisions for embeddings traffic are `allowed: true` with
   the expected mapping ids and prices, set
   `PLATFORM_CATALOG_EMBEDDINGS_ROUTING_ENABLED=true` in the deployment
   secret file (no rebuild) and restart.
4. Rollback for this stage alone: unset
   `PLATFORM_CATALOG_EMBEDDINGS_ROUTING_ENABLED`. Embeddings return to
   legacy routing without touching chat enforcement.

### Stage 12: Images modality rollout

Unlike embeddings, images introduce no new flag and no new enforcement
operation: `/v1/images/generations` and `/v1/images/edits` re-dispatch
internally through `/v1/chat/completions`, and that hop has enforced catalog
decisions under `PLATFORM_CATALOG_ROUTING_ENABLED` since routing flipped.
Text+image chat models have therefore been fully governed — routed, gated,
and billed through the catalog — since their `minimal-chat` activation.

What this stage adds is activation for image-ONLY models (output
`["image"]`), which previously had no probe profile and were held disabled
by the launch boundary; under chat enforcement they reject with
`model_not_available` (404) until activated. Per-mapping activation IS the
flip: blast radius is one mapping, and rollback is disabling it again. The
images surface's model-output guard also resolves through the shared
resolver now (static by default, catalog-first under
`PLATFORM_CATALOG_BASE_READ_ENABLED`, divergence-logged under
`PLATFORM_CATALOG_SHADOW_READ`), so admin-created image models are
validated like static ones.

1. Activate each image-only mapping exactly as in Stage 8: credential, a
   passed mapping test, price policy, enablement. The test console derives
   the `minimal-images` probe from the model's output modalities; a passed
   `minimal-chat` run never satisfies an image mapping (the activation
   validator blocks enabling until the right probe passed). Each
   minimal-images run performs one real minimal generation against the
   deployment and bills its cost — cents rather than the embeddings probe's
   fractions of a cent, the same trade the chat probe makes with tokens.
   The probe covers OpenAI-compatible deployments (including admin-created
   relays), Azure, xAI, Z.AI, ByteDance, Alibaba, and Reve; Google image
   deployments have no image-only probe shape yet and must stay disabled.
2. Pricing units for this modality: per-token `imageInputPrice`,
   `imageOutputPrice`, and `cachedImageInputPrice` (mirrored per million),
   plus the flat per-request `requestPrice`. All flow through fixed and
   markup price policies. `contentFilterPrice` is mirrored base data (the
   serving-config slice): the snapshot carries it and it can be set on
   admin-created mappings, but price policies do not transform it — it
   bills at the mirrored flat USD amount.
3. Verify each activated mapping with a pinned request
   (`<provider>/<model>` plus `x-no-fallback: true`) through
   `/v1/images/generations`, then confirm the log row's billed cost matches
   the mapping's effective prices.
4. Rollback for this stage alone: disable the affected mapping(s) or model
   via policy — image-only models return to their pre-activation 404 and no
   other modality is touched. There is no modality flag to unset; anything
   broader follows the emergency rollback ladder below.

### Stage 13: Videos modality rollout

Videos follow the embeddings pattern, not the images one: `/v1/videos` has
its own catalog enforcement call, so this stage flips a dedicated flag.
Video requests enforce catalog decisions only when BOTH
`PLATFORM_CATALOG_ROUTING_ENABLED` and
`PLATFORM_CATALOG_VIDEOS_ROUTING_ENABLED` are true; until the second flag
flips, videos stay on legacy routing while shadow reads log every decision
with `operation: "videos"`.

Two things are new beyond the embeddings template:

- **Async billing replay.** Video jobs bill on completion in the worker,
  minutes after dispatch. A job dispatched under catalog enforcement is
  stamped with its revision and mapping (`catalog_revision_id`,
  `model_provider_mapping_id` on `video_job`), and the worker bills from
  THAT revision's customer prices — per-second-by-resolution
  (`second:<resolution>` units), per-image input, and flat request price —
  not from the static array and not from whatever revision is latest at
  completion. Jobs without lineage (dispatched before the flip) keep static
  billing.
- **Probe cost.** The `minimal-videos` probe submits one real
  cheapest-settings text-to-video generation (shortest supported duration,
  no audio) and passes on upstream ACCEPTANCE — it never polls or downloads
  the result. The accepted generation still runs and is billed by the
  provider (dollars-order, one-time per mapping + credential fingerprint),
  and its output is discarded. The probe covers Google Vertex (API-key
  credentials with `google_vertex_project_id`; OAuth refused), xAI,
  MiniMax, ByteDance, Alibaba, AtlasCloud, Avalanche, and OpenAI-compatible
  `/v1/videos` deployments including relays. Veo probes may need the
  mapping's region set if the default region is rejected.

1. Deploy with `PLATFORM_CATALOG_VIDEOS_ROUTING_ENABLED` unset (off). With
   shadow reads on, expect `operation: "videos"` decisions with
   `allowed: false` until video mappings are activated — the soak signal,
   not a fault.
2. Activate each video mapping exactly as in Stage 8: credential, a passed
   `minimal-videos` test (a `minimal-chat` run never satisfies a video
   mapping), price policy, enablement. Fixed price policies must cover the
   per-second units via `perSecondByResolution`.
3. When shadow decisions for video traffic are `allowed: true` with the
   expected mapping ids and prices, set
   `PLATFORM_CATALOG_VIDEOS_ROUTING_ENABLED=true` in the deployment secret
   file (no rebuild) and restart. Verify one pinned generation per
   activated mapping and compare the finalized log row's cost against the
   mapping's effective prices (remember completion lags dispatch).
4. Rollback for this stage alone: unset
   `PLATFORM_CATALOG_VIDEOS_ROUTING_ENABLED`. Videos return to legacy
   routing and static billing for newly dispatched jobs without touching
   chat or embeddings enforcement; in-flight jobs with lineage still bill
   at their dispatch revision, which remains correct.

### Stage 14: Speech modality rollout

Speech (text-to-speech, `/v1/audio/speech`) follows the videos template
minus the async part: the surface bills synchronously at request time from
the catalog-filtered mapping, so there is no billing replay to stage.
Speech requests enforce catalog decisions only when BOTH
`PLATFORM_CATALOG_ROUTING_ENABLED` and
`PLATFORM_CATALOG_SPEECH_ROUTING_ENABLED` are true; until the second flag
flips, speech stays on legacy routing while shadow reads log every decision
with `operation: "speech"`.

- **Probe cost.** The `minimal-speech` probe synthesizes one three-character
  utterance through the exact deployment the mapping routes to and passes on
  a success response whose body is plausibly audio (or, for JSON transports,
  valid JSON). Character-billed models make this the cheapest probe of any
  modality — fractions of a cent per run. The probe covers OpenAI,
  ElevenLabs, Google AI Studio, Google Vertex (API-key credentials with
  `google_vertex_project_id`; OAuth refused), Alibaba DashScope, and
  OpenAI-compatible `/v1/audio/speech` deployments including relays. The
  probe voice comes from the mapping's mirrored `supportedVoices` (first
  entry), so keep that list accurate on admin-created mappings.
- **Prices.** Character-billed mappings mirror `inputCharacterPrice` as the
  per-million `inputCharacters` unit; token-billed TTS (e.g. SSE-usage
  OpenAI models) bills through `input`/`audioOutput`. Both flow through
  fixed and markup price policies.

1. Deploy with `PLATFORM_CATALOG_SPEECH_ROUTING_ENABLED` unset (off). With
   shadow reads on, expect `operation: "speech"` decisions with
   `allowed: false` until speech mappings are activated — the soak signal,
   not a fault.
2. Activate each speech mapping exactly as in Stage 8: credential, a passed
   `minimal-speech` test (a `minimal-chat` run never satisfies a speech
   mapping), price policy, enablement.
3. When shadow decisions for speech traffic are `allowed: true` with the
   expected mapping ids and prices, set
   `PLATFORM_CATALOG_SPEECH_ROUTING_ENABLED=true` in the deployment secret
   file (no rebuild) and restart. Verify one pinned synthesis per activated
   mapping through `/v1/audio/speech` and compare the log row's billed cost
   against the mapping's effective prices.
4. Rollback for this stage alone: unset
   `PLATFORM_CATALOG_SPEECH_ROUTING_ENABLED`. Speech returns to legacy
   routing and static billing without touching any other modality's
   enforcement.

### Stage 15: Transcriptions modality rollout

Transcriptions (speech-to-text, `/v1/audio/transcriptions`) follows the
speech template: the surface bills synchronously at request time from the
catalog-filtered mapping (audio-hour duration billing), so there is no
billing replay to stage. Transcription requests enforce catalog decisions
only when BOTH `PLATFORM_CATALOG_ROUTING_ENABLED` and
`PLATFORM_CATALOG_TRANSCRIPTIONS_ROUTING_ENABLED` are true; until the
second flag flips, transcriptions stay on legacy routing while shadow reads
log every decision with `operation: "transcriptions"`.

- **Probe cost.** The `minimal-transcriptions` probe transcribes one
  synthesized half-second WAV clip through the exact deployment the mapping
  routes to and passes on a JSON success body. The endpoint path and
  multipart shape mirror the gateway's dispatch — a multipart POST to
  `{baseUrl}/v1/stt` with no `model` form field, because the gateway never
  sends one — so any deployment that needs a different shape fails the
  probe rather than failing live traffic. Audio-hour billing prices the run
  at fractions of a cent (half a second of audio).
- **Prices.** Duration-billed mappings mirror `inputAudioHourPrice` as the
  flat USD-per-hour `audioHour` unit (not a per-million unit), plus
  `requestPrice` where set. Both flow through fixed and markup price
  policies.

1. Deploy with `PLATFORM_CATALOG_TRANSCRIPTIONS_ROUTING_ENABLED` unset
   (off). With shadow reads on, expect `operation: "transcriptions"`
   decisions with `allowed: false` until transcription mappings are
   activated — the soak signal, not a fault. Transcription models (output
   `["transcription"]`) previously had no probe profile and were held
   disabled by the launch boundary.
2. Activate each transcription mapping exactly as in Stage 8: credential, a
   passed `minimal-transcriptions` test (a `minimal-chat` run never
   satisfies a transcription mapping), price policy, enablement.
3. When shadow decisions for transcription traffic are `allowed: true` with
   the expected mapping ids and prices, set
   `PLATFORM_CATALOG_TRANSCRIPTIONS_ROUTING_ENABLED=true` in the deployment
   secret file (no rebuild) and restart. Verify one pinned transcription
   per activated mapping through `/v1/audio/transcriptions` and compare the
   log row's billed cost against the mapping's effective `audioHour` price
   times the reported duration.
4. Rollback for this stage alone: unset
   `PLATFORM_CATALOG_TRANSCRIPTIONS_ROUTING_ENABLED`. Transcriptions return
   to legacy routing and static billing without touching any other
   modality's enforcement.

### Stage 16: OCR modality rollout

OCR (`/v1/ocr`) follows the transcriptions template: the surface bills
synchronously at request time from the catalog-filtered mapping (per-page
billing on the upstream's reported `pages_processed`), so there is no
billing replay to stage. OCR requests enforce catalog decisions only when
BOTH `PLATFORM_CATALOG_ROUTING_ENABLED` and
`PLATFORM_CATALOG_OCR_ROUTING_ENABLED` are true; until the second flag
flips, OCR stays on legacy routing while shadow reads log every decision
with `operation: "ocr"`.

- **Probe cost.** The `minimal-ocr` probe runs OCR over one synthesized
  single-page PNG (built in code — no binary asset) through the exact
  deployment the mapping routes to and passes on a JSON success body. The
  endpoint path and payload shape mirror the gateway's dispatch: a JSON
  POST to `{baseUrl}/v1/ocr` with the model id and an inline `image_url`
  document. Page billing prices the run at one page (Mistral: $0.004).
- **Prices.** Page-billed mappings mirror `ocrPagePrice` as the flat
  USD-per-page `ocrPage` unit (not a per-million unit), plus `requestPrice`
  where set. Both flow through fixed and markup price policies.

1. Deploy with `PLATFORM_CATALOG_OCR_ROUTING_ENABLED` unset (off). With
   shadow reads on, expect `operation: "ocr"` decisions with
   `allowed: false` until OCR mappings are activated — the soak signal, not
   a fault. OCR models (output `["ocr"]`) previously had no probe profile
   and were held disabled by the launch boundary.
2. Activate each OCR mapping exactly as in Stage 8: credential, a passed
   `minimal-ocr` test (a `minimal-chat` run never satisfies an OCR
   mapping), price policy, enablement.
3. When shadow decisions for OCR traffic are `allowed: true` with the
   expected mapping ids and prices, set
   `PLATFORM_CATALOG_OCR_ROUTING_ENABLED=true` in the deployment secret
   file (no rebuild) and restart. Verify one pinned OCR request per
   activated mapping through `/v1/ocr` and compare the log row's billed
   cost against the mapping's effective `ocrPage` price times the reported
   `pages_processed`.
4. Rollback for this stage alone: unset
   `PLATFORM_CATALOG_OCR_ROUTING_ENABLED`. OCR returns to legacy routing
   and static billing without touching any other modality's enforcement.

### Stage 17: Rerank modality rollout

Rerank (`/v1/rerank`) follows the OCR template: the surface bills
synchronously at request time from the catalog-filtered mapping (ordinary
input-token billing on the upstream's reported usage), so there is no
billing replay to stage and no modality-specific price unit at all. Rerank
requests enforce catalog decisions only when BOTH
`PLATFORM_CATALOG_ROUTING_ENABLED` and
`PLATFORM_CATALOG_RERANK_ROUTING_ENABLED` are true; until the second flag
flips, rerank stays on legacy routing while shadow reads log every decision
with `operation: "rerank"`.

- **Probe cost.** The `minimal-rerank` probe reranks two tiny documents
  against a one-word query through the exact deployment the mapping routes
  to and passes on a JSON success body. Endpoint paths mirror the gateway's
  dispatch: DeepInfra's inference endpoint (with the same `/v1/openai`
  suffix strip), Cohere-compatible `/v1/rerank` for everything else. Token
  billing prices the run at a few dozen input tokens — the cheapest probe
  of any modality.

1. Deploy with `PLATFORM_CATALOG_RERANK_ROUTING_ENABLED` unset (off). With
   shadow reads on, expect `operation: "rerank"` decisions with
   `allowed: false` until rerank mappings are activated — the soak signal,
   not a fault. Rerank models (output `["rerank"]`) previously had no probe
   profile and were held disabled by the launch boundary.
2. Activate each rerank mapping exactly as in Stage 8: credential, a passed
   `minimal-rerank` test (a `minimal-chat` run never satisfies a rerank
   mapping), price policy, enablement.
3. When shadow decisions for rerank traffic are `allowed: true` with the
   expected mapping ids and prices, set
   `PLATFORM_CATALOG_RERANK_ROUTING_ENABLED=true` in the deployment secret
   file (no rebuild) and restart. Verify one pinned rerank request per
   activated mapping through `/v1/rerank` and compare the log row's billed
   cost against the mapping's effective input price times the reported
   token usage.
4. Rollback for this stage alone: unset
   `PLATFORM_CATALOG_RERANK_ROUTING_ENABLED`. Rerank returns to legacy
   routing and static billing without touching any other modality's
   enforcement.

### Stage 18: Moderations modality rollout

Moderations (`/v1/moderations`) is the smallest modality: the surface serves
exactly one fixed pseudo-model, `openai-moderation` on provider `openai`
(upstream `omni-moderation-latest` unless the catalog mapping's effective
external id overrides it), and the endpoint is free — every price field on
the mapping is zero and the log rows bill zero cost — so there is no billing
verification at all, only routing and credential binding. Moderation
requests enforce catalog decisions only when BOTH
`PLATFORM_CATALOG_ROUTING_ENABLED` and
`PLATFORM_CATALOG_MODERATIONS_ROUTING_ENABLED` are true; until the second
flag flips, moderations stay on legacy routing while shadow reads log every
decision with `operation: "moderations"`.

- **Probe cost.** The `minimal-moderations` probe classifies one benign
  sentence through the exact deployment the mapping routes to
  (OpenAI-compatible JSON POST to `/v1/moderations`) and passes on a JSON
  success body. The moderation endpoint is free, so the probe costs
  nothing.

1. Deploy with `PLATFORM_CATALOG_MODERATIONS_ROUTING_ENABLED` unset (off).
   With shadow reads on, expect `operation: "moderations"` decisions with
   `allowed: false` until the moderation mapping is activated — the soak
   signal, not a fault. The moderation model (output `["moderation"]`)
   previously declared text output and was held on legacy routing by the
   deferred operation.
2. Activate the `openai-moderation` mapping exactly as in Stage 8:
   credential, a passed `minimal-moderations` test (a `minimal-chat` run
   never satisfies the moderation mapping), price policy, enablement.
3. When shadow decisions for moderation traffic are `allowed: true` with
   the expected mapping id, set
   `PLATFORM_CATALOG_MODERATIONS_ROUTING_ENABLED=true` in the deployment
   secret file (no rebuild) and restart. Verify one `/v1/moderations`
   request returns a classification, its log row records the catalog
   mapping and revision, and the platform credential selected is the
   catalog-bound one.
4. Rollback for this stage alone: unset
   `PLATFORM_CATALOG_MODERATIONS_ROUTING_ENABLED`. Moderations return to
   legacy routing without touching any other modality's enforcement.

## Emergency rollback

Apply the smallest safe rollback in this order:

1. Set `PLATFORM_CATALOG_BREAKER_MODE=off`.
2. Set `PLATFORM_CATALOG_BASE_READ_ENABLED=false`.
3. If only embeddings are affected, set
   `PLATFORM_CATALOG_EMBEDDINGS_ROUTING_ENABLED=false` — embeddings return
   to legacy routing without touching chat enforcement. If only videos are
   affected, set `PLATFORM_CATALOG_VIDEOS_ROUTING_ENABLED=false` likewise;
   if only speech is affected, `PLATFORM_CATALOG_SPEECH_ROUTING_ENABLED=false`;
   if only transcriptions are affected,
   `PLATFORM_CATALOG_TRANSCRIPTIONS_ROUTING_ENABLED=false`; if only OCR is
   affected, `PLATFORM_CATALOG_OCR_ROUTING_ENABLED=false`; if only rerank
   is affected, `PLATFORM_CATALOG_RERANK_ROUTING_ENABLED=false`; if only
   moderations are affected,
   `PLATFORM_CATALOG_MODERATIONS_ROUTING_ENABLED=false`.
4. Set `PLATFORM_CATALOG_ROUTING_ENABLED=false`.
5. If discovery is affected, set
   `PLATFORM_CATALOG_DISCOVERY_ENABLED=false` and
   `PLATFORM_CATALOG_SHADOW_READ=false`.
6. Use Admin rollback preview and audited inverse revision when the issue is an
   operator policy change. The inverse of a creation retires the created
   entry (no catalog row is ever hard-deleted); the inverse of a source
   override restores the previous override values.
7. Redeploy the previous image when the application is faulty. Keep additive
   catalog tables and audit history.
8. Restore the predeploy database backup only for proven data corruption and
   after recording an incident decision. A normal feature rollback does not
   require schema reversal.

## Handoff: Cloudflare Zero Trust

Cloudflare Tunnel provides the public routes, but Cloudflare Zero Trust Access
for `admin.betarouter.com` is not complete because the Cloudflare account's plan
activation/balance payment flow was unavailable. The Admin application still
requires its own platform-admin login; it does not yet have a second edge-access
login layer. Return to this after the Cloudflare billing issue is resolved and
test it without breaking the application sign-in redirect/cookies.
