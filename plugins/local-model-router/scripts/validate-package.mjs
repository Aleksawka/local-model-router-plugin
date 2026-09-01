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
  await parseJson("plugins/local-model-router/config/router-policy.json");

  if (marketplace?.plugins?.[0]?.source !== "./plugins/local-model-router") errors.push("Marketplace source is incorrect");
  if (manifest?.name !== "local-model-router") errors.push("Plugin name is incorrect");
  if (hooks?.version !== 1 || !Array.isArray(hooks?.hooks?.preToolUse)) errors.push("preToolUse hook is missing");
  if (hooks?.hooks?.preToolUse?.[0]?.env?.LOCAL_ROUTER_MODE !== "audit") errors.push("Archive must ship in audit mode");

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
    if (file.includes("junior") && /^\s*-\s*agent\s*$/mu.test(text)) errors.push(`${file}: Junior must not have agent tool`);
  }

  for (const required of [
    "scripts/task-routing-hook.mjs",
    "scripts/configure-models.mjs",
    "skills/local-routing-policy/SKILL.md"
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
