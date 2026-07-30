---
id: cursor
slug: cursor
title: Cursor Integration
description: Point Cursor's plan and agent modes at any of 200+ models through betarouter. One base URL override, full cost tracking — with an honest look at what still stays on Cursor's backend.
date: 2026-07-03
---

Cursor is an AI-powered code editor built on VS Code. It supports a custom OpenAI base URL, which means you can point its AI panel at betarouter and use any model from our catalog — GPT-5, Claude, Gemini, DeepSeek, or 200+ others — with every request tracked in your dashboard.

One thing up front, because most guides skip it: **the base URL override applies to Cursor's AI panel — both plan mode and agent mode.** Inline edit (Cmd/Ctrl + K) and tab autocomplete are locked to Cursor's own backend and will not route through any external endpoint. If you want every request in your workflow — including edits and completions — running through betarouter, use [Claude Code](/guides/claude-code), [Codex CLI](/guides/codex-cli), [Cline](/guides/cline), or [OpenCode](/guides/opencode) instead.

> **Using DevPass?** This integration also works with a [DevPass](https://devpass.betarouter.com) plan key. Use root model IDs without a provider prefix (`claude-sonnet-4-5`, not `anthropic/claude-sonnet-4-5`) — provider-pinned routing is not available on coding plans; the gateway picks the provider for you.

## Quick Start

### 1. Get your API key

Create an API key in your [betarouter dashboard](/dashboard) under **API Keys**.

### 2. Add the key to Cursor

Open **Cursor Settings → Models**, then add your betarouter key under **OpenAI API Key**.

![Cursor Settings](https://docs.betarouter.com/guides/cursor/settings-1.png)

### 3. Override the base URL

In the same Models settings, enable **Override OpenAI Base URL** and set it to:

```
https://api.betarouter.com/v1
```

![Cursor API Key Input](https://docs.betarouter.com/guides/cursor/settings-2.png)

### 4. Pick your models

Add any model ID from the [models catalog](https://betarouter.com/models) — for example `gpt-5`, `claude-sonnet-4-5`, or `deepseek-v3.2`.

![Cursor Model Selection](https://docs.betarouter.com/guides/cursor/model-selection.png)

Open the AI panel (Cmd/Ctrl + L) and every plan and agent request now routes through betarouter.

## What works and what doesn't

| Cursor feature                  | Routes through betarouter |
| ------------------------------- | ------------------------- |
| Chat / plan mode (Cmd/Ctrl + L) | ✅ Yes                    |
| Agent mode                      | ✅ Yes                    |
| Inline edit (Cmd/Ctrl + K)      | ❌ Cursor backend only    |
| Autocomplete / tab              | ❌ Cursor backend only    |

The remaining gaps are a Cursor limitation, not an betarouter one — external OpenAI-compatible endpoints are honored by the AI panel (plan and agent mode), while inline edit and tab completion stay on Cursor's backend.

## Model selection tips

- **Provider pinning**: prefix the model with a provider to pin it, e.g. `openai/gpt-5`
- **Discounted models**: browse the [discounted models](https://betarouter.com/models?view=grid&filters=1&discounted=true) and copy the ID
- **Free models**: browse the [free models](https://betarouter.com/models?view=grid&filters=1&free=true)
- **Reasoning models**: browse [reasoning models](https://betarouter.com/models?view=grid&filters=1&reasoning=true) for planning-heavy work

## Troubleshooting

**Authentication errors** — Verify the API key and that the base URL is exactly `https://api.betarouter.com/v1`, and check that your account has credits.

**Model not found** — Confirm the model ID exists in the [catalog](https://betarouter.com/models) and is spelled exactly as shown.

**Inline edit or autocomplete still uses Cursor's models** — Expected; see the table above.

Need help? Join our [Discord](https://betarouter.com/discord).

## Why route Cursor through betarouter

- **Any model in plan and agent mode** — OpenAI, Anthropic, Google, Meta, DeepSeek, and open-source models through one key
- **Cost tracking** — every plan and agent request appears in your [dashboard](/dashboard) with per-model cost breakdowns
- **Caching** — repeated prompts hit the cache instead of the provider
- **One bill** — no juggling separate provider accounts

[Get started for free](/signup) — no credit card required.
