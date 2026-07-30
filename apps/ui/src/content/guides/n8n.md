---
id: n8n
slug: n8n
title: n8n Integration
description: Power n8n AI workflows with any of 200+ models through betarouter. One OpenAI credential, every provider, full cost visibility per workflow.
date: 2026-07-03
---

n8n is a workflow automation platform with first-class AI nodes. Point its OpenAI credential at betarouter and every AI Agent, Chat Model, and LLM node in your workflows can use any model from our catalog — GPT-5, Claude, Gemini, DeepSeek, or 200+ others — with one credential and one bill.

![n8n workflow with betarouter](https://docs.betarouter.com/guides/n8n/overview.png)

> **Using DevPass?** This integration also works with a [DevPass](https://devpass.betarouter.com) plan key. Use root model IDs without a provider prefix (`claude-sonnet-4-5`, not `anthropic/claude-sonnet-4-5`) — provider-pinned routing is not available on coding plans; the gateway picks the provider for you.

## Quick Start

### 1. Add an OpenAI credential

In n8n, go to **Settings → Credentials → Add Credential → OpenAI** and set:

- **API Key**: your key from the [betarouter dashboard](/dashboard)
- **Base URL**: `https://api.betarouter.com/v1`
- **Organization ID**: leave blank

![n8n credential setup](https://docs.betarouter.com/guides/n8n/credential-3.png)

### 2. Wire up an AI Agent node

Add an **AI Agent** node to your workflow and attach a **Chat Model** using the credential you just created.

![n8n AI Agent node](https://docs.betarouter.com/guides/n8n/node-1.png)

**Important:** toggle **off** the Responses API option on the chat model node — n8n's Responses API mode is not supported; betarouter uses the standard chat completions API here.

![Responses API toggle](https://docs.betarouter.com/guides/n8n/responses-api.png)

### 3. Pick a model and run

Set the model to any [betarouter model ID](https://betarouter.com/models) (e.g. `gpt-5`) and execute the workflow with a test prompt.

![n8n test run](https://docs.betarouter.com/guides/n8n/test.png)

## Why this beats a direct provider credential

Automation workflows are exactly where gateway routing pays off:

- **Swap models without touching workflows** — change the model ID, keep the credential; or let betarouter's routing pick the best-value provider automatically
- **Per-workflow cost visibility** — every n8n execution shows up in your [dashboard](/dashboard) with token counts and cost, so you know what each automation actually costs
- **Failover for unattended runs** — scheduled workflows keep running when a provider has an outage; the gateway retries on a healthy provider
- **Caching** — workflows that re-process similar inputs hit the cache instead of paying twice
- **Free and discounted models** — batch or low-stakes steps can run on [free models](https://betarouter.com/models?view=grid&filters=1&free=true) or [discounted models](https://betarouter.com/models?view=grid&filters=1&discounted=true)

## Troubleshooting

**Credential test fails** — Verify the base URL is exactly `https://api.betarouter.com/v1` and the key is valid.

**Errors on the chat model node** — Make sure the Responses API toggle is off (see step 2).

**Model not found** — Use the exact model ID from the [models page](https://betarouter.com/models); prefix with a provider (e.g. `openai/gpt-5`) to pin routing.

Need help? Join our [Discord](https://betarouter.com/discord).

[Get started for free](/signup) — no credit card required.
