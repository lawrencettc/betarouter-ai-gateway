# BetaRouter Admin Model Catalog: Future Build Plan

Date: 2026-07-22

This plan is the explicit backlog outside the first production launch of the
Admin Model Catalog. An item appearing here must not be represented as part of
the launch release until it has its own specification, tests, rollout gate, and
production evidence.

## Next operational expansion

1. Add operation-specific mapping probes for embeddings, moderation, image,
   audio/speech, OCR, and video through each production adapter. The launch
   console validates text/chat mappings; non-chat mappings remain disabled
   until their matching probe profile exists and passes.
2. Replace the launch margin-change summary with a usage-unit-weighted forecast
   covering tokens, cache classes, images, audio, characters, requests, search,
   OCR pages, and video seconds, including effective customer discounts.
3. Add a staging-to-production configuration promotion workflow with signed
   export/import bundles, revision comparison, and environment-specific
   credential binding.
4. Add automatic source-catalog diff suggestions for new, changed, deprecated,
   and removed upstream models. Every suggestion remains operator-approved.
5. Add customer-visible maintenance windows and opt-in catalog change
   notifications.

## Provider and model expansion

1. Support shared custom models that do not exist in the source catalog.
2. Add generic third-party relay adapters with explicitly allowlisted headers,
   non-bearer authentication schemes, proxy configuration, and per-provider
   URL-safety policies.
3. Add provider capacity quotas, reservations, and cost-aware global capacity
   balancing.
4. Add automated replacement suggestions based on capability, quality, cost,
   health, and observed customer behavior.

## Catalog segmentation and merchandising

1. Add organization-, project-, subscription-plan-, region-, and API-key-scoped
   catalog policies.
2. Add curated collections, tags, favorites, recommended defaults, and
   personalized ordering.
3. Add multi-currency pricing, tax presentation, negotiated provider rates, and
   provider contract-term management.

## Multi-operator governance

These controls are intentionally deferred because BetaRouter currently has one
administrator and operator:

1. Separate catalog editor, credential administrator, approver, and read-only
   operator permissions.
2. Require a second operator to approve high-impact changes.
3. Add approval queues, delegated emergency access, and periodic access review.

## Entry gate for future work

Each item needs a focused spec, migration and rollback plan where applicable,
security review, automated coverage at the highest stable seam, and a staged
feature-flag rollout. Secrets, customer request bodies, and plaintext provider
keys must never enter exports, previews, tests, audit metadata, or notifications.
