---
name: e2e-testing
description: E2E test env-var options (TEST_MODELS, FULL_MODE, LOG_MODE) and the parallel/split file structure of the gateway e2e suite. Use when running or debugging `pnpm test:e2e`, scoping a run to specific provider/model mappings, or deciding which e2e file a new test belongs in.
---

# E2E test options and structure

Reminder (also in the root `AGENTS.md`, which `CLAUDE.md` symlinks to): NEVER run the full E2E suite across all models. Scope `pnpm test:e2e` to the model(s) you changed with `TEST_MODELS`, and let it filter the whole suite in a single run rather than invoking individual `*.e2e.ts` files.

## E2E Test Options

- `TEST_MODELS` - Run tests only for specific models (comma-separated list of `provider/model-id` pairs)
  Example: `TEST_MODELS="openai/gpt-4o-mini,anthropic/claude-3-5-sonnet-20241022" pnpm test:e2e`
  This is useful for quick testing as the full e2e suite can take too long with all models.
  `TEST_MODELS` always overrides provider mappings marked with `test: "skip"`. For example, `TEST_MODELS="anthropic/claude-opus-4-6"` will include that Anthropic mapping even if it is skipped by default, so metadata-driven e2e assertions such as `reasoningOutput` still apply.
- `FULL_MODE` - Include free models in tests (default: only paid models)
- `LOG_MODE` - Enable detailed logging of responses

## E2E Test Structure

E2E tests are organized for optimal performance:

- **Parallel execution**: Tests run up to 16 in parallel using Vitest's thread pool (minimum 8 threads)
- **Split structure**:
  - `apps/gateway/src/api.e2e.ts` - Contains all `.each()` tests that benefit from parallelization
  - `apps/gateway/src/api-individual.e2e.ts` - Contains individual test cases that need isolation
- **Concurrent mode**: The main test suite uses `{ concurrent: true }` to enable parallel execution of `.each()` tests
