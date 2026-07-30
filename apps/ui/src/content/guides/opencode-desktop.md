---
id: opencode-desktop
slug: opencode-desktop
title: OpenCode Desktop Integration
description: Connect OpenCode Desktop to 200+ models through betarouter. No config files — just open Settings, connect, and start building.
date: 2026-05-11
---

[OpenCode Desktop](https://opencode.ai/download) is the GUI desktop app version of OpenCode — an open-source AI coding agent with a full visual interface for managing providers, models, and sessions. betarouter is a built-in provider, so setup takes under a minute with no config files required.

> **Using DevPass?** This integration also works with a [DevPass](https://devpass.betarouter.com) plan key. Use root model IDs without a provider prefix (`claude-sonnet-4-5`, not `anthropic/claude-sonnet-4-5`) — provider-pinned routing is not available on coding plans; the gateway picks the provider for you.

## Prerequisites

- OpenCode Desktop installed — [download for Windows or macOS](https://opencode.ai/download)
- A betarouter API key — [sign up free](/signup) (no credit card required)

## Installation

Download OpenCode Desktop from [opencode.ai/download](https://opencode.ai/download) and install it for your platform:

- **macOS (Apple Silicon)** — `.dmg` installer
- **macOS (Intel)** — `.dmg` installer
- **Windows** — `.exe` installer

You can also install on macOS via Homebrew:

```bash
brew install --cask opencode-desktop
```

## Setup

### Step 1: Open Providers Settings

Launch OpenCode Desktop. Click the **Providers** section in the left sidebar under **Server**. You'll see the list of built-in providers:

![OpenCode Desktop Providers screen](/images/guides/opencode-desktop/0-providers.png)

### Step 2: Find betarouter

Click **Show more providers** at the bottom of the list, or click **+ Connect** on any entry to open the provider search. Type `LLM` in the search box — **betarouter** will appear under "Other":

![Searching for betarouter](/images/guides/opencode-desktop/1-search-llm.png)

Select **betarouter** from the list.

### Step 3: Enter Your API Key

OpenCode will show the **Connect betarouter** dialog. Paste your betarouter API key (starts with `beta_`) and click **Continue**:

![Connect betarouter — enter API key](/images/guides/opencode-desktop/2-connect-api-key.png)

[Sign up](/signup) or log in to your betarouter dashboard and navigate to **API Keys** to get your key.

### Step 4: Select a Model

Once connected, open the model picker from the chat input bar. Type `llm` to filter betarouter models — you'll see all available models including Claude Opus 4.7, Claude Sonnet 4.6, DeepSeek, Gemini, and more:

![betarouter model selection](/images/guides/opencode-desktop/3-model-selection.png)

### Step 5: Start Building

Select a model and start chatting. All requests route through betarouter — you'll see usage, costs, and logs in your [dashboard](/dashboard):

![OpenCode Desktop chat active with betarouter](/images/guides/opencode-desktop/4-chat-active.png)

## Why Use betarouter with OpenCode Desktop?

- **200+ models** — Claude, GPT, Gemini, Llama, DeepSeek, and more from 40+ providers
- **One API key** — Stop managing separate keys for each provider
- **Cost tracking** — See exactly what each session costs in your dashboard
- **Response caching** — Repeated requests hit cache automatically
- **Automatic fallback** — If a provider is down, requests route to an alternative
- **Volume discounts** — Check [discounted models](/models?discounted=true) for savings up to 90%

## Switching Models

You can switch models at any time from the model picker in the chat input bar. Click the current model name, type `llm` to filter to betarouter models, and select a new one. The switch takes effect immediately for the next message.

## Troubleshooting

### betarouter doesn't appear in provider list

Click **Show more providers** at the bottom of the Providers page to expand the full list, then search for "LLM".

### Authentication errors

Make sure your API key starts with `beta_` and is active. Check your [dashboard](/dashboard) to confirm the key is valid.

### Models not loading after connect

Try disconnecting and reconnecting the provider from Settings > Providers. If models still don't load, check your internet connection and verify the key is valid.
