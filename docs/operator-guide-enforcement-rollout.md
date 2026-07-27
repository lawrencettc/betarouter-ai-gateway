# Operator guide: catalog enforcement rollout

Date: 2026-07-27
Audience: the production operator executing the rollout on the Droplet
Starting state: revision 40, all catalog flags at safe defaults, image
`betarouter-ai-gateway-unified:845ab33-local`

This is the ordered walkthrough. Each step references the document that holds
the full detail:

- **Plan** (when/how): `docs/plan-catalog-enforcement-rollout.md`
- **Proposal** (what): `docs/proposal-catalog-launch-set.md`
- **Operations** (exact API calls): `docs/change-set-catalog-launch.md`
- **Audit** (what to record): `docs/audit-catalog-enforcement-closure.md`

Standing rules for the whole rollout: one stage per session with separate
approval each; every flip is an `.env.production` edit plus redeploy of the
SAME image, never a new build; take a backup at every stage entry; the
rollback ladder is always breaker off → routing off → discovery off → Admin
inverse revision → previous image.

## Phase 0: one-time prep (before touching the catalog)

1. **Freeze the deploy pipeline.** When the GitHub Actions quota resets,
   queued builds will auto-deploy a new image via the `deploy-production`
   workflow. The rollout requires advancing stages on the same image, so
   disable `deploy-production` in the Actions UI (or pause the self-hosted
   runner) first. Re-enable only between stages or after closure.
2. **Confirm the baseline.** Revision 40, checksum
   `sha256:v2:772202412b45d5d416b1af6b49ae1aa62bf09b2d5318f5dd5d040fb7cb1086e7`,
   all four flags at safe defaults in `/opt/betarouter-ai-gateway/.env.production`,
   fresh gzip-verified backup under `/opt/betarouter-backups`. Commands: plan,
   Stage 4 entry gate.
3. **Start the audit as you go.** Fill the audit template's §9 timeline and
   §12 backup tables from day one; reconstruction later is error-prone.

## Phase 1 — Stage 3.5: curate the launch set (Admin only, no flags)

4. **Credential inventory.** In Admin, check the 11 primary providers:
   `openai` (already proven), `groq`, `anthropic`, `google-ai-studio`,
   `deepseek`, `deepinfra`, `zai`, `moonshot`, `minimax`, `alibaba`, `xai`.
   Create and validate the missing ones. If a credential cannot be obtained,
   drop that model from the launch set — never curate a mapping whose
   credential is missing; it silently loses `available` and surfaces as a
   Stage 5 404.
5. **Mapping tests.** Run the Admin mapping test for each of the 12 primary
   mappings; each must pass through the production adapter path. A failing
   test is a real integration problem — fix before proceeding.
6. **Fill the operation placeholders** in the operations doc: `baseRevision`
   from `GET /admin/catalog/summary`, the 12 mapping nanoids from
   `GET /admin/catalog/mappings`, and the openai provider policy's current
   `updatedAt`.
7. **Preview → create → apply.** Preview must show zero blockers, zero
   negative margin, zero customer impact. Apply, then verify: exactly one
   revision increment (record as revision 41 in the audit ledger),
   fingerprint row counts 24/13/13/13, and every launch mapping
   `displayable/available/routable: true` with empty reasons.
8. **Fresh backup.** This is the new baseline.

## Phase 2 — Stage 4: discovery (first flag flip)

9. Run the Stage 4 entry gate (running-container flag audit, backup check,
   save the pre-flip model list with the `curl | jq | sort` command).
10. Set `PLATFORM_CATALOG_DISCOVERY_ENABLED=true` in `.env.production`,
    redeploy the same image (exact compose command in the plan).
11. Verify: identical ETags on both discovery surfaces, model-list diff shows
    only intentional removals, prices/lifecycle metadata correct, UI and
    playground selectors populate — and restart the container once to
    confirm `/v1/models` returns 200 afterwards (discovery fails closed on
    snapshot unavailability; this is the check for it).
12. Soak ≥2 h covering ≥2 worker syncs, ≥1 cache refresh, ≥1 restart. Any
    abort-list hit: flip the flag back, investigate.

## Phase 3 — Stage 5: routing and billing (the consequential flip)

13. **Prep change sets** (each audited, each a ledger row): re-publish the
    GPT-5.5 canary as enabled + `allowDirect`, still hidden (revision 42);
    enable the `deepseek-v4-pro/deepinfra` sibling mapping (revision 43) —
    without a sibling, every launch model has one routable mapping and the
    pinned-503/fallback tests are impossible.
14. **Shadow sweep before the flip:** one chat request per curated model,
    then check shadow decision logs for any `allowed:false`. Each one is a
    request that will start failing under enforcement — resolve all of them.
15. Set `PLATFORM_CATALOG_ROUTING_ENABLED=true`, redeploy same image.
16. **Run the verification matrix** (commands in the plan; vary the prompt
    every time — the gateway caches errors by request body): canary billing
    request with the SQL assertion that billed `cost` equals
    `input×5e-6 + output×30e-6` exactly; one success per curated model;
    hidden-404 (`mistral-large-latest`); retired-410 (`gemini-3-pro-preview`,
    after a small lifecycle-retired change set); pinned-503 with
    `retry-after: 60`; fallback-200 on deepseek-v4-pro; one embeddings and
    one moderation request proving non-chat is untouched.
17. Soak ≥4 h; re-run the negative matrix once after a restart. **Any billing
    disagreement, by any amount, is an immediate abort.**

## Phase 4 — Stage 6: breaker (observe, then enforce)

18. Set `PLATFORM_CATALOG_BREAKER_MODE=observe`. Verify routing behaviour is
    byte-identical to Stage 5. Curate a **throwaway mapping** (never a launch
    mapping) and run the would-open drill: break its credential, five
    consecutive failures open the circuit, audit rows and Admin health
    summaries appear, routing is unchanged. Soak ≥24 h.
19. **Before enforce — the hard gate:** every breaker key at the current
    revision must be `closed`. Reset any non-closed circuit via the audited
    reset endpoint (`POST /admin/catalog/mappings/{id}/breaker/reset`,
    requires a passing mapping test) — never `redis-cli DEL`. Every
    `circuit_open` from the observe window must have an explanation; no
    "unknown"s.
20. Set `PLATFORM_CATALOG_BREAKER_MODE=enforce`. **Immediately** send one
    request per curated model — all must be 200; any 503 means stale breaker
    state was applied → roll back to `off` and investigate. Then run the full
    cycle drill on the throwaway mapping (open → removed → fallback →
    half-open probe → two-probe close → audited manual reset → 409 reset
    guard). Soak 24 h.

## Phase 5 — closure

21. Fill the remaining blanks in the audit template, sign the residual-risk
    statement (including defining the first-organic-traffic review trigger),
    update the acceptance-criteria matrix in
    `docs/verification-admin-model-catalog-launch.md`, and un-freeze the
    deploy pipeline from step 1.
22. Optional immediate follow-ups: the gpt-5.5 visible-set change set, and
    fallback enablement as further credentials are validated (template in the
    operations doc).

## The failure mode to watch for

Something in the availability chain silently missing — an expired credential,
a stale mapping test. It does not error loudly; it just clears `available`,
and it surfaces at Stage 5 as a 404 on a model Stage 4 was happily listing.
That is why the plan re-verifies `available: true` for every curated mapping
immediately before the routing flip. When in doubt, re-check availability,
not just visibility.
