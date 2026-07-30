---
id: github-copilot
slug: github-copilot
title: GitHub Copilot App Integration
description: Use any tool-calling model in GitHub's Copilot desktop app through betarouter. One BYOK provider, full cost tracking.
date: 2026-07-28
---

The [GitHub Copilot app](https://github.com/features/ai/github-app) is GitHub's desktop app for agent-driven development — start agent sessions from issues, pull requests, or prompts, run parallel workflows in isolated workspaces, and merge PRs without leaving the app. It supports bring your own key (BYOK), so you can run agent sessions against your own model provider.

Add betarouter as that provider and every session can use Claude, Gemini, GPT, or any model in the [catalog](https://betarouter.com/models) that supports tool calling — with full cost visibility in your dashboard.

One provider entry. No config files. Works on any Copilot plan, or with no Copilot plan at all.

> **Using DevPass?** This integration also works with a [DevPass](https://devpass.betarouter.com) plan key. Use root model IDs without a provider prefix (`claude-sonnet-4-5`, not `anthropic/claude-sonnet-4-5`) — provider-pinned routing is not available on coding plans; the gateway picks the provider for you.

## Quick Start

**1. Install the GitHub Copilot app** from [github.com/features/ai/github-app](https://github.com/features/ai/github-app) (macOS, Windows, or Linux) and sign in with your GitHub account.

**2. Get your betarouter API key** — [sign up free](https://betarouter.com/signup) and copy your key (starts with `llmgtwy_`) from the dashboard.

**3. Add betarouter as a model provider** in the app:

1. Open **Settings** → **Model Providers**
2. Select **Add provider** and choose the **OpenAI-compatible** provider type
3. Set the **Base URL** to:

```txt
https://api.betarouter.com/v1
```

4. Paste your betarouter API key and save

**4. Pick a model.** betarouter's models now appear in the model picker alongside Copilot-hosted models. Choose one when you start a session — each session can use a different model.

## Why This Works

betarouter's `/v1` endpoint is fully OpenAI-compatible. The Copilot app fetches the model list from the gateway and routes each agent session through it, and we route requests to the right provider behind the scenes. This means:

- **Use any tool-calling model** — Claude, Gemini, GPT, and the rest of the catalog in Copilot agent sessions
- **Keep your workflow** — sessions, workspaces, and PR merging work exactly the same
- **Track costs** — every request appears in your betarouter dashboard
- **Automatic caching** — repeated requests hit cache, saving money

## Choosing Models

All models available to your account show up in the app's model picker; agent sessions work with models that support tool calling and streaming. Browse the [models page](https://betarouter.com/models) to compare capabilities and pricing, or check [discounted models](/models?discounted=true) for savings up to 90%.

## Good to Know

- **Keys stay local** — the app stores your API key in the OS keychain and never reads it back into the UI.
- **Any plan works** — BYOK providers work on every Copilot plan, including Free. You don't need a paid Copilot subscription to run agent sessions through betarouter.
- **Business and Enterprise** — adding model providers is gated by the **Enable custom models** (BYOK) policy, which your admin must turn on. Accessing the Copilot app itself also requires the Copilot CLI enabled in policy settings.
- **Agent sessions only** — BYOK covers the app's model-powered agent sessions. Inline code completions in your editor still use Copilot's own service.

## GitHub Copilot in VS Code

Copilot Chat in VS Code supports custom endpoints too. Run **Chat: Manage Language Models** from the Command Palette, choose **Add Models** → **Custom Endpoint**, enter your betarouter API key, and select **Chat Completions** as the API type (betarouter is OpenAI-compatible). Then point the model `url` at `https://api.betarouter.com/v1/chat/completions` in the generated `chatLanguageModels.json`. Your gateway models then appear in the VS Code chat model picker.

## Troubleshooting

### Models don't appear in the picker

1. Verify the Base URL is exactly `https://api.betarouter.com/v1` (note the `/v1` at the end)
2. Check your API key starts with `llmgtwy_` and is active in your [dashboard](https://betarouter.com/dashboard)

### 401 Unauthorized

Your API key is invalid or was revoked. Generate a new key in the dashboard and update the provider entry in **Settings** → **Model Providers**.

### 402 or credit errors

Your betarouter organization is out of credits. Top up in the [dashboard](https://betarouter.com/dashboard) — BYOK sessions bill through betarouter, not Copilot premium requests.

### Provider option is missing

BYOK in the Copilot app shipped in June 2026 — update to the latest app version. On Business or Enterprise plans, ask your admin to enable the **Enable custom models** (BYOK) policy — and the Copilot CLI policy if you can't access the app at all.

## Get Started

1. [Sign up free](https://betarouter.com/signup) — no credit card required
2. Copy your API key from the dashboard
3. Install the [GitHub Copilot app](https://github.com/features/ai/github-app) and sign in
4. Add betarouter under **Settings** → **Model Providers** with the base URL above
5. Start an agent session with any model

Questions? Check [our docs](https://docs.betarouter.com) or [join Discord](https://betarouter.com/discord).
