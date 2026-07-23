---
id: kimi-code
slug: kimi-code
title: Kimi Code Integration
description: Use GPT-5, Claude, Gemini, or any model with Kimi Code CLI. Custom provider configuration, full cost tracking.
date: 2026-06-08
---

[Kimi Code CLI](https://github.com/MoonshotAI/kimi-code) is an open-source, AI-powered coding agent developed by Moonshot AI designed to automate software development tasks directly within your terminal. It can read and edit code, execute shell commands, search files, and autonomously manage complex coding workflows.

Kimi Code features first-class support for the **models.dev** registry, a community-maintained model catalog. This allows Kimi Code to query and configure betarouter dynamically — fetching all compatible models, capabilities (such as thinking or vision), and pricing without requiring manual TOML editing.

## Prerequisites

- A betarouter API key — [sign up free](/signup) (no credit card required)

## Setup

### Step 1: Install Kimi Code CLI

If you haven't already, install Kimi Code CLI.

- **macOS or Linux**:

  ```bash
  curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash
  ```

- **Homebrew (macOS/Linux)**:

  ```bash
  brew install kimi-code
  ```

- **Windows (PowerShell)**:
  ```powershell
  irm https://code.kimi.com/kimi-code/install.ps1 | iex
  ```

Confirm the installation:

```bash
kimi --version
```

### Step 2: Launch Kimi Code and Open the Provider Manager

Start the interactive terminal in your project directory:

```bash
kimi
```

Once loaded, type the `/provider` command and press Enter. Select **Known third-party provider** to fetch the catalog from the registry:

![Opening Provider Manager in Kimi Code](https://docs.betarouter.com/guides/kimi-code/0-add-provider.png)

### Step 3: Select betarouter

Type `llm` to filter the providers and select **betarouter** from the list:

![Selecting betarouter in Kimi Code](https://docs.betarouter.com/guides/kimi-code/1-select-provider.png)

### Step 4: Enter Your API Key

When prompted, paste your betarouter API key and press Enter. Kimi Code will save it securely to your local configuration:

![Entering betarouter API Key](https://docs.betarouter.com/guides/kimi-code/2-enter-key.png)

_Your credentials are saved locally to `~/.kimi-code/config.toml`._

### Step 5: Select a Model and Toggle Thinking

The betarouter catalog is now loaded. Use the arrow keys to browse or type to search for your desired model. Select the `betarouter` tab to view only betarouter models.

You can also toggle the **Thinking** option (On/Off) at the bottom depending on the model's capabilities:

![Browsing betarouter Models](https://docs.betarouter.com/guides/kimi-code/3-select-model.png)

For example, type `gpt-5.5` to find the latest reasoning model, select it, and press Enter:

![Selecting GPT-5.5 Model](https://docs.betarouter.com/guides/kimi-code/4-select-gpt-model.png)

### Step 6: Start Coding

All set! Kimi Code is now configured. Your requests will be securely routed through betarouter, allowing you to use advanced models for local autonomous coding while showing real-time usage and cost statistics on your betarouter dashboard.

![Running Kimi Code CLI session](https://docs.betarouter.com/guides/kimi-code/5-chat.png)

Use `/model` in the terminal session at any time to switch models.

## Manual Configuration (Advanced)

If you prefer to configure your environment manually without using the interactive provider manager, you can write settings directly to your configuration file at `~/.kimi-code/config.toml` (or `C:\Users\<YourUsername>\.kimi-code\config.toml` on Windows).

Here is an example TOML configuration that registers **GPT-5.5**, **Claude 3.7 Sonnet**, **DeepSeek R1**, and **Qwen3.7 Max** manually:

```toml
default_model = "betarouter/gpt-5.5"

[providers.betarouter]
type = "openai"
api_key = "llmgtwy_your_api_key_here"
base_url = "https://api.betarouter.com/v1"

[models."betarouter/gpt-5.5"]
provider = "betarouter"
model = "gpt-5.5"
max_context_size = 1050000
max_output_size = 128000
capabilities = [ "thinking", "tool_use" ]
display_name = "GPT-5.5"

[models."betarouter/claude-3.7-sonnet"]
provider = "betarouter"
model = "claude-3.7-sonnet"
max_context_size = 200000
max_output_size = 8192
capabilities = [ "image_in", "thinking", "tool_use" ]
display_name = "Claude 3.7 Sonnet"

[models."betarouter/deepseek-r1"]
provider = "betarouter"
model = "deepseek-r1"
max_context_size = 131072
max_output_size = 8192
capabilities = [ "thinking", "tool_use" ]
display_name = "DeepSeek R1"

[models."betarouter/qwen3.7-max"]
provider = "betarouter"
model = "qwen3.7-max"
max_context_size = 1000000
max_output_size = 65536
capabilities = [ "thinking", "tool_use" ]
display_name = "Qwen3.7 Max"
```

## Why Use betarouter with Kimi Code CLI?

- **200+ models** — Access GPT-5.5, Gemini, Llama, DeepSeek, and more in a single CLI configuration.
- **Unified cost tracking** — Get a detailed breakdown of costs per prompt and session in your dashboard.
- **Response caching** — Automatically cache repeated requests (such as parsing or building commands) to save API costs.
- **Automatic fallback** — Keep coding even if a provider encounters temporary downtime.
- **Volume discounts** — Access selected models with up to 90% savings compared to standard pricing.
