---
id: continue
slug: continue
title: Continue CLI Integration
description: Use any model with Continue CLI through betarouter. One config file, 200+ models, full cost tracking.
date: 2026-05-11
---

[Continue](https://docs.continue.dev) is an open-source AI code assistant available as a CLI tool. By configuring it to use betarouter, you get access to 200+ models from 40+ providers with unified cost tracking.

One config file. Any model. Full cost visibility.

> **Using DevPass?** This integration also works with a [DevPass](https://devpass.betarouter.com) plan key. Use root model IDs without a provider prefix (`claude-sonnet-4-5`, not `anthropic/claude-sonnet-4-5`) — provider-pinned routing is not available on coding plans; the gateway picks the provider for you.

## Prerequisites

- A betarouter API key — [sign up free](https://betarouter.com/signup) (no credit card required)

## Setup

### Step 1: Install Continue CLI

Install Continue CLI globally:

```bash
npm install -g @continuedev/cli
```

![Installing Continue CLI](/images/guides/continue/0-install.png)

### Step 2: Get Your API Key

[Sign up](https://betarouter.com/signup) or log in to your betarouter dashboard. Navigate to **API Keys** and create a new key. Copy it — it starts with `beta_`.

### Step 3: Create a Config File

Create the Continue config directory and config file:

```bash
mkdir -p ~/.continue
```

Then create `~/.continue/config.yaml` with your betarouter configuration:

```yaml
name: betarouter
version: 0.0.1
models:
  - name: claude-sonnet-4-6
    provider: openai
    model: claude-sonnet-4-6
    apiBase: https://api.betarouter.com/v1
    apiKey: beta_your-api-key-here
```

![Editing config.yaml](/images/guides/continue/1-config.png)

> Replace `beta_your-api-key-here` with your actual API key from the dashboard.

### Step 4: Add More Models (Optional)

Add as many models as you want from the [models page](https://betarouter.com/models):

```yaml
name: betarouter
version: 0.0.1
models:
  - name: claude-sonnet-4-6
    provider: openai
    model: claude-sonnet-4-6
    apiBase: https://api.betarouter.com/v1
    apiKey: beta_your-api-key-here
  - name: gpt-5.5
    provider: openai
    model: gpt-5.5
    apiBase: https://api.betarouter.com/v1
    apiKey: beta_your-api-key-here
  - name: gemini-3.1-pro
    provider: openai
    model: gemini-3.1-pro
    apiBase: https://api.betarouter.com/v1
    apiKey: beta_your-api-key-here
```

All models use `provider: openai` since betarouter exposes an OpenAI-compatible API.

### Step 5: Start Using Continue

Launch Continue CLI with the `--config` flag pointing to your config file:

```bash
cn --config ~/.continue/config.yaml
```

![Continue CLI running with betarouter](/images/guides/continue/2-running.png)

All requests now route through betarouter. You'll see usage, costs, and logs in your dashboard.

## Why Use betarouter with Continue

- **200+ models** — Claude, GPT, Gemini, Llama, DeepSeek, and more
- **One API key** — Stop managing separate keys for each provider
- **Cost tracking** — See exactly what each session costs in your dashboard
- **Response caching** — Repeated requests hit cache automatically
- **Automatic fallback** — If a provider is down, requests route to an alternative
- **Volume discounts** — Check [discounted models](https://betarouter.com/models?discounted=true) for savings up to 90%

## Configuration Details

### Provider Setting

Always use `provider: openai` in your Continue config. betarouter exposes an OpenAI-compatible API, so Continue's OpenAI provider handles all models correctly — including Claude, Gemini, and others.

### Project-Specific Config

Place a `.continue/config.yaml` in your project root to override the global config for that project:

```yaml
name: project-config
version: 0.0.1
models:
  - name: gpt-5.5
    provider: openai
    model: gpt-5.5
    apiBase: https://api.betarouter.com/v1
    apiKey: beta_your-api-key-here
```

### Using with the --config Flag

Point to any config file:

```bash
cn --config path/to/config.yaml
```

## Switching Models

Add multiple models to your config and switch between them in the Continue interface. In the CLI, you can specify a model with the `--model` flag if supported, or update your config file.

## Locking to a Specific Provider

By default, betarouter automatically fails over to alternative providers if your chosen provider is experiencing downtime. To disable fallback, add a custom header:

```yaml
models:
  - name: claude-sonnet-4-6
    provider: openai
    model: claude-sonnet-4-6
    apiBase: https://api.betarouter.com/v1
    apiKey: beta_your-api-key-here
    requestOptions:
      headers:
        X-No-Fallback: "true"
```

> Disabling fallback means requests will fail if the chosen provider is down. See the [routing docs](https://docs.betarouter.com/features/routing) for details.

## Troubleshooting

### "Failed to parse config" error

Make sure your config file includes `name` and `version` fields at the top level:

```yaml
name: betarouter
version: 0.0.1
models:
  - ...
```

### Onboarding wizard still appears

If running `cn` without `--config` shows an onboarding prompt, create the sentinel file to skip it:

```bash
touch ~/.continue/.onboarding_complete
```

Or always launch with the `--config` flag to bypass onboarding entirely.

### Model not found

Verify the model ID matches exactly what's listed on the [models page](https://betarouter.com/models). Model IDs are case-sensitive.

### Connection timeout

Check that `apiBase` is set to `https://api.betarouter.com/v1` (note the `/v1` at the end).

### Authentication errors

Make sure your `apiKey` starts with `beta_` and is valid. Check your [dashboard](/dashboard) to confirm the key is active.

### Provider must be "openai"

betarouter uses an OpenAI-compatible API. Even when using Claude or Gemini models, set `provider: openai` in your Continue config. The gateway handles routing to the correct upstream provider.

## Get Started

Ready to use Continue CLI with any model? [Sign up for betarouter](https://betarouter.com/signup) and grab your API key.

Questions? Check [our docs](https://docs.betarouter.com) or [join Discord](https://betarouter.com/discord).
