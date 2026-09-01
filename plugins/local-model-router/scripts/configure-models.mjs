#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assignments = new Map([
  ["agents/local-router-orchestrator.agent.md", "senior"],
  ["agents/local-router-junior-explorer.agent.md", "junior"],
  ["agents/local-router-junior-test-runner.agent.md", "junior"],
  ["agents/local-router-junior-test-writer.agent.md", "junior"]
]);

function usage() {
  console.log(`Usage:
  node scripts/configure-models.mjs --senior <exact-id> --junior <exact-id>
  node scripts/configure-models.mjs --check

Environment alternatives:
  QWEN_SENIOR_MODEL_ID
  QWEN_JUNIOR_MODEL_ID`);
}

function parseArgs(argv) {
  const result = { check: false, senior: process.env.QWEN_SENIOR_MODEL_ID, junior: process.env.QWEN_JUNIOR_MODEL_ID };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--check") result.check = true;
    else if (value === "--senior") result.senior = argv[++i];
    else if (value === "--junior") result.junior = argv[++i];
    else if (value === "--help" || value === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}

function validateModelId(label, value) {
  if (!value || typeof value !== "string") throw new Error(`Missing ${label} model ID`);
  if (value.length > 300 || /[\r\n]/u.test(value)) throw new Error(`Invalid ${label} model ID`);
  return value;
}

function yamlQuote(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function extractModel(text, file) {
  const match = text.match(/^model:\s*["']?([^"'\r\n]+)["']?\s*$/mu);
  if (!match) throw new Error(`No model field in ${file}`);
  return match[1].trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  if (args.check) {
    let failed = false;
    for (const [relative] of assignments) {
      const text = await readFile(path.join(pluginRoot, relative), "utf8");
      const model = extractModel(text, relative);
      const configured = !model.startsWith("__") && !model.endsWith("__");
      console.log(`${configured ? "OK" : "NOT_CONFIGURED"}\t${relative}\t${model}`);
      failed ||= !configured;
    }
    if (failed) process.exitCode = 2;
    return;
  }

  const models = {
    senior: validateModelId("Senior", args.senior),
    junior: validateModelId("Junior", args.junior)
  };

  for (const [relative, role] of assignments) {
    const target = path.join(pluginRoot, relative);
    const original = await readFile(target, "utf8");
    if (!/^model:\s*.+$/mu.test(original)) throw new Error(`No model field in ${relative}`);
    const updated = original.replace(/^model:\s*.+$/mu, `model: ${yamlQuote(models[role])}`);
    await writeFile(target, updated, "utf8");
    console.log(`Configured ${relative} -> ${models[role]}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  usage();
  process.exitCode = 1;
});
