#!/usr/bin/env node
/**
 * OmniRoute Interactive Model Sync
 * Discover models and interactively select targets and configurations
 * Supports both interactive (no args) and non-interactive (CLI flags) modes
 */

import { readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import inquirer from "inquirer";

const OMNIROUTE_API =
  process.env.OMNIROUTE_URL || "http://192.168.0.51:20128/v1";

// CLI flag parsing
function getArgValue(argName) {
  const index = process.argv.indexOf(argName);
  return index > -1 && index + 1 < process.argv.length
    ? process.argv[index + 1]
    : null;
}

const CLI_MODE = process.argv.some(
  (arg) =>
    arg.startsWith("--target") ||
    arg.startsWith("--include") ||
    arg.startsWith("--exclude") ||
    arg.startsWith("--only") ||
    arg.startsWith("--deduplicate") ||
    arg.startsWith("--free-only") ||
    arg.startsWith("--no-aliases") ||
    arg === "--help" ||
    arg === "-h"
);

if (CLI_MODE && (process.argv.includes("--help") || process.argv.includes("-h"))) {
  console.log(`
OmniRoute Sync - Interactive & Non-Interactive Modes

INTERACTIVE (default):
  npm run sync
  Prompts for: target, combo endpoints, providers

NON-INTERACTIVE (flags):
  npm run sync -- --target openclaw --include "deepseek,nvidia"
  npm run sync -- --target both --exclude-provider openrouter
  npm run sync -- --only-provider claude --deduplicate

FLAGS:
  --target <openclaw|opencode|both>  Config target (default: both)
  --include <list>                   Providers/combos (comma-separated)
  --exclude-provider <name>          Exclude provider
  --only-provider <name>             Only this provider
  --deduplicate                      Remove aliases (cc→claude, etc)
  --free-only                        Free tier models only (OpenRouter)
  --no-aliases                       Alias for --deduplicate
  --help, -h                         Show this message

EXAMPLES:
  npm run sync -- --target openclaw --include "deepseek,nvidia,cost-saver"
  npm run sync -- --target both --free-only
  npm run sync -- --only-provider openrouter --deduplicate
  `);
  process.exit(0);
}

const ALIAS_PAIRS = {
  "cc/": "claude/",
  "ds/": "deepseek/",
  "gh/": "github/",
  "kc/": "kilocode/",
  "ollamacloud/": "ollama-cloud/",
};

function isAlias(modelId) {
  return Object.keys(ALIAS_PAIRS).some((alias) => modelId.startsWith(alias));
}

function renameModelId(id, isCombo) {
  if (isCombo) {
    return `or-combo-${id}`;
  }
  const provider = id.includes("/") ? id.split("/")[0] : "misc";
  const modelName = id.includes("/") ? id.substring(id.indexOf("/") + 1) : id;
  return `or-${provider}-${modelName}`;
}

function isFreeTierModel(modelId) {
  if (!modelId.startsWith("openrouter/")) {
    return true;
  }
  const FREE_MODELS_PATTERNS = [
    "openrouter/arcee-ai/trinity-large-thinking:free",
    "openrouter/baidu/cobuddy:free",
    "openrouter/cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
    "openrouter/deepseek/deepseek-v4-flash:free",
    "openrouter/google/gemma-4-26b-a4b-it:free",
    "openrouter/google/gemma-4-31b-it:free",
    "openrouter/google/lyria-3-clip-preview",
    "openrouter/google/lyria-3-pro-preview",
    "openrouter/liquid/lfm-2.5-1.2b-instruct:free",
    "openrouter/liquid/lfm-2.5-1.2b-thinking:free",
    "openrouter/meta-llama/llama-3.2-3b-instruct:free",
    "openrouter/meta-llama/llama-3.3-70b-instruct:free",
    "openrouter/minimax/minimax-m2.5:free",
    "openrouter/nousresearch/hermes-3-llama-3.1-405b:free",
    "openrouter/nvidia/nemotron-3-nano-30b-a3b:free",
    "openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
    "openrouter/nvidia/nemotron-nano-12b-v2-vl:free",
    "openrouter/nvidia/nemotron-nano-9b-v2:free",
    "openrouter/openai/gpt-oss-120b:free",
    "openrouter/openai/gpt-oss-20b:free",
    "openrouter/free",
    "openrouter/owl-alpha",
    "openrouter/poolside/laguna-m.1:free",
    "openrouter/poolside/laguna-xs.2:free",
    "openrouter/qwen/qwen3-coder:free",
    "openrouter/qwen/qwen3-next-80b-a3b-instruct:free",
    "openrouter/z-ai/glm-4.5-air:free",
  ];
  return FREE_MODELS_PATTERNS.some((pattern) =>
    modelId.toLowerCase().includes(pattern.toLowerCase())
  );
}

async function syncInteractive() {
  try {
    // Read API key
    const authPath = join(homedir(), ".local/share/opencode/auth.json");
    const auth = JSON.parse(readFileSync(authPath, "utf-8"));
    const apiKey = auth.omniroute?.key;

    if (!apiKey) {
      console.error(
        "❌ OmniRoute API key not found in ~/.local/share/opencode/auth.json"
      );
      process.exit(1);
    }

    // Fetch models
    console.log("🔍 Discovering OmniRoute models...");
    const response = await fetch(`${OMNIROUTE_API}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const rawModels = data.data || [];
    const allModels = rawModels
      .filter((m) => m.object === "model")
      .map((m) => ({
        id: m.id,
        name: m.id.replace(/^.*\//, ""),
        isCombo: m.owned_by === "combo",
      }));

    console.log(`✓ Found ${allModels.length} models\n`);

    // Auto-detect aliases
    const providerCountsBeforeDedup = {};
    allModels.forEach((m) => {
      if (!m.id.startsWith("auto/") && !m.id.startsWith("premium-")) {
        const provider = m.id.includes("/") ? m.id.split("/")[0] : "misc";
        providerCountsBeforeDedup[provider] =
          (providerCountsBeforeDedup[provider] || 0) + 1;
      }
    });

    const detectedAliases = Object.entries(ALIAS_PAIRS)
      .filter(([alias, primary]) => {
        const aliasKey = alias.replace(/\/$/, "");
        const primaryKey = primary.replace(/\/$/, "");
        return (
          providerCountsBeforeDedup[aliasKey] !== undefined &&
          providerCountsBeforeDedup[aliasKey] ===
            providerCountsBeforeDedup[primaryKey]
        );
      })
      .map(([alias, primary]) => {
        const aliasKey = alias.replace(/\/$/, "");
        return `${aliasKey}=${primary.replace(/\/$/, "")} (${providerCountsBeforeDedup[aliasKey]})`;
      });

    if (detectedAliases.length > 0) {
      console.log(`⚠️  Detected aliases:`);
      detectedAliases.forEach((alias) => {
        console.log(`  • ${alias}`);
      });
      console.log("Auto-deduplicating...\n");
    }

    // Remove aliases
    let filteredModels = allModels.filter((m) => !isAlias(m.id));

    // Group into combos and providers
    const providerCounts = {};
    const foundCombos = [];

    filteredModels.forEach((m) => {
      if (m.isCombo || m.id.startsWith("auto/") || m.id.startsWith("premium-")) {
        foundCombos.push(m.id);
      } else {
        const provider = m.id.includes("/") ? m.id.split("/")[0] : "misc";
        providerCounts[provider] = (providerCounts[provider] || 0) + 1;
      }
    });

    const allCombos = [...new Set(foundCombos)].sort();
    const providerGroups = Object.entries(providerCounts).sort(
      (a, b) => b[1] - a[1]
    );

    // Dynamic page size based on terminal height
    const pageSize = Math.max(15, Math.floor(process.stdout.rows - 10));

    // CLI mode: parse flags and skip prompts
    let target, selectedCombos, selectedProviders;

    if (CLI_MODE) {
      // Parse CLI flags
      const cliTarget = getArgValue("--target") || "both";
      const cliInclude = getArgValue("--include")?.split(",").map((p) => p.trim()) || [];
      const cliExcludeProvider = getArgValue("--exclude-provider");
      const cliOnlyProvider = getArgValue("--only-provider");
      const cliDedup =
        process.argv.includes("--deduplicate") || process.argv.includes("--no-aliases");
      const cliFreeOnly = process.argv.includes("--free-only");

      // Apply dedup if requested
      if (cliDedup) {
        filteredModels = filteredModels.filter((m) => !isAlias(m.id));
      }

      // Apply free-tier filter
      if (cliFreeOnly) {
        filteredModels = filteredModels.filter((m) => isFreeTierModel(m.id));
      }

      // Apply provider filters
      if (cliInclude.length > 0) {
        filteredModels = filteredModels.filter((m) =>
          cliInclude.some((p) => m.id === p || m.id.startsWith(`${p}/`))
        );
      } else if (cliOnlyProvider) {
        filteredModels = filteredModels.filter((m) =>
          m.id.startsWith(`${cliOnlyProvider}/`)
        );
      }

      if (cliExcludeProvider) {
        filteredModels = filteredModels.filter((m) =>
          !m.id.startsWith(`${cliExcludeProvider}/`)
        );
      }

      target = cliTarget;

      // Separate combos and providers
      const cliCombos = [];
      const cliProviderModels = [];

      filteredModels.forEach((m) => {
        if (m.isCombo || m.id.startsWith("auto/") || m.id.startsWith("premium-")) {
          cliCombos.push(m.id);
        } else {
          cliProviderModels.push(m);
        }
      });

      selectedCombos = [...new Set(cliCombos)].sort();
      selectedProviders = [
        ...new Set(
          cliProviderModels.map((m) =>
            m.id.includes("/") ? m.id.split("/")[0] : "misc"
          )
        ),
      ].sort();
    } else {
      // Interactive loop with back navigation
      while (true) {
        // PROMPT 1: Select target
      const ans1 = await inquirer.prompt([
        {
          type: "list",
          name: "target",
          message: "Select config target:",
          choices: [
            {
              name: "OpenClaw  (~/.openclaw/openclaw.json)",
              value: "openclaw",
            },
            {
              name: "OpenCode  (~/.config/opencode/opencode.json)",
              value: "opencode",
            },
            { name: "Both", value: "both" },
            new inquirer.Separator(),
            { name: "Exit", value: null },
          ],
          pageSize: pageSize,
        },
      ]);

      if (ans1.target === null) {
        console.log("\n⚠️  Cancelled.");
        process.exit(0);
      }

      target = ans1.target;

      // PROMPT 2: Select combos
      const ans2 = await inquirer.prompt([
        {
          type: "checkbox",
          name: "selectedCombos",
          message: "Select combo endpoints:",
          prefix: "?",
          choices: [
            ...allCombos.map((id) => ({
              name: id,
              value: id,
              checked: false,
            })),
            new inquirer.Separator(),
            { name: "← Back", value: "__BACK__" },
          ],
          pageSize: pageSize,
          validate: (answer) => {
            if (answer.includes("__BACK__")) return true;
            return answer.length > 0 || "Select at least one";
          },
        },
      ], { skipTTYcheck: true });

      if (ans2.selectedCombos.includes("__BACK__")) {
        continue;
      }

      selectedCombos = ans2.selectedCombos;

      // PROMPT 3: Select providers
      const ans3 = await inquirer.prompt([
        {
          type: "checkbox",
          name: "selectedProviders",
          message: "Select providers:",
          prefix: "?",
          choices: [
            ...providerGroups.map(([name, count]) => ({
              name: `${name} (${count})`,
              value: name,
              checked: false,
            })),
            new inquirer.Separator(),
            { name: "← Back", value: "__BACK__" },
          ],
          pageSize: pageSize,
          validate: (answer) => {
            if (answer.includes("__BACK__")) return true;
            return answer.length > 0 || "Select at least one";
          },
        },
      ], { skipTTYcheck: true });

      if (ans3.selectedProviders.includes("__BACK__")) {
        continue;
      }

      selectedProviders = ans3.selectedProviders;
      break;
      }
    }

    // Build selected models list with or- naming convention
    const comboModels = selectedCombos.map((id) => ({
      id: renameModelId(id, true),
      name: id.replace(/^.*\//, ""),
    }));

    let modelsToFilter = filteredModels;

    // In interactive mode, filteredModels includes all models. Filter by selectedProviders.
    // In CLI mode, filteredModels already filtered. Include all non-combo models.
    if (!CLI_MODE) {
      modelsToFilter = filteredModels.filter((m) =>
        selectedProviders.includes(
          m.id.includes("/") ? m.id.split("/")[0] : "misc"
        )
      );
    }

    const providerModels = modelsToFilter
      .filter(
        (m) =>
          !m.isCombo &&
          !m.id.startsWith("auto/") &&
          !m.id.startsWith("premium-")
      )
      .map((m) => ({
        id: renameModelId(m.id, false),
        name: m.name,
      }));

    // Sort: combos first (alphabetically), then providers (alphabetically)
    const sortedCombos = comboModels.sort((a, b) => a.id.localeCompare(b.id));
    const sortedProviders = providerModels.sort((a, b) => a.id.localeCompare(b.id));
    const totalModels = [...sortedCombos, ...sortedProviders];

    // Get config paths
    const openclaw_path = join(homedir(), ".openclaw/openclaw.json");
    const opencode_path = join(homedir(), ".config/opencode/opencode.json");
    const agent_models_path = join(homedir(), ".openclaw/agents/main/agent/models.json");

    const targets = {
      openclaw: target === "openclaw" || target === "both",
      opencode: target === "opencode" || target === "both",
    };

    const targetPaths = [];
    if (targets.openclaw) targetPaths.push(openclaw_path);
    if (targets.opencode) targetPaths.push(opencode_path);

    // Auto-sync to agent if openclaw is target and agent exists
    let syncAgent = false;
    try {
      readFileSync(agent_models_path, "utf-8");
      if (targets.openclaw) {
        syncAgent = true;
        targetPaths.push(agent_models_path);
      }
    } catch (e) {
      // agent models.json doesn't exist, skip
    }

    // PROMPT 4: Confirm (skip in CLI mode)
    let confirm = true;
    if (!CLI_MODE) {
      const ans4 = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: `Write ${totalModels.length} models to ${targetPaths.length} config file(s)?`,
          default: true,
        },
      ]);
      confirm = ans4.confirm;

      if (!confirm) {
        console.log("\n⚠️  Cancelled. No changes made.");
        process.exit(0);
      }
    } else {
      console.log(`📝 Writing ${totalModels.length} models to ${targetPaths.length} config file(s)...`);
    }

    // Write configs
    console.log();
    const written = [];

    if (targets.openclaw) {
      const openclaw_config = JSON.parse(
        readFileSync(openclaw_path, "utf-8")
      );
      const backupPath = `${openclaw_path}.bak`;
      writeFileSync(backupPath, readFileSync(openclaw_path, "utf-8"));

      if (!openclaw_config.models) openclaw_config.models = {};
      if (!openclaw_config.models.providers)
        openclaw_config.models.providers = {};

      const apiKey = auth.omniroute?.key;
      openclaw_config.models.providers.omniroute = {
        baseUrl: "http://192.168.0.51:20128/v1",
        apiKey: apiKey,
        api: "openai-completions",
        models: totalModels,
      };

      // Update agents.defaults.models to include all synced models (whitelist for dropdown)
      if (!openclaw_config.agents) openclaw_config.agents = {};
      if (!openclaw_config.agents.defaults) openclaw_config.agents.defaults = {};
      if (!openclaw_config.agents.defaults.models) openclaw_config.agents.defaults.models = {};

      totalModels.forEach((m) => {
        openclaw_config.agents.defaults.models[m.id] = {};
      });

      writeFileSync(openclaw_path, JSON.stringify(openclaw_config, null, 2) + "\n");
      console.log(`✅ OpenClaw: ${totalModels.length} models`);
      console.log(`   Backup: ${backupPath}`);
      written.push("openclaw");
    }

    if (targets.opencode) {
      const opencode_config = JSON.parse(
        readFileSync(opencode_path, "utf-8")
      );
      const backupPath = `${opencode_path}.bak`;
      writeFileSync(backupPath, readFileSync(opencode_path, "utf-8"));

      if (!opencode_config.models) opencode_config.models = {};
      if (!opencode_config.models.providers)
        opencode_config.models.providers = {};

      const apiKey = auth.omniroute?.key;
      opencode_config.models.providers.omniroute = {
        baseUrl: "http://192.168.0.51:20128/v1",
        apiKey: apiKey,
        api: "openai-completions",
        models: totalModels,
      };

      // Update agents.defaults.models to include all synced models (whitelist for dropdown)
      if (!opencode_config.agents) opencode_config.agents = {};
      if (!opencode_config.agents.defaults) opencode_config.agents.defaults = {};
      if (!opencode_config.agents.defaults.models) opencode_config.agents.defaults.models = {};

      totalModels.forEach((m) => {
        opencode_config.agents.defaults.models[m.id] = {};
      });

      writeFileSync(
        opencode_path,
        JSON.stringify(opencode_config, null, 2) + "\n"
      );
      console.log(`✅ OpenCode: ${totalModels.length} models`);
      console.log(`   Backup: ${backupPath}`);
      written.push("opencode");
    }

    if (syncAgent) {
      const backupPath = `${agent_models_path}.bak`;
      writeFileSync(backupPath, readFileSync(agent_models_path, "utf-8"));

      // Read current agent config safely
      let agent_config;
      try {
        agent_config = JSON.parse(readFileSync(agent_models_path, "utf-8"));
      } catch (e) {
        agent_config = {};
      }

      // Agent config uses flat structure: { providers: {...}, agents: {...} }
      if (!agent_config.providers) agent_config.providers = {};
      if (!agent_config.agents) agent_config.agents = {};
      if (!agent_config.agents.defaults) agent_config.agents.defaults = {};
      if (!agent_config.agents.defaults.model) agent_config.agents.defaults.model = {};
      if (!agent_config.agents.defaults.models) agent_config.agents.defaults.models = {};

      // Update omniroute provider
      const apiKey = auth.omniroute?.key;
      agent_config.providers.omniroute = {
        baseUrl: "http://192.168.0.51:20128/v1",
        apiKey: apiKey,
        api: "openai-completions",
        models: totalModels,
      };

      // Set omniroute as default if not already set
      if (!agent_config.agents.defaults.model.primary) {
        agent_config.agents.defaults.model.primary = "omniroute/cost-saver";
      }

      // Update agents.defaults.models to include all synced models (whitelist for dropdown)
      totalModels.forEach((m) => {
        agent_config.agents.defaults.models[m.id] = {};
      });

      writeFileSync(
        agent_models_path,
        JSON.stringify(agent_config, null, 2) + "\n"
      );
      console.log(`✅ Agent: ${totalModels.length} models`);
      console.log(`   Backup: ${backupPath}`);
      written.push("agent");
    }

    console.log(`\n✨ Done! Synced to ${written.join(" + ")}`);
  } catch (err) {
    console.error(
      "❌ Error:",
      err instanceof Error ? err.message : String(err)
    );
    process.exit(1);
  }
}

syncInteractive();
