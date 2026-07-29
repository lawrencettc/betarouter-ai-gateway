---
id: litellm
slug: litellm
title: Migrate from LiteLLM
description: Switch from self-hosted LiteLLM to managed betarouter. Same API format, zero infrastructure to maintain.
date: 2026-01-20
fromProvider: LiteLLM
---

Running your own LiteLLM proxy works—until it doesn't. Scaling, monitoring, and keeping it running becomes another job. betarouter gives you the same unified API with built-in analytics, caching, and a dashboard—without the infrastructure overhead.

## Quick Migration

Both services use OpenAI-compatible endpoints, so migration is a two-line change:

```diff
- const baseURL = "http://localhost:4000/v1";  // LiteLLM proxy
+ const baseURL = "https://api.betarouter.com/v1";

- const apiKey = process.env.LITELLM_API_KEY;
+ const apiKey = process.env.BETA_GATEWAY_API_KEY;
```

## Why Teams Switch to betarouter

| What You Get             | LiteLLM (Self-Hosted) | betarouter           |
| ------------------------ | --------------------- | -------------------- |
| OpenAI-compatible API    | Yes                   | Yes                  |
| Infrastructure to manage | Yes (you run it)      | No (we run it)       |
| Managed cloud option     | No                    | Yes                  |
| Analytics dashboard      | Basic                 | Per-request detail   |
| Response caching         | Manual setup          | Built-in, automatic  |
| Cost tracking            | Via callbacks         | Native, real-time    |
| Provider key management  | Config file           | Web UI with rotation |
| Uptime & scaling         | You handle it         | 99.9% SLA (Pro/Ent)  |

Still want to self-host? betarouter is [open source under AGPLv3](/blog/how-to-self-host-llm-gateway)—same features, your infrastructure.

For a detailed breakdown, see [betarouter vs LiteLLM](/compare/litellm).

## Migration Steps

### 1. Get Your betarouter API Key

Sign up at [betarouter.com/signup](/signup) and create an API key from your dashboard.

### 2. Map Your Models

betarouter supports two model ID formats:

**Root Model IDs** (without provider prefix) - Uses smart routing to automatically select the best provider based on uptime, throughput, price, and latency:

```
gpt-5.2
claude-opus-4-5-20251101
gemini-3-flash-preview
```

**Provider-Prefixed Model IDs** - Routes to a specific provider with automatic failover if uptime drops below 90%:

```
openai/gpt-5.2
anthropic/claude-opus-4-5-20251101
google-ai-studio/gemini-3-flash-preview
```

This means many LiteLLM model names work directly with betarouter:

| LiteLLM Model                    | betarouter Model                                                  |
| -------------------------------- | ----------------------------------------------------------------- |
| gpt-5.2                          | gpt-5.2 or openai/gpt-5.2                                         |
| claude-opus-4-5-20251101         | claude-opus-4-5-20251101 or anthropic/claude-opus-4-5-20251101    |
| gemini/gemini-3-flash-preview    | gemini-3-flash-preview or google-ai-studio/gemini-3-flash-preview |
| bedrock/claude-opus-4-5-20251101 | claude-opus-4-5-20251101 or aws-bedrock/claude-opus-4-5-20251101  |

