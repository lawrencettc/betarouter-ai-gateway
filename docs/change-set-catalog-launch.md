# Stage 3.5 launch change set: operation list

Date: 2026-07-27
Status: Pre-written operations — requires operator fill-in of placeholders and approval
Implements: `docs/proposal-catalog-launch-set.md` (minimum-viable credential path)
Verified against: `packages/catalog/src/contracts.ts` operation schemas and the
`/admin/catalog` routes in `apps/api/src/routes/platform-catalog.ts`

This is the paste-ready operation list for the Stage 3.5 launch curation change
set. It encodes the proposal's 12-model launch set with primary mappings only
(the minimum-viable credential path). Fallback mappings are enabled later by
the follow-on template in the last section — that is an ordinary change set,
not a new rollout stage.

## Before you paste: fill-ins

1. **`{{BASE_REVISION}}`** — current revision from `GET /admin/catalog/summary`.
   The preview and apply endpoints 409 if it is stale; re-fetch and re-preview
   after any intervening catalog action.
2. **`{{MAPPING_ID:<model>/<provider>}}`** — 12 mapping nanoids from
   `GET /admin/catalog/mappings` (filter with `providerId`, match the model).
   Every mapping operation below is keyed by this opaque id, not by
   model/provider strings.
3. **`{{OPENAI_PROVIDER_UPDATED_AT}}`** — the openai provider policy's current
   `updatedAt` from `GET /admin/catalog/providers`. This is the ONLY entity in
   this change set that already has a policy row (created for the GPT-5.5
   canary), so it needs a real timestamp; every other operation uses
   `expectedUpdatedAt: null` (no existing policy record). A mismatch rejects
   the whole batch atomically — that is the optimistic-concurrency guard
   working as intended.
4. **Credential check** — each of the 11 primary providers must have a
   validated platform credential BEFORE apply, and each of the 12 mappings a
   passing mapping test (`GET /admin/catalog/mappings/{id}/tests`), or the
   mappings will not become `available`.

The canary entities (model `gpt-5.5`, mapping `ceOirxBoDfCo74ShWIMZ`) are
deliberately NOT touched by this change set.

Note: the proposal's minimum-viable credential list said ten providers, but
the 12 primaries span **11** distinct providers — `groq` (gpt-oss-120b's
primary) was missing from that count. The list below is authoritative.

## Change-set envelope

`POST /admin/catalog/change-sets/preview` first; review blockers, fallback
loss, and margin warnings. Then `POST /admin/catalog/change-sets` with the
same body and `POST /admin/catalog/change-sets/{id}/apply`.

```json
{
	"title": "Launch curation: 12-model set, primary mappings",
	"reason": "Stage 3.5 of the enforcement rollout (docs/plan-catalog-enforcement-rollout.md). Curates the launch set from docs/proposal-catalog-launch-set.md: 12 chat models, primary mapping each, fixed pass-through pricing.",
	"baseRevision": {{BASE_REVISION}},
	"effectiveAt": null,
	"idempotencyKey": "stage-3-5-launch-set-v1",
	"operations": [ ...all operations below, in order... ]
}
```

59 operations total (23 provider + 12 model + 12 mapping + 12 price), well
under the 500-operation limit.

## Group A — provider policies (23)

Enabled (11 — the primary providers; each requires a validated credential):

```json
{ "version": 1, "type": "provider.set_policy", "providerId": "openai", "expectedUpdatedAt": "{{OPENAI_PROVIDER_UPDATED_AT}}", "patch": { "visible": true, "enabled": true, "lifecycle": "active" } },
{ "version": 1, "type": "provider.set_policy", "providerId": "groq", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": true, "lifecycle": "active" } },
{ "version": 1, "type": "provider.set_policy", "providerId": "anthropic", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": true, "lifecycle": "active" } },
{ "version": 1, "type": "provider.set_policy", "providerId": "google-ai-studio", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": true, "lifecycle": "active" } },
{ "version": 1, "type": "provider.set_policy", "providerId": "deepseek", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": true, "lifecycle": "active" } },
{ "version": 1, "type": "provider.set_policy", "providerId": "deepinfra", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": true, "lifecycle": "active" } },
{ "version": 1, "type": "provider.set_policy", "providerId": "zai", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": true, "lifecycle": "active" } },
{ "version": 1, "type": "provider.set_policy", "providerId": "moonshot", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": true, "lifecycle": "active" } },
{ "version": 1, "type": "provider.set_policy", "providerId": "minimax", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": true, "lifecycle": "active" } },
{ "version": 1, "type": "provider.set_policy", "providerId": "alibaba", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": true, "lifecycle": "active" } },
{ "version": 1, "type": "provider.set_policy", "providerId": "xai", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": true, "lifecycle": "active" } },
```

