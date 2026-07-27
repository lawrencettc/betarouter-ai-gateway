# Stage 3.5 launch-set curation proposal

Date: 2026-07-27
Status: Proposal — requires operator review and approval before any Admin change set is published
Prerequisite for: `docs/plan-catalog-enforcement-rollout.md` Stage 3.5

This proposes the initial curated catalog for the enforcement rollout: which
chat models become visible and routable when discovery (Stage 4) and routing
(Stage 5) are enabled. Source data is the catalog source (`packages/models`)
as of `main` at the time of writing; production revision-40 counts (41
providers / 312 models / 664 mappings) derive from the same source.

Scope constraints inherited from the rollout plan:

- Chat models only. Non-chat modalities stay on legacy routing regardless of
  flags (`isCatalogOperationEnabled`).
- A mapping is launch-eligible only if it can satisfy the full availability
  chain: enabled+visible provider policy, enabled+visible model policy,
  enabled mapping policy, a **validated platform credential**, complete
  customer prices, and a **currently passing mapping test**.
- GPT-5.5 is reserved as the Stage 5 billing canary (hidden, `allowDirect`).
  It must NOT be part of the launch-visible set; it joins the visible catalog
  via a separate change set after Stage 5 closes.

## Selection criteria

1. **Fallback first.** Prefer models with ≥2 active provider mappings so a
   single provider outage cannot 503 the model (the plan's single-mapping
   risk). Single-mapping models are deferred to fast-follow.
2. **No skip-flagged primaries.** Mappings marked `test: "skip"` in the
   source cannot be e2e-validated; a launch mapping must be able to pass its
   Admin mapping test. Models whose every mapping is skip-flagged are
   excluded.
3. **Stable lifecycle.** No preview-suffixed, deprecated, or deactivated
   models in the launch set.
4. **Vendor and price spread.** Cover the major model families a gateway
   customer expects (OpenAI, Anthropic, Google, DeepSeek, open-weight) across
   frontier and value price tiers.

## Recommended launch set (12 models)

Prices are source list prices, USD per million tokens (input/output).
"Curate mappings" lists only mappings that are active and not skip-flagged;
enable each only if its provider credential is validated (see §Credentials).

|   # | Model            | Vendor               | Curate mappings (primary first)                       | $/M in/out          | Capabilities                   | Fallback                         |
| --: | ---------------- | -------------------- | ----------------------------------------------------- | ------------------- | ------------------------------ | -------------------------------- |
|   1 | gpt-4o           | OpenAI               | openai                                                | 2.50/10.00          | tools, vision                  | 1 active (azure is skip-flagged) |
|   2 | gpt-oss-120b     | OpenAI (open-weight) | groq, cerebras, bytedance, nebius, together-ai, azure | 0.05–0.35/0.25–0.75 | tools, reasoning               | up to 6                          |
|   3 | claude-sonnet-5  | Anthropic            | anthropic, aws-bedrock, vertex-anthropic              | 2.00/10.00          | tools, vision, reasoning       | 3                                |
|   4 | claude-opus-4-8  | Anthropic            | anthropic, aws-bedrock                                | 5.00/25.00          | tools, vision, reasoning       | 2                                |
|   5 | gemini-3.6-flash | Google               | google-ai-studio, google-vertex                       | 1.50/7.50           | tools, vision, reasoning, json | 2                                |
|   6 | deepseek-v4-pro  | DeepSeek             | deepseek, deepinfra, together-ai, bytedance, alibaba  | 0.44–2.40/0.87–4.80 | tools, reasoning, json         | 5                                |
|   7 | deepseek-v3.2    | DeepSeek             | deepinfra, novita, bytedance                          | 0.26–0.28/0.38–0.42 | tools                          | 3                                |
|   8 | glm-5.2          | Z.ai                 | zai, embercloud, granite, bytedance, alibaba          | 1.26–1.40/3.96–4.40 | tools, reasoning, json         | 5                                |
|   9 | kimi-k3          | Moonshot             | moonshot, novita                                      | 3.00/15.00          | tools, vision, reasoning, json | 2                                |
|  10 | minimax-m3       | MiniMax              | minimax, together-ai                                  | 0.30–0.60/1.20–2.40 | reasoning, json                | 2                                |
|  11 | qwen3.7-max      | Alibaba              | alibaba, novita, granite                              | 1.25–2.50/3.75–7.50 | tools, reasoning, json         | 3                                |
|  12 | grok-4-3         | xAI                  | xai, aws-bedrock, azure-ai-foundry                    | 1.25/2.50           | tools, reasoning               | 3                                |

Post-Stage-5 addition: **gpt-5.5** (openai mapping) moves from hidden canary
to visible, in its own change set, once the billing proof is closed.

## Explicitly excluded (and why)

