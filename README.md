# OmniRoute Model Syncer

Auto-discovers OmniRoute LLM models and populates OpenClaw/OpenCode configurations with interactive or CLI-based filtering.

## Features

- ✅ Dynamic API discovery (no hardcoding)
- ✅ Auto-detects model aliases and deduplicates
- ✅ Interactive TUI (select combos, providers, targets)
- ✅ Non-interactive CLI mode (for cron jobs, automation)
- ✅ Filter by provider, include/exclude, free-tier only
- ✅ Supports both OpenClaw and OpenCode configs
- ✅ Automatic backups before write

## Installation

```bash
cd ~/.openclaw/omniroute-plugin
npm install
```

## Setup

Requires OmniRoute API key in `~/.local/share/opencode/auth.json`:

```bash
openclaw models auth login --provider omniroute
```

## Usage

### Interactive Mode (Default)

```bash
npm run sync
```

Prompts for:
1. Config target (OpenClaw / OpenCode / Both)
2. Combo endpoints to include
3. Providers to include
4. Final confirmation

### CLI Mode (Non-Interactive)

For automation, cron jobs, scripts:

```bash
# Sync specific providers and combos to both configs
npm run sync -- --target both --include "deepseek,nvidia,cost-saver"

# Sync to OpenClaw only, exclude openrouter
npm run sync -- --target openclaw --exclude-provider openrouter

# Only Claude models, deduplicated aliases
npm run sync -- --target both --only-provider claude --deduplicate

# Free-tier OpenRouter models only
npm run sync -- --target both --include "openrouter" --free-only

# All models except openrouter, deduplicated
npm run sync -- --target both --deduplicate --exclude-provider openrouter
```

## CLI Flags

| Flag | Description | Example |
|------|-------------|---------|
| `--target` | Config target (openclaw\|opencode\|both) | `--target both` |
| `--include` | Providers/combos to sync (comma-separated) | `--include "deepseek,nvidia,cost-saver"` |
| `--exclude-provider` | Exclude specific provider | `--exclude-provider openrouter` |
| `--only-provider` | Sync only this provider | `--only-provider claude` |
| `--deduplicate` | Remove alias variants (cc→claude, etc) | `--deduplicate` |
| `--no-aliases` | Alias for --deduplicate | `--no-aliases` |
| `--free-only` | Free-tier models only (OpenRouter) | `--free-only` |
| `--help, -h` | Show help message | `--help` |

## How It Works

1. **Discovery**: Queries omniroute API at `/v1/models`
2. **Alias Detection**: Auto-detects alias pairs (same model count)
3. **Auto-Dedup**: Removes aliases if detected
4. **Filtering**: Applies CLI flags or interactive selections
5. **Backup**: Creates `.bak` copy before write
6. **Sync**: Updates `models.providers.omniroute` in config
7. **Verify**: Lists synced models with counts

## Model Categories

### Combo Endpoints
Pre-configured routing endpoints (auto/*, premium-*, owned_by: "combo"):
- auto/best-chat, auto/best-coding, auto/best-writing
- premium-rovo-all, premium-rovo-anthropic, premium-rovo-gpt, premium-rovo-gemini
- premium-antigravity-cli, premium-claude-cli, premium-github-copilot
- cost-saver, free-stack, freetheai

### Provider Models
Individual provider models (openrouter, nvidia, claude, deepseek, etc.)

### Alias Pairs
Auto-generated routing aliases:
- `cc/` → `claude/`
- `ds/` → `deepseek/`
- `gh/` → `github/`
- `kc/` → `kilocode/`
- `ollamacloud/` → `ollama-cloud/`

## Examples

**Development (all available):**
```bash
npm run sync
# Interactive: select all combos + all providers
```

**Production (curated):**
```bash
npm run sync -- --target both --include "claude,codex,deepseek,cost-saver"
```

**Cron job (free tier only):**
```bash
# In crontab
0 0 * * * cd ~/.openclaw/omniroute-plugin && npm run sync -- --target openclaw --include "openrouter" --free-only
```

**CI/CD pipeline:**
```bash
npm run sync -- --target both --deduplicate --exclude-provider openrouter
```

## Config Output

Before:
```json
{
  "models": {
    "providers": {
      "omniroute": {
        "baseUrl": "http://192.168.0.51:20128/v1",
        "apiKey": "sk-..."
      }
    }
  }
}
```

After:
```json
{
  "models": {
    "providers": {
      "omniroute": {
        "baseUrl": "http://192.168.0.51:20128/v1",
        "apiKey": "sk-...",
        "api": "openai-completions",
        "models": [
          { "id": "cost-saver", "name": "cost-saver" },
          { "id": "claude/claude-opus-4-7", "name": "claude-opus-4-7" },
          ...
        ]
      }
    }
  }
}
```

## Targets

- **OpenClaw**: `~/.openclaw/openclaw.json`
- **OpenCode**: `~/.config/opencode/opencode.json`

Both support the same omniroute provider structure.

## Verify Sync

```bash
# List synced models
openclaw models list --provider omniroute

# Or check config directly
jq '.models.providers.omniroute.models | length' ~/.openclaw/openclaw.json
```

## Troubleshooting

**API key not found**
```bash
openclaw models auth login --provider omniroute
```

**Connection error**
```bash
# Verify endpoint
curl http://192.168.0.51:20128/v1/models
```

**Permission denied**
```bash
# Check config permissions
chmod 644 ~/.openclaw/openclaw.json
```

## Environment

Override omniroute endpoint:
```bash
OMNIROUTE_URL=https://api.omniroute.ai/v1 npm run sync
```

## Files

- `sync-interactive.js` - Main sync script (interactive + CLI modes)
- `package.json` - Dependencies and scripts
- `README.md` - This file

## Requirements

- Node.js 18+
- OmniRoute API key
- Network access to omniroute endpoint
- Write access to `~/.openclaw/openclaw.json` or `~/.config/opencode/opencode.json`