Disabled placeholders (12 — fallback providers, policies created now so the
follow-on fallback change set only flips `enabled`; they route nothing while
disabled):

```json
{ "version": 1, "type": "provider.set_policy", "providerId": "cerebras", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": false, "lifecycle": "active" } },
{ "version": 1, "type": "provider.set_policy", "providerId": "bytedance", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": false, "lifecycle": "active" } },
{ "version": 1, "type": "provider.set_policy", "providerId": "nebius", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": false, "lifecycle": "active" } },
{ "version": 1, "type": "provider.set_policy", "providerId": "together-ai", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": false, "lifecycle": "active" } },
{ "version": 1, "type": "provider.set_policy", "providerId": "azure", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": false, "lifecycle": "active" } },
{ "version": 1, "type": "provider.set_policy", "providerId": "aws-bedrock", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": false, "lifecycle": "active" } },
{ "version": 1, "type": "provider.set_policy", "providerId": "vertex-anthropic", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": false, "lifecycle": "active" } },
{ "version": 1, "type": "provider.set_policy", "providerId": "google-vertex", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": false, "lifecycle": "active" } },
{ "version": 1, "type": "provider.set_policy", "providerId": "novita", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": false, "lifecycle": "active" } },
{ "version": 1, "type": "provider.set_policy", "providerId": "embercloud", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": false, "lifecycle": "active" } },
{ "version": 1, "type": "provider.set_policy", "providerId": "granite", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": false, "lifecycle": "active" } },
{ "version": 1, "type": "provider.set_policy", "providerId": "azure-ai-foundry", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": false, "lifecycle": "active" } },
```

## Group B — model policies (12)

All visible, enabled, no direct-access exception, active lifecycle:

```json
{ "version": 1, "type": "model.set_policy", "modelId": "gpt-4o", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": true, "allowDirect": false, "lifecycle": "active" } },
{ "version": 1, "type": "model.set_policy", "modelId": "gpt-oss-120b", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": true, "allowDirect": false, "lifecycle": "active" } },
{ "version": 1, "type": "model.set_policy", "modelId": "claude-sonnet-5", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": true, "allowDirect": false, "lifecycle": "active" } },
{ "version": 1, "type": "model.set_policy", "modelId": "claude-opus-4-8", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": true, "allowDirect": false, "lifecycle": "active" } },
{ "version": 1, "type": "model.set_policy", "modelId": "gemini-3.6-flash", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": true, "allowDirect": false, "lifecycle": "active" } },
{ "version": 1, "type": "model.set_policy", "modelId": "deepseek-v4-pro", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": true, "allowDirect": false, "lifecycle": "active" } },
{ "version": 1, "type": "model.set_policy", "modelId": "deepseek-v3.2", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": true, "allowDirect": false, "lifecycle": "active" } },
{ "version": 1, "type": "model.set_policy", "modelId": "glm-5.2", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": true, "allowDirect": false, "lifecycle": "active" } },
{ "version": 1, "type": "model.set_policy", "modelId": "kimi-k3", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": true, "allowDirect": false, "lifecycle": "active" } },
{ "version": 1, "type": "model.set_policy", "modelId": "minimax-m3", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": true, "allowDirect": false, "lifecycle": "active" } },
{ "version": 1, "type": "model.set_policy", "modelId": "qwen3.7-max", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": true, "allowDirect": false, "lifecycle": "active" } },
{ "version": 1, "type": "model.set_policy", "modelId": "grok-4-3", "expectedUpdatedAt": null, "patch": { "visible": true, "enabled": true, "allowDirect": false, "lifecycle": "active" } },
```

Model IDs must match the catalog exactly — confirm against
`GET /admin/catalog/mappings` output while collecting mapping IDs.

## Group C — mapping policies (12, primary mappings)

Priority 10, weight 100, breaker participation on:

