#!/usr/bin/env node

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const knownAgentFields = ["agent_type", "agentType", "agent", "subagent_type", "subagentType", "agent_name", "agentName"];
const promptFields = ["prompt", "task", "description", "message", "instructions"];
const juniorAgents = new Set([
  "local-router-junior-explorer",
  "local-router-junior-test-runner",
  "local-router-junior-test-writer"
]);

function hash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

async function readStdin() {
  let value = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

function normalizeArgs(rawArgs) {
  if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
    return { args: rawArgs, representation: "object" };
  }
  if (typeof rawArgs === "string") {
    try {
      const parsed = JSON.parse(rawArgs);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { args: parsed, representation: "json-string" };
      }
    } catch {
      // The real schema is intentionally discovered in audit mode.
    }
  }
  return { args: {}, representation: typeof rawArgs };
}

function extractPrompt(args) {
  for (const field of promptFields) {
    if (typeof args[field] === "string") return args[field];
  }
  return "";
}

function containsAny(text, values = []) {
  return values.some((value) => text.includes(value.toLocaleLowerCase("en-US")));
}

function classify(prompt, policy) {
  const text = prompt.toLocaleLowerCase("en-US");
  if (!text.trim()) return { route: "senior", agent: null, reasons: ["empty-or-undetected-prompt"] };

  const seniorHits = policy.seniorTriggers.filter((value) => text.includes(value.toLocaleLowerCase("en-US")));
  if (seniorHits.length > 0) {
    return { route: "senior", agent: null, reasons: ["senior-trigger", ...seniorHits.slice(0, 3)] };
  }

  for (const candidate of policy.routes) {
    const verb = containsAny(text, candidate.verbs);
    const object = containsAny(text, candidate.objects);
    const bounded = !candidate.requiresBoundedSignal || containsAny(text, policy.boundedSignals);
    if (verb && object && bounded) {
      return { route: candidate.id, agent: candidate.agent, reasons: ["verb", "object", ...(bounded ? ["bounded"] : [])] };
    }
  }

  return { route: "senior", agent: null, reasons: ["no-safe-junior-rule"] };
}

function safeAgentValue(value) {
  if (typeof value !== "string") return null;
  if (/^[a-zA-Z0-9_.:-]{1,120}$/u.test(value)) return value;
  return `sha256:${hash(value)}`;
}

async function writeAudit(record) {
  const dataRoot = process.env.COPILOT_PLUGIN_DATA || path.join(tmpdir(), "copilot-local-model-router");
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  await appendFile(path.join(dataRoot, "router-events.jsonl"), `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
}

function finalOutput(value = {}) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main() {
  const mode = process.env.LOCAL_ROUTER_MODE === "rewrite" ? "rewrite" : "audit";
  const rawInput = await readStdin();
  let input;
  try {
    input = JSON.parse(rawInput);
  } catch {
    await writeAudit({ version: 1, timestamp: new Date().toISOString(), mode, outcome: "invalid-hook-json", inputLength: rawInput.length });
    finalOutput({});
    return;
  }

  const policy = JSON.parse(await readFile(path.join(pluginRoot, "config/router-policy.json"), "utf8"));
  const toolName = input.toolName ?? input.tool_name ?? "unknown";
  const normalized = normalizeArgs(input.toolArgs ?? input.tool_args);
  const args = normalized.args;
  const prompt = extractPrompt(args);
  const agentField = knownAgentFields.find((field) => Object.hasOwn(args, field)) ?? null;
  const proposedAgent = agentField ? safeAgentValue(args[agentField]) : null;
  const decision = toolName === "task" ? classify(prompt, policy) : { route: "ignored", agent: null, reasons: ["non-task-tool"] };

  let action = "observe";
  let output = {};

  if (mode === "rewrite" && toolName === "task") {
    if (decision.agent && agentField) {
      output = { modifiedArgs: { ...args, [agentField]: decision.agent } };
      action = proposedAgent === decision.agent ? "already-selected" : "rewrite-agent";
    } else if (!decision.agent && proposedAgent && juniorAgents.has(proposedAgent)) {
      output = {
        permissionDecision: "deny",
        permissionDecisionReason: "Local router kept this task on Senior because it did not match a bounded Junior rule."
      };
      action = "deny-unsafe-junior";
    } else if (decision.agent && !agentField) {
      action = "schema-not-recognized";
    } else {
      action = "keep-existing-route";
    }
  }

  await writeAudit({
    version: 1,
    timestamp: new Date().toISOString(),
    mode,
    sessionHash: hash(input.sessionId ?? input.session_id ?? ""),
    toolName,
    argsRepresentation: normalized.representation,
    argKeys: Object.keys(args).sort(),
    agentField,
    proposedAgent,
    promptLength: prompt.length,
    promptHash: hash(prompt),
    route: decision.route,
    selectedAgent: decision.agent,
    reasons: decision.reasons,
    action
  });

  finalOutput(output);
}

main().catch(async (error) => {
  try {
    await writeAudit({
      version: 1,
      timestamp: new Date().toISOString(),
      mode: process.env.LOCAL_ROUTER_MODE ?? "audit",
      outcome: "hook-error",
      errorType: error?.name ?? "Error"
    });
  } catch {
    // Logging must never turn an audit experiment into a blocked tool call.
  }
  finalOutput({});
});
