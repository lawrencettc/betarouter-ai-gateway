---
id: blog-claude-code-betarouter
slug: how-to-configure-claude-code-with-betarouter
date: 2025-09-08
title: How to Configure Claude Code to Use Any Model via betarouter
summary: Use GPT-5, Gemini, or any model with Claude Code. Three environment variables, zero code changes.
categories: ["Guides"]
image:
  src: "/blog/how-to-configure-claude-code-with-betarouter.png"
  alt: "Configure Claude Code with betarouter"
  width: 2282
  height: 1198
---

Claude Code works great with Claude—but what if you want to use GPT-5, Gemini, or a cheaper model for simple tasks? With betarouter, you can point Claude Code at any model in our catalog. Three environment variables. No code changes.

## Why Use betarouter with Claude Code?

- **Use any model** — GPT-5, Gemini, Llama, or 180+ others with tool calling support
- **Cut costs** — Use GPT-4o Mini for routine tasks, Claude Opus for complex reasoning
- **Track everything** — See exactly what each coding session costs in your dashboard
- **One config** — Same setup works for all models, no provider-specific changes

## Quick Setup

Set three environment variables and you're ready to go:

```bash
export ANTHROPIC_BASE_URL=https://api.betarouter.com
export ANTHROPIC_AUTH_TOKEN=llmgtwy_.... # your betarouter.com api key here
# optionally, choose your model, otherwise it will use the default Claude model via betarouter
export ANTHROPIC_MODEL=gpt-5 # choose your model on betarouter which supports tool calls

# now run claude!
claude
```

### Get Your API Key

1. [Sign up free](https://betarouter.com/signup) — no credit card required
2. Create a project and generate an API key
3. Start using it immediately (we provide model access, no provider keys needed)

### Popular Models for Claude Code

Browse [models with tool calling support](https://betarouter.com/models?filters=1&tools=true). Here are popular choices:

| Model                                | Best For                                    | Cost |
| ------------------------------------ | ------------------------------------------- | ---- |
| `openai/gpt-5`                       | Complex reasoning, flagship performance     | $$$  |
| `anthropic/claude-sonnet-4-20250514` | Balanced performance and cost               | $$   |
| `gpt-4o-mini`                        | Routine tasks, cost-conscious usage         | $    |
| `glm-4.5v`                           | Similar quality, 50-70% cheaper than Claude | $    |

## Advanced Configuration

### Model Switching

You can easily switch models by updating the environment variable:

```bash
# Switch to GPT-4o Mini for cost savings
export ANTHROPIC_MODEL=gpt-4o-mini

# Switch to Claude Sonnet for complex reasoning
export ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
```

To see the full list of models available to you, check out [models with tool calls](https://betarouter.com/models?filters=1&tools=true)

### Persistent Configuration

Add the environment variables to your shell profile (`.bashrc`, `.zshrc`, or `.profile`) for persistent configuration:

```bash
echo 'export ANTHROPIC_BASE_URL=https://api.betarouter.com' >> ~/.zshrc
echo 'export ANTHROPIC_AUTH_TOKEN=llmgtwy_your_key_here' >> ~/.zshrc
echo 'export ANTHROPIC_MODEL=openai/gpt-4o' >> ~/.zshrc
source ~/.zshrc
```

## What You Get

### Cost Visibility

Every Claude Code session is tracked in your dashboard. See exactly how many tokens you used, what it cost, and which model performed best. No more surprise bills.

### Automatic Failover

If OpenAI goes down, betarouter routes to a backup provider. Your coding session continues uninterrupted.

### One Bill for Everything

Instead of managing credits across Anthropic, OpenAI, and Google, you get one account, one dashboard, one invoice.

## Get Started

1. [Sign up free](https://betarouter.com/signup) — takes 30 seconds
2. Grab your API key from the dashboard
3. Set the three environment variables above
4. Run `claude` and start coding with any model

Questions? Check out our [documentation](https://docs.betarouter.com) or [join our Discord](https://betarouter.com/discord).