```json
{ "version": 1, "type": "mapping.set_policy", "mappingId": "{{MAPPING_ID:gpt-4o/openai}}", "expectedUpdatedAt": null, "patch": { "enabled": true, "priority": 10, "weight": 100, "breakerEnabled": true } },
{ "version": 1, "type": "mapping.set_policy", "mappingId": "{{MAPPING_ID:gpt-oss-120b/groq}}", "expectedUpdatedAt": null, "patch": { "enabled": true, "priority": 10, "weight": 100, "breakerEnabled": true } },
{ "version": 1, "type": "mapping.set_policy", "mappingId": "{{MAPPING_ID:claude-sonnet-5/anthropic}}", "expectedUpdatedAt": null, "patch": { "enabled": true, "priority": 10, "weight": 100, "breakerEnabled": true } },
{ "version": 1, "type": "mapping.set_policy", "mappingId": "{{MAPPING_ID:claude-opus-4-8/anthropic}}", "expectedUpdatedAt": null, "patch": { "enabled": true, "priority": 10, "weight": 100, "breakerEnabled": true } },
{ "version": 1, "type": "mapping.set_policy", "mappingId": "{{MAPPING_ID:gemini-3.6-flash/google-ai-studio}}", "expectedUpdatedAt": null, "patch": { "enabled": true, "priority": 10, "weight": 100, "breakerEnabled": true } },
{ "version": 1, "type": "mapping.set_policy", "mappingId": "{{MAPPING_ID:deepseek-v4-pro/deepseek}}", "expectedUpdatedAt": null, "patch": { "enabled": true, "priority": 10, "weight": 100, "breakerEnabled": true } },
{ "version": 1, "type": "mapping.set_policy", "mappingId": "{{MAPPING_ID:deepseek-v3.2/deepinfra}}", "expectedUpdatedAt": null, "patch": { "enabled": true, "priority": 10, "weight": 100, "breakerEnabled": true } },
{ "version": 1, "type": "mapping.set_policy", "mappingId": "{{MAPPING_ID:glm-5.2/zai}}", "expectedUpdatedAt": null, "patch": { "enabled": true, "priority": 10, "weight": 100, "breakerEnabled": true } },
{ "version": 1, "type": "mapping.set_policy", "mappingId": "{{MAPPING_ID:kimi-k3/moonshot}}", "expectedUpdatedAt": null, "patch": { "enabled": true, "priority": 10, "weight": 100, "breakerEnabled": true } },
{ "version": 1, "type": "mapping.set_policy", "mappingId": "{{MAPPING_ID:minimax-m3/minimax}}", "expectedUpdatedAt": null, "patch": { "enabled": true, "priority": 10, "weight": 100, "breakerEnabled": true } },
{ "version": 1, "type": "mapping.set_policy", "mappingId": "{{MAPPING_ID:qwen3.7-max/alibaba}}", "expectedUpdatedAt": null, "patch": { "enabled": true, "priority": 10, "weight": 100, "breakerEnabled": true } },
{ "version": 1, "type": "mapping.set_policy", "mappingId": "{{MAPPING_ID:grok-4-3/xai}}", "expectedUpdatedAt": null, "patch": { "enabled": true, "priority": 10, "weight": 100, "breakerEnabled": true } },
```

## Group D — price policies (12, fixed pass-through)

Fixed mode, USD, prices equal to the primary mapping's source list price
(values are USD per million tokens, as the field names state). Pass-through
means zero margin — `allowNegativeMargin` stays false everywhere:

