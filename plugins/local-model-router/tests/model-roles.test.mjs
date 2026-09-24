import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  applyRoleAssignment,
  checkRoleAssignment,
  extractFrontmatterModel,
  readAssignedModels,
  readRoleSetting,
  validateModelId
} from "../scripts/lib/model-roles.mjs";
import {
  assertInCatalog,
  discoverImportedModels,
  endpointCatalogModels,
  extractImportedModels,
  formatModelList,
  parseJsonDocument,
  resolveRoleSelection,
  stripSecrets
} from "../scripts/lib/imported-models.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(pluginRoot, "tests/fixtures");
const configure = path.join(pluginRoot, "scripts/configure-models.mjs");

async function readJsonFixture(name) {
  return JSON.parse(await readFile(path.join(fixtures, name), "utf8"));
}

async function withPluginCopy(run) {
  const root = await mkdtemp(path.join(tmpdir(), "local-router-roles-"));
  await mkdir(path.join(root, "config"), { recursive: true });
  await cp(path.join(pluginRoot, "agents"), path.join(root, "agents"), { recursive: true });
  await cp(path.join(pluginRoot, "config/model-roles.json"), path.join(root, "config/model-roles.json"));
  await cp(path.join(pluginRoot, "config/imported-models.json"), path.join(root, "config/imported-models.json"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("extracts Copilot App provider-imported models and drops secrets", async () => {
  const payload = await readJsonFixture("copilot-app-providers.json");
  const models = extractImportedModels(payload);
  assert.deepEqual(models.map((model) => model.id), ["qwen3-coder-30b", "qwen3-coder-8b"]);
  assert.equal(models[0].provider, "oMLX");
  assert.equal(models[0].origin, "imported");
  assert.equal(JSON.stringify(models).includes("SECRET_SHOULD_NOT_LEAK"), false);
  assert.equal("apiKey" in stripSecrets(payload).providers[0], false);
});

test("extracts OpenAI-compatible catalog entries", async () => {
  const models = extractImportedModels(await readJsonFixture("copilot-openai-models.json"));
  assert.deepEqual(models.map((model) => model.id), ["local-senior", "local-junior"]);
});

test("keeps imported models and skips GitHub-hosted plus Auto", async () => {
  const models = extractImportedModels(await readJsonFixture("copilot-hosted-and-imported.json"));
  assert.deepEqual(models.map((model) => model.id), ["phi-local"]);
  const withHosted = extractImportedModels(await readJsonFixture("copilot-hosted-and-imported.json"), { includeHosted: true });
  assert.deepEqual(withHosted.map((model) => model.id), ["gpt-4.1", "phi-local"]);
});

test("parses JSONC catalogs", () => {
  const models = extractImportedModels(parseJsonDocument(`{
    // picker export
    "models": [{ "id": "imported-a", "name": "A", "imported": true }]
  }`));
  assert.equal(models[0].id, "imported-a");
});

test("descends into provider containers instead of listing the provider", () => {
  const models = extractImportedModels({
    providers: [{
      id: "my-provider",
      displayName: "My Provider",
      models: [{ id: "m1", name: "M1" }, { id: "m2" }]
    }]
  });
  assert.deepEqual(models.map((model) => model.id), ["m1", "m2"]);
  assert.equal(models[0].provider, "My Provider");
});

test("prints origin so imported and unknown catalog rows are distinguishable", () => {
  const text = formatModelList([
    { id: "phi-local", origin: "imported", provider: "Foundry", name: "Phi" },
    { id: "gpt-4.1", origin: "unknown", provider: "openai" }
  ]);
  assert.match(text, /phi-local\s+\(imported — Foundry — Phi\)/);
  assert.match(text, /gpt-4.1\s+\(unknown — openai\)/);
});

test("keeps only imported endpoint models unless the caller confirms unlisted IDs", () => {
  const openai = extractImportedModels({
    data: [
      { id: "gpt-4.1", object: "model", owned_by: "openai" },
      { id: "local-senior", object: "model", owned_by: "ollama", imported: true }
    ]
  });
  assert.equal(openai.find((model) => model.id === "gpt-4.1").origin, "unknown");
  assert.deepEqual(endpointCatalogModels(openai).map((model) => model.id), ["local-senior"]);
  assert.deepEqual(
    endpointCatalogModels(openai, { allowUnlisted: true }).map((model) => model.id),
    ["gpt-4.1", "local-senior"]
  );
});

test("resolves role selection by exact ID or 1-based index", () => {
  const models = [{ id: "senior-id" }, { id: "junior-id" }];
  assert.equal(resolveRoleSelection("junior-id", models, "Junior"), "junior-id");
  assert.equal(resolveRoleSelection("1", models, "Senior"), "senior-id");
  assert.equal(resolveRoleSelection("2", models, "Junior"), "junior-id");
  assert.throws(() => resolveRoleSelection("missing", models, "Senior"), /not one of the discovered/);
  assert.throws(() => assertInCatalog("missing", models, "Senior", false), /not in the Copilot-imported model catalog/);
  assertInCatalog("missing", models, "Senior", true);
});

test("discovers a catalog from Copilot App-like search roots", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "copilot-app-data-"));
  try {
    await mkdir(path.join(root, "Settings"), { recursive: true });
    await writeFile(
      path.join(root, "Settings/model-providers.json"),
      await readFile(path.join(fixtures, "copilot-app-providers.json"))
    );
    const discovered = await discoverImportedModels({ searchRoots: [root] });
    assert.deepEqual(discovered.models.map((model) => model.id), ["qwen3-coder-30b", "qwen3-coder-8b"]);
    assert.match(discovered.catalogSource, /copilot-app-data:model-providers.json/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("applyRoleAssignment writes the setting and agent pins", async () => {
  await withPluginCopy(async (root) => {
    const catalog = extractImportedModels(await readJsonFixture("copilot-app-providers.json"));
    const result = await applyRoleAssignment({
      pluginRoot: root,
      seniorModelId: "qwen3-coder-30b",
      juniorModelId: "qwen3-coder-8b",
      catalog,
      catalogSource: "test-catalog",
      now: "2026-09-22T00:00:00.000Z"
    });
    const setting = await readRoleSetting(root);
    const assigned = await readAssignedModels(root);
    assert.equal(result.models.senior, "qwen3-coder-30b");
    assert.equal(setting.seniorModelId, "qwen3-coder-30b");
    assert.equal(setting.juniorModelId, "qwen3-coder-8b");
    assert.equal(assigned["agents/local-router-orchestrator.agent.md"].model, "qwen3-coder-30b");
    assert.equal(assigned["agents/local-router-junior-explorer.agent.md"].model, "qwen3-coder-8b");
    assert.equal(assigned["agents/local-router-junior-test-runner.agent.md"].model, "qwen3-coder-8b");
    assert.equal(assigned["agents/local-router-junior-test-writer.agent.md"].model, "qwen3-coder-8b");
    const check = checkRoleAssignment({ setting, assigned, catalog });
    assert.deepEqual(check.problems, []);
    assert.equal(check.configured, true);
  });
});

test("checkRoleAssignment reports unassigned placeholders and mismatches", () => {
  const unassigned = checkRoleAssignment({
    setting: { seniorModelId: null, juniorModelId: null, catalog: [] },
    assigned: {
      "agents/local-router-orchestrator.agent.md": { role: "senior", model: "__QWEN_SENIOR_EXACT_ID__" }
    },
    allowPlaceholders: true
  });
  assert.equal(unassigned.configured, false);

  const mismatch = checkRoleAssignment({
    setting: { seniorModelId: "a", juniorModelId: "b", catalog: [{ id: "a" }, { id: "b" }] },
    assigned: {
      "agents/local-router-orchestrator.agent.md": { role: "senior", model: "other" },
      "agents/junior.md": { role: "junior", model: "b" }
    }
  });
  assert.equal(mismatch.configured, false);
  assert.match(mismatch.problems.join("\n"), /does not match senior setting/);
});

test("rejects Copilot Auto as a role holder", async () => {
  await withPluginCopy(async (root) => {
    await assert.rejects(
      () => applyRoleAssignment({
        pluginRoot: root,
        seniorModelId: "auto",
        juniorModelId: "qwen3-coder-8b"
      }),
      /cannot be Copilot Auto/
    );
    await assert.rejects(
      () => applyRoleAssignment({
        pluginRoot: root,
        seniorModelId: "copilot-auto",
        juniorModelId: "qwen3-coder-8b"
      }),
      /cannot be Copilot Auto/
    );
  });
  assert.throws(() => validateModelId("Senior", "copilot-auto"), /cannot be Copilot Auto/);
});

test("threads includeHosted into catalog file extraction", async () => {
  const file = path.join(fixtures, "copilot-hosted-and-imported.json");
  const plain = await discoverImportedModels({ catalogFiles: [file] });
  assert.deepEqual(plain.models.map((model) => model.id), ["phi-local"]);
  const hosted = await discoverImportedModels({ catalogFiles: [file], includeHosted: true });
  assert.deepEqual(hosted.models.map((model) => model.id), ["gpt-4.1", "phi-local"]);
});

test("configure-models CLI lists, assigns by index, and checks the setting", async () => {
  await withPluginCopy(async (root) => {
    const env = { ...process.env, LOCAL_ROUTER_PLUGIN_ROOT: root };
    const catalog = path.join(fixtures, "copilot-app-providers.json");
    const listed = spawnSync(process.execPath, [configure, "--catalog", catalog, "--list"], { encoding: "utf8", env });
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /qwen3-coder-30b/);
    assert.match(listed.stdout, /qwen3-coder-8b/);

    const assigned = spawnSync(process.execPath, [configure, "--catalog", catalog, "--senior", "1", "--junior", "2"], {
      encoding: "utf8",
      env
    });
    assert.equal(assigned.status, 0, assigned.stderr + assigned.stdout);
    assert.match(assigned.stdout, /senior=qwen3-coder-30b/);
    assert.match(assigned.stdout, /junior=qwen3-coder-8b/);

    const checked = spawnSync(process.execPath, [configure, "--check"], { encoding: "utf8", env });
    assert.equal(checked.status, 0, checked.stderr + checked.stdout);
    assert.match(checked.stdout, /OK\tagents\/local-router-orchestrator.agent.md\tsenior\tqwen3-coder-30b/);

    const orchestrator = await readFile(path.join(root, "agents/local-router-orchestrator.agent.md"), "utf8");
    assert.equal(extractFrontmatterModel(orchestrator, "orchestrator"), "qwen3-coder-30b");
  });
});

test("configure-models CLI refuses IDs outside the imported catalog", async () => {
  await withPluginCopy(async (root) => {
    const env = { ...process.env, LOCAL_ROUTER_PLUGIN_ROOT: root };
    const catalog = path.join(fixtures, "copilot-app-providers.json");
    const refused = spawnSync(
      process.execPath,
      [configure, "--catalog", catalog, "--senior", "not-imported", "--junior", "qwen3-coder-8b"],
      { encoding: "utf8", env }
    );
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /not one of the discovered Copilot-imported models/);

    const unlisted = spawnSync(
      process.execPath,
      [configure, "--allow-unlisted", "--senior", "picker-senior", "--junior", "picker-junior"],
      { encoding: "utf8", env }
    );
    assert.equal(unlisted.status, 0, unlisted.stderr + unlisted.stdout);
    assert.match(unlisted.stdout, /senior=picker-senior/);

    const partial = spawnSync(
      process.execPath,
      [configure, "--catalog", catalog, "--allow-unlisted", "--senior", "picker-senior", "--junior", "2"],
      { encoding: "utf8", env }
    );
    assert.equal(partial.status, 0, partial.stderr + partial.stdout);
    assert.match(partial.stdout, /senior=picker-senior/);
    assert.match(partial.stdout, /junior=qwen3-coder-8b/);

    const auto = spawnSync(
      process.execPath,
      [configure, "--allow-unlisted", "--senior", "copilot-auto", "--junior", "picker-junior"],
      { encoding: "utf8", env }
    );
    assert.equal(auto.status, 1);
    assert.match(auto.stderr, /cannot be Copilot Auto/);
  });
});
