---
id: "33"
slug: "cerebras-models-support"
date: "2025-12-14"
title: "Cerebras: Ultra-Fast Inference with 6 New Models"
summary: "New Cerebras provider with six high-performance models, including GPT-OSS 120B and Qwen 3, now available through betarouter."
image:
  src: "/changelog/cerebras-models-support.png"
  alt: "Cerebras: Ultra-Fast Inference with 6 New Models"
  width: 1768
  height: 677
---

We're excited to announce support for **Cerebras** as a new provider in betarouter, offering **ultra-fast, high-throughput inference** with six powerful models.

Cerebras is available via the betarouter with the provider ID `cerebras`. Learn more about the Cerebras inference platform at [cerebras.ai](https://cerebras.ai?utm_source=betarouter.com).

## 🎯 New Cerebras Models

[Cerebras models](/providers/cerebras)

## 🚀 Getting Started with Cerebras

All Cerebras models are available via the OpenAI-compatible chat completions API:

```bash
curl -X POST https://api.betarouter.com/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "cerebras/gpt-oss-120b",
    "messages": [{"role": "user", "content": "Explain how Cerebras inference works"}]
  }'
```

---

**[Try Cerebras models in the Playground](https://chat.betarouter.com/?model=cerebras/gpt-oss-120b)** 🚀

**[Get started now](/signup)** 🚀