```json
{ "version": 1, "type": "mapping.set_price_policy", "mappingId": "{{MAPPING_ID:gpt-4o/openai}}", "expectedUpdatedAt": null, "policy": { "mode": "fixed", "currency": "USD", "allowNegativeMargin": false, "fixedPrices": { "inputPerMillionTokens": "2.50", "outputPerMillionTokens": "10.00" } } },
{ "version": 1, "type": "mapping.set_price_policy", "mappingId": "{{MAPPING_ID:gpt-oss-120b/groq}}", "expectedUpdatedAt": null, "policy": { "mode": "fixed", "currency": "USD", "allowNegativeMargin": false, "fixedPrices": { "inputPerMillionTokens": "0.15", "outputPerMillionTokens": "0.75" } } },
{ "version": 1, "type": "mapping.set_price_policy", "mappingId": "{{MAPPING_ID:claude-sonnet-5/anthropic}}", "expectedUpdatedAt": null, "policy": { "mode": "fixed", "currency": "USD", "allowNegativeMargin": false, "fixedPrices": { "inputPerMillionTokens": "2.00", "outputPerMillionTokens": "10.00" } } },
{ "version": 1, "type": "mapping.set_price_policy", "mappingId": "{{MAPPING_ID:claude-opus-4-8/anthropic}}", "expectedUpdatedAt": null, "policy": { "mode": "fixed", "currency": "USD", "allowNegativeMargin": false, "fixedPrices": { "inputPerMillionTokens": "5.00", "outputPerMillionTokens": "25.00" } } },
{ "version": 1, "type": "mapping.set_price_policy", "mappingId": "{{MAPPING_ID:gemini-3.6-flash/google-ai-studio}}", "expectedUpdatedAt": null, "policy": { "mode": "fixed", "currency": "USD", "allowNegativeMargin": false, "fixedPrices": { "inputPerMillionTokens": "1.50", "outputPerMillionTokens": "7.50" } } },
{ "version": 1, "type": "mapping.set_price_policy", "mappingId": "{{MAPPING_ID:deepseek-v4-pro/deepseek}}", "expectedUpdatedAt": null, "policy": { "mode": "fixed", "currency": "USD", "allowNegativeMargin": false, "fixedPrices": { "inputPerMillionTokens": "0.435", "outputPerMillionTokens": "0.87" } } },
{ "version": 1, "type": "mapping.set_price_policy", "mappingId": "{{MAPPING_ID:deepseek-v3.2/deepinfra}}", "expectedUpdatedAt": null, "policy": { "mode": "fixed", "currency": "USD", "allowNegativeMargin": false, "fixedPrices": { "inputPerMillionTokens": "0.26", "outputPerMillionTokens": "0.38" } } },
{ "version": 1, "type": "mapping.set_price_policy", "mappingId": "{{MAPPING_ID:glm-5.2/zai}}", "expectedUpdatedAt": null, "policy": { "mode": "fixed", "currency": "USD", "allowNegativeMargin": false, "fixedPrices": { "inputPerMillionTokens": "1.40", "outputPerMillionTokens": "4.40" } } },
{ "version": 1, "type": "mapping.set_price_policy", "mappingId": "{{MAPPING_ID:kimi-k3/moonshot}}", "expectedUpdatedAt": null, "policy": { "mode": "fixed", "currency": "USD", "allowNegativeMargin": false, "fixedPrices": { "inputPerMillionTokens": "3.00", "outputPerMillionTokens": "15.00" } } },
{ "version": 1, "type": "mapping.set_price_policy", "mappingId": "{{MAPPING_ID:minimax-m3/minimax}}", "expectedUpdatedAt": null, "policy": { "mode": "fixed", "currency": "USD", "allowNegativeMargin": false, "fixedPrices": { "inputPerMillionTokens": "0.60", "outputPerMillionTokens": "2.40" } } },
{ "version": 1, "type": "mapping.set_price_policy", "mappingId": "{{MAPPING_ID:qwen3.7-max/alibaba}}", "expectedUpdatedAt": null, "policy": { "mode": "fixed", "currency": "USD", "allowNegativeMargin": false, "fixedPrices": { "inputPerMillionTokens": "2.50", "outputPerMillionTokens": "7.50" } } },
{ "version": 1, "type": "mapping.set_price_policy", "mappingId": "{{MAPPING_ID:grok-4-3/xai}}", "expectedUpdatedAt": null, "policy": { "mode": "fixed", "currency": "USD", "allowNegativeMargin": false, "fixedPrices": { "inputPerMillionTokens": "1.25", "outputPerMillionTokens": "2.50" } } },
```

Where the primary mapping publishes cached-input or request prices, add the
matching `fixedPrices` fields (`cachedInputPerMillionTokens`, `request`) from
the mapping's source data shown in Admin — omitted here because the launch
survey captured input/output list prices only. The preview's margin summary
will confirm nothing is negative.

## After preview, before apply

- Preview must show: zero blockers, zero fallback loss, zero negative margin,
  zero scheduled conflicts, zero customer impact (nothing is customer-visible
  yet — all enforcement flags are still off).
- Expected `affectedEntities`: 23 providers, 12 models, 12 mappings (+12
  price policies).
- Apply, then run the Stage 3.5 verification from
  `docs/plan-catalog-enforcement-rollout.md`: exactly one revision increment,
  fingerprint re-baseline (provider 24 rows, model 13, mapping 13, price 13 —
  the canary rows plus these operations), and every launch mapping showing
  `displayable: true, available: true, routable: true` with empty `reasons`.

## Follow-on: enabling fallback mappings (template)

Once a fallback provider's credential is validated and its mapping test
passes, enable it with an ordinary change set (fresh `baseRevision`, fresh
`idempotencyKey`, e.g. `fallback-<provider>-v1`):

```json
{ "version": 1, "type": "provider.set_policy", "providerId": "<provider>", "expectedUpdatedAt": "<current updatedAt>", "patch": { "enabled": true } },
{ "version": 1, "type": "mapping.set_policy", "mappingId": "<mapping id>", "expectedUpdatedAt": null, "patch": { "enabled": true, "priority": 20, "weight": 100, "breakerEnabled": true } },
{ "version": 1, "type": "mapping.set_price_policy", "mappingId": "<mapping id>", "expectedUpdatedAt": null, "policy": { "mode": "fixed", "currency": "USD", "allowNegativeMargin": false, "fixedPrices": { "inputPerMillionTokens": "<model launch price>", "outputPerMillionTokens": "<model launch price>" } } }
```

Fallback price policies use the MODEL's launch customer price (the Group D
value), not the fallback provider's own source price — one customer price per
model regardless of route. If a fallback's source cost exceeds the launch
price, the preview will flag negative margin: disable that fallback rather
than overriding. Priorities: second mapping 20, third 30, in the proposal
table's order.