| Model                                                | Reason                                                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| claude-fable-5                                       | Both mappings skip-flagged — no mapping test can pass                                                                                 |
| claude-sonnet-4-5                                    | All three mappings skip-flagged                                                                                                       |
| gemini-3.1-pro-preview                               | All mappings skip-flagged; preview lifecycle                                                                                          |
| gemini-3-pro-preview                                 | Deprecated 2026-02-27, deactivated 2026-03-26 — already retired. **Use as the Stage 5 retired-410 negative-test target**              |
| mistral-large-latest                                 | Single mapping; weakest capability flags; source prices use non-standard notation (see §Follow-ups)                                   |
| grok-4-5                                             | Single mapping (xai only) — no fallback                                                                                               |
| kimi-k2.5, glm-4.7, minimax-m2.5, qwen3-max, llama-* | Deferred to fast-follow: superseded by a sibling in the set, heavy skip-flagging, or messy lifecycle (partially deactivated mappings) |

Exclusion here means "not in the launch change set" — these models remain in
the source catalog and can be added later by ordinary Admin change sets.

## Credentials: the gating unknown

Only the **openai** platform credential is production-proven (validated for
the GPT-5.5 canary in the launch dossier). Every other provider's credential
state is unknown to this proposal and must be inventoried by the operator in
Admin before the change set is drafted.

Distinct providers needed for the full 12-model set (17):
`openai, groq, cerebras, bytedance, nebius, together-ai, azure, anthropic,
aws-bedrock, vertex-anthropic, google-ai-studio, google-vertex, deepseek,
deepinfra, novita, zai, embercloud, granite, alibaba, moonshot, minimax, xai,
azure-ai-foundry`.

That list is long. Two ways to cut it, in preference order:

1. **Minimum viable credential set (recommended):** validate one credential
   per model — `openai, anthropic, google-ai-studio, deepseek, deepinfra,
zai, moonshot, minimax, alibaba, xai` (10). Every model launches with its
   primary mapping; fallback mappings whose credentials are missing stay
   disabled and can be enabled later without a new rollout stage. Accepts
   temporary single-routable-mapping exposure for models 1, 9, 10, 12 —
   record this in the Stage 6b single-mapping inventory.
2. **Full fallback set:** validate all 17+ before launch. Maximum resilience,
   slowest path.

Do not curate a mapping whose credential is unvalidated: `available` clears
silently and Stage 5 will 404 a model Stage 4 listed (the plan's Stage 3.5
risk note).

## Pricing recommendation

Fixed customer prices equal to the source list prices in the table
(pass-through, zero margin), expressed in the catalog's per-token form.
Rationale:

- Deterministic Stage 5 billing verification: expected cost is hand-computable
  from the table, same as the canary methodology.
- No negative-margin overrides needed anywhere.
- Margin/markup strategy is a business decision that deserves its own change
  set after enforcement is proven; the catalog supports repricing without
  redeploys.

Where mappings for one model have different source prices (e.g.
deepseek-v4-pro), set the customer price from the **primary** mapping and
verify the preview shows no negative margin on any enabled fallback; disable
any fallback that would be margin-negative rather than overriding.

## Priority and weight

- Primary mapping: priority 10. First-party provider (the vendor's own API)
  unless the survey shows a materially cheaper equal-capability mapping.
- Fallbacks: priority 20, 30, … in list order from the table.
- Weights equal (100) within a priority tier; weighted load-balancing is a
  post-launch optimization.

## Operator checklist (per model, before the change set)

1. Credential for each curated mapping validated in Admin (§Credentials).
2. Mapping test passing for each curated mapping — run through the production
   adapter path, exactly as the canary was.
3. Customer prices entered (fixed, pass-through) and preview shows no
   negative margin, no fallback loss, no scheduled conflict.
4. Capability flags in the preview match the table (tools/vision/reasoning);
   discrepancies are catalogue bugs to fix in `packages/models` first, per
   the repo's capability-flag policy.
5. Lifecycle clean: no `deprecatedAt`/`deactivatedAt` surprises on curated
   mappings.

Then publish as **one atomic change set** (well under the 500-operation
bulk limit; ~12 model policies + ~17–40 provider/mapping/price policies),
confirm exactly one revision increment, and run the Stage 3.5 verification
from the rollout plan (fingerprint re-baseline, `displayable`/`available`/
`routable` all true with empty reasons per launch mapping).

## Follow-ups surfaced by the survey (not blocking Stage 3.5)

1. **`mistral-large-latest` price notation** in `packages/models` uses
   `"0.000004"`/`"0.000012"` instead of the repo-mandated `e-6` notation
   (`"4.0e-6"`/`"12.0e-6"`). Values are numerically correct; notation should
   be fixed for consistency.
2. **Fast-follow candidates** once launch is stable: kimi-k2.5 (5 active
   mappings), minimax-m2.5 (3), glm-4.7 (3 non-skip), grok-4-5 (when a second
   provider appears), llama-4-maverick-17b-instruct.
3. **Skip-flag review**: claude-fable-5 and claude-sonnet-4-5 are fully
   skip-flagged; if these are launch-desirable, the skip reasons need
   resolving in `packages/models` first.
