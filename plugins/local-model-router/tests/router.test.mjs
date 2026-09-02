import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hook = path.join(pluginRoot, "scripts/task-routing-hook.mjs");
const fixtures = path.join(pluginRoot, "tests/fixtures");

async function fixture(name) {
  return readFile(path.join(fixtures, name), "utf8");
}

function unwrapArgs(value) {
  if (typeof value === "string") return JSON.parse(value);
  return value;
}

async function runHook(input, mode = "audit") {
  const testRoot = path.join(pluginRoot, ".test-tmp");
  await mkdir(testRoot, { recursive: true });
  const dataDir = await mkdtemp(path.join(testRoot, "run-"));
  const result = spawnSync(process.execPath, [hook], {
    input,
    encoding: "utf8",
    env: { ...process.env, LOCAL_ROUTER_MODE: mode, COPILOT_PLUGIN_DATA: dataDir }
  });
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 1, "Hook must emit exactly one JSON object");
  const output = JSON.parse(lines[0]);
  const audit = JSON.parse((await readFile(path.join(dataDir, "router-events.jsonl"), "utf8")).trim());
  await rm(dataDir, { recursive: true, force: true });
  return { output, audit, rawAudit: JSON.stringify(audit) };
}

test("audit mode observes task schema and never logs prompt text", async () => {
  const result = await runHook(await fixture("test-runner.json"), "audit");
  assert.deepEqual(result.output, {});
  assert.equal(result.audit.agentField, "agent_type");
  assert.equal(result.audit.route, "junior-test-runner");
  assert.equal(result.rawAudit.includes("DO_NOT_LOG_THIS_PROMPT"), false);
});

test("rewrite mode changes only the recognized agent selector", async () => {
  const input = JSON.parse(await fixture("test-runner.json"));
  const result = await runHook(JSON.stringify(input), "rewrite");
  assert.equal(result.output.modifiedArgs.agent_type, "local-router-junior-test-runner");
  assert.equal(result.output.modifiedArgs.prompt, input.toolArgs.prompt);
  assert.deepEqual(result.output.updatedInput, result.output.modifiedArgs);
  assert.equal(result.audit.action, "rewrite-agent");
});

test("rewrite mode denies a proposed Junior for a security task", async () => {
  const result = await runHook(await fixture("security-task.json"), "rewrite");
  assert.equal(result.output.permissionDecision, "deny");
  assert.equal(result.audit.route, "senior");
  assert.equal(result.audit.action, "deny-unsafe-junior");
});

test("rewrite mode selects the bounded test writer", async () => {
  const result = await runHook(await fixture("test-writer.json"), "rewrite");
  assert.equal(result.output.modifiedArgs.agent_type, "local-router-junior-test-writer");
  assert.equal(result.audit.route, "junior-test-writer");
});

test("rewrite mode supports a Russian read-only exploration prompt", async () => {
  const result = await runHook(await fixture("russian-explorer.json"), "rewrite");
  assert.equal(result.output.modifiedArgs.agent_type, "local-router-junior-explorer");
  assert.equal(result.audit.route, "junior-explorer");
});

test("rewrite mode fails open when the task selector schema is unknown", async () => {
  const result = await runHook(await fixture("unknown-schema.json"), "rewrite");
  assert.deepEqual(result.output, {});
  assert.equal(result.audit.action, "schema-not-recognized");
});

test("malformed input returns an empty decision instead of blocking the task", async () => {
  const result = await runHook("not-json", "rewrite");
  assert.deepEqual(result.output, {});
  assert.equal(result.audit.outcome, "invalid-hook-json");
});

test("rewrite mode parses camelCase toolArgs when they arrive as a JSON string", async () => {
  const result = await runHook(await fixture("json-string-tool-args.json"), "rewrite");
  const modified = unwrapArgs(result.output.modifiedArgs);
  assert.equal(typeof result.output.modifiedArgs, "string");
  assert.equal(modified.agent_type, "local-router-junior-test-runner");
  assert.equal(result.output.updatedInput.agent_type, "local-router-junior-test-runner");
  assert.equal(result.audit.argsRepresentation, "json-string");
  assert.equal(result.audit.action, "rewrite-agent");
});

test("rewrite mode accepts Claude/App Agent payloads with tool_input and subagent_type", async () => {
  const result = await runHook(await fixture("claude-agent-tool-input.json"), "rewrite");
  assert.equal(result.output.modifiedArgs.subagent_type, "local-router-junior-explorer");
  assert.equal(result.output.updatedInput.subagent_type, "local-router-junior-explorer");
  assert.equal(result.audit.toolName, "Agent");
  assert.equal(result.audit.agentField, "subagent_type");
  assert.equal(result.audit.route, "junior-explorer");
  assert.equal(result.audit.action, "rewrite-agent");
});
