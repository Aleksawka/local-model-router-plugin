#!/usr/bin/env node

import { access, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distributionRoot = path.resolve(pluginRoot, "../..");
const allowPlaceholders = process.argv.includes("--allow-placeholders");
const errors = [];

async function parseJson(relativeToDistribution) {
  const fullPath = path.join(distributionRoot, relativeToDistribution);
  try {
    return JSON.parse(await readFile(fullPath, "utf8"));
  } catch (error) {
    errors.push(`${relativeToDistribution}: ${error.message}`);
    return null;
  }
}

async function main() {
  const marketplace = await parseJson(".github/plugin/marketplace.json");
  const manifest = await parseJson("plugins/local-model-router/plugin.json");
  const hooks = await parseJson("plugins/local-model-router/hooks.json");
  const modelRoles = await parseJson("plugins/local-model-router/config/model-roles.json");
  const importedModels = await parseJson("plugins/local-model-router/config/imported-models.json");
  await parseJson("plugins/local-model-router/config/router-policy.json");

  if (marketplace?.plugins?.[0]?.source !== "./plugins/local-model-router") errors.push("Marketplace source is incorrect");
  if (manifest?.name !== "local-model-router") errors.push("Plugin name is incorrect");
  if (manifest?.commands !== "commands/") errors.push("Plugin commands path is missing");
  if (hooks?.version !== 1 || !Array.isArray(hooks?.hooks?.preToolUse)) errors.push("preToolUse hook is missing");
  if (hooks?.hooks?.preToolUse?.[0]?.env?.LOCAL_ROUTER_MODE !== "audit") errors.push("Archive must ship in audit mode");
  const matcher = hooks?.hooks?.preToolUse?.[0]?.matcher ?? "";
  if (!/\btask\b/u.test(matcher) || !/\bAgent\b/u.test(matcher)) {
    errors.push("preToolUse matcher must cover both Copilot `task` and Claude/App `Agent` tool names");
  }
  if (!hooks?.hooks?.preToolUse?.[0]?.bash) errors.push("bash hook command is missing");
  if (!hooks?.hooks?.preToolUse?.[0]?.powershell) errors.push("powershell hook command is missing");
  if (!String(hooks?.hooks?.preToolUse?.[0]?.bash ?? "").includes("PLUGIN_ROOT")) {
    errors.push("bash hook command must resolve plugin root from documented env vars");
  }
  if (modelRoles?.version !== 1) errors.push("model-roles.json must be version 1");
  if (importedModels && !Array.isArray(importedModels.models)) errors.push("imported-models.json must include a models array");
  if (!allowPlaceholders) {
    if (!modelRoles?.seniorModelId || !modelRoles?.juniorModelId) {
      errors.push("Senior and Junior roles are not assigned in model-roles.json");
    }
  }

  const agentDir = path.join(pluginRoot, "agents");
  const agentFiles = (await readdir(agentDir)).filter((file) => file.endsWith(".agent.md"));
  const names = new Set();
  for (const file of agentFiles) {
    const text = await readFile(path.join(agentDir, file), "utf8");
    const name = text.match(/^name:\s*(.+)$/mu)?.[1]?.trim();
    const model = text.match(/^model:\s*["']?([^"'\r\n]+)["']?\s*$/mu)?.[1]?.trim();
    if (!name) errors.push(`${file}: missing name`);
    else if (names.has(name)) errors.push(`${file}: duplicate name ${name}`);
    else names.add(name);
    if (!/^description:\s*.+$/mu.test(text)) errors.push(`${file}: missing description`);
    if (!model) errors.push(`${file}: missing model`);
    if (!allowPlaceholders && model?.startsWith("__")) errors.push(`${file}: model ID is not configured`);
    if (!allowPlaceholders && file.includes("orchestrator") && modelRoles?.seniorModelId && model !== modelRoles.seniorModelId) {
      errors.push(`${file}: model does not match Senior setting`);
    }
    if (!allowPlaceholders && file.includes("junior") && modelRoles?.juniorModelId && model !== modelRoles.juniorModelId) {
      errors.push(`${file}: model does not match Junior setting`);
    }
    if (file.includes("junior") && /^\s*-\s*agent\s*$/mu.test(text)) errors.push(`${file}: Junior must not have agent tool`);
  }

  for (const required of [
    "scripts/task-routing-hook.mjs",
    "scripts/configure-models.mjs",
    "scripts/lib/imported-models.mjs",
    "scripts/lib/model-roles.mjs",
    "commands/set-model-roles.md",
    "skills/local-routing-policy/SKILL.md",
    "skills/local-model-roles/SKILL.md"
  ]) {
    try {
      await access(path.join(pluginRoot, required));
    } catch {
      errors.push(`Missing ${required}`);
    }
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Package is valid: ${agentFiles.length} agents, audit-first hook, marketplace source OK.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