For more details on routing behavior, see the [routing documentation](https://docs.betarouter.com/features/routing).

### 3. Update Your Code

#### Python with OpenAI SDK

```python
from openai import OpenAI

# Before (LiteLLM proxy)
client = OpenAI(
    base_url="http://localhost:4000/v1",
    api_key=os.environ["LITELLM_API_KEY"]
)

response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello!"}]
)

# After (betarouter) - model name can stay the same!
client = OpenAI(
    base_url="https://api.betarouter.com/v1",
    api_key=os.environ["BETA_GATEWAY_API_KEY"]
)

response = client.chat.completions.create(
    model="gpt-4",  # or "openai/gpt-4" to target a specific provider
    messages=[{"role": "user", "content": "Hello!"}]
)
```

#### Python with LiteLLM Library

If you're using the LiteLLM library directly, you can point it to betarouter:

```python
import litellm

# Before (direct LiteLLM)
response = litellm.completion(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello!"}]
)

# After (via betarouter) - same model name works
response = litellm.completion(
    model="gpt-4",  # or "openai/gpt-4" to target a specific provider
    messages=[{"role": "user", "content": "Hello!"}],
    api_base="https://api.betarouter.com/v1",
    api_key=os.environ["BETA_GATEWAY_API_KEY"]
)
```

#### TypeScript/JavaScript

```typescript
import OpenAI from "openai";

// Before (LiteLLM proxy)
const client = new OpenAI({
  baseURL: "http://localhost:4000/v1",
  apiKey: process.env.LITELLM_API_KEY,
});

// After (betarouter) - same model name works
const client = new OpenAI({
  baseURL: "https://api.betarouter.com/v1",
  apiKey: process.env.BETA_GATEWAY_API_KEY,
});

const completion = await client.chat.completions.create({
  model: "gpt-4", // or "openai/gpt-4" to target a specific provider
  messages: [{ role: "user", content: "Hello!" }],
});
```

#### cURL

```bash
# Before (LiteLLM proxy)
curl http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer $LITELLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# After (betarouter) - same model name works
curl https://api.betarouter.com/v1/chat/completions \
  -H "Authorization: Bearer $BETA_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
# Use "openai/gpt-4" to target a specific provider
```

### 4. Migrate Configuration

#### LiteLLM Config (Before)

```yaml
# litellm_config.yaml
model_list:
  - model_name: gpt-4
    litellm_params:
      model: gpt-4
      api_key: sk-...
  - model_name: claude-3
    litellm_params:
      model: claude-3-sonnet-20240229
      api_key: sk-ant-...
```

#### betarouter (After)

With betarouter, you don't need a config file. Provider keys are managed in the web dashboard, or you can use the default betarouter keys.

If you want to use your own provider keys, configure them in the dashboard under Settings > Provider Keys.

## Streaming Support

betarouter supports streaming identically to LiteLLM:

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://api.betarouter.com/v1",
    api_key=os.environ["BETA_GATEWAY_API_KEY"]
)

stream = client.chat.completions.create(
    model="openai/gpt-4",
    messages=[{"role": "user", "content": "Write a story"}],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

## Function/Tool Calling

betarouter supports function calling:

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://api.betarouter.com/v1",
    api_key=os.environ["BETA_GATEWAY_API_KEY"]
)

tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get the weather for a location",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {"type": "string"}
            },
            "required": ["location"]
        }
    }
}]

response = client.chat.completions.create(
    model="openai/gpt-4",
    messages=[{"role": "user", "content": "What's the weather in Tokyo?"}],
    tools=tools
)
```

## Removing LiteLLM Infrastructure

After verifying betarouter works for your use case, you can decommission your LiteLLM proxy:

1. Update all clients to use betarouter endpoints
2. Monitor the betarouter dashboard for successful requests
3. Shut down your LiteLLM proxy server
4. Remove LiteLLM configuration files

## What Changes After Migration

- **No servers to babysit** — We handle scaling, uptime, and updates
- **Real-time cost visibility** — See what every request costs, broken down by model
- **Automatic caching** — Repeated requests hit cache, reducing your spend
- **Web-based management** — No more editing YAML files for config changes
- **New models immediately** — Access new releases within 48 hours, no deployment needed

## Self-Hosting betarouter

If you prefer self-hosting like LiteLLM, betarouter is available under AGPLv3:

```bash
git clone https://github.com/llmgateway/llmgateway
cd betarouter
pnpm install
pnpm setup
pnpm dev
```

This gives you the same benefits as LiteLLM's self-hosted proxy with betarouter's analytics and caching features.

## Full Comparison

Want to see a detailed breakdown of all features? Check out our [betarouter vs LiteLLM comparison page](/compare/litellm).

## Need Help?

- Browse available models at [betarouter.com/models](/models)
- Read the [API documentation](https://docs.betarouter.com)
- Contact support at contact@betarouter.com
