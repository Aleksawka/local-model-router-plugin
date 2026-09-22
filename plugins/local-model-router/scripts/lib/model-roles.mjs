import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const ROLE_ASSIGNMENTS = [
  ["agents/local-router-orchestrator.agent.md", "senior"],
  ["agents/local-router-junior-explorer.agent.md", "junior"],
  ["agents/local-router-junior-test-runner.agent.md", "junior"],
  ["agents/local-router-junior-test-writer.agent.md", "junior"]
];

export const MODEL_ROLES_RELATIVE = "config/model-roles.json";
export const IMPORTED_MODELS_RELATIVE = "config/imported-models.json";

export function yamlQuote(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function validateModelId(label, value) {
  if (!value || typeof value !== "string") throw new Error(`Missing ${label} model ID`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Missing ${label} model ID`);
  if (trimmed.length > 300 || /[\r\n]/u.test(trimmed)) throw new Error(`Invalid ${label} model ID`);
  if (trimmed.toLocaleLowerCase("en-US") === "auto") throw new Error(`${label} cannot be Copilot Auto`);
  return trimmed;
}

export function extractFrontmatterModel(text, file) {
  const match = text.match(/^model:\s*["']?([^"'\r\n]+)["']?\s*$/mu);
  if (!match) throw new Error(`No model field in ${file}`);
  return match[1].trim();
}

export function isPlaceholderModel(value) {
  return !value || value.startsWith("__") || value.endsWith("__");
}

export function emptyRoleSetting() {
  return {
    version: 1,
    seniorModelId: null,
    juniorModelId: null,
    updatedAt: null,
    catalogSource: null,
    catalog: []
  };
}

export function parseRoleSetting(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  if (value.version != null && value.version !== 1) {
    throw new Error(`Unsupported model-roles.json version: ${value.version}`);
  }
  return {
    version: 1,
    seniorModelId: value.seniorModelId ?? null,
    juniorModelId: value.juniorModelId ?? null,
    updatedAt: value.updatedAt ?? null,
    catalogSource: value.catalogSource ?? null,
    catalog: Array.isArray(value.catalog) ? value.catalog : []
  };
}

export function publicCatalog(models = []) {
  return models.map((model) => ({
    id: model.id,
    name: model.name ?? null,
    provider: model.provider ?? null,
    origin: model.origin ?? null
  }));
}

export async function readRoleSetting(pluginRoot, io = { readFile }) {
  try {
    const text = await io.readFile(path.join(pluginRoot, MODEL_ROLES_RELATIVE), "utf8");
    return parseRoleSetting(JSON.parse(text));
  } catch (error) {
    if (error && error.code === "ENOENT") return emptyRoleSetting();
    throw error;
  }
}

export async function readPluginImportedCatalog(pluginRoot, io = { readFile }) {
  try {
    const text = await io.readFile(path.join(pluginRoot, IMPORTED_MODELS_RELATIVE), "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error && error.code === "ENOENT") return { version: 1, source: "copilot-app-imported", models: [] };
    throw error;
  }
}

export async function writeJson(pluginRoot, relative, value, io = { writeFile }) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  await io.writeFile(path.join(pluginRoot, relative), serialized, "utf8");
  return serialized;
}

export function replaceFrontmatterModel(text, modelId, file) {
  if (!/^model:\s*.+$/mu.test(text)) throw new Error(`No model field in ${file}`);
  return text.replace(/^model:\s*.+$/mu, `model: ${yamlQuote(modelId)}`);
}

export async function readAssignedModels(pluginRoot, io = { readFile }) {
  const assigned = {};
  for (const [relative, role] of ROLE_ASSIGNMENTS) {
    const text = await io.readFile(path.join(pluginRoot, relative), "utf8");
    assigned[relative] = { role, model: extractFrontmatterModel(text, relative) };
  }
  return assigned;
}

export async function applyRoleAssignment({
  pluginRoot,
  seniorModelId,
  juniorModelId,
  catalog = [],
  catalogSource = null,
  now = new Date().toISOString(),
  io = { readFile, writeFile }
}) {
  const models = {
    senior: validateModelId("Senior", seniorModelId),
    junior: validateModelId("Junior", juniorModelId)
  };
  const written = [];
  for (const [relative, role] of ROLE_ASSIGNMENTS) {
    const target = path.join(pluginRoot, relative);
    const original = await io.readFile(target, "utf8");
    const updated = replaceFrontmatterModel(original, models[role], relative);
    await io.writeFile(target, updated, "utf8");
    written.push({ relative, role, model: models[role] });
  }

  const setting = {
    version: 1,
    seniorModelId: models.senior,
    juniorModelId: models.junior,
    updatedAt: now,
    catalogSource,
    catalog: publicCatalog(catalog)
  };
  await writeJson(pluginRoot, MODEL_ROLES_RELATIVE, setting, io);
  return { models, written, setting };
}

export function checkRoleAssignment({ setting, assigned, catalog = [], allowPlaceholders = false }) {
  const problems = [];
  const catalogIds = new Set((catalog.length ? catalog : setting.catalog || []).map((model) => model.id));
  const senior = setting.seniorModelId;
  const junior = setting.juniorModelId;

  if (allowPlaceholders && isPlaceholderModel(senior) && isPlaceholderModel(junior)) {
    for (const [relative, info] of Object.entries(assigned)) {
      if (!isPlaceholderModel(info.model)) {
        problems.push(`${relative}: expected a placeholder model while roles are unassigned`);
      }
    }
    return { configured: false, problems };
  }

  if (isPlaceholderModel(senior) || isPlaceholderModel(junior)) {
    problems.push("model-roles.json does not assign both Senior and Junior");
  }
  if (catalogIds.size > 0 && senior && !catalogIds.has(senior)) {
    problems.push(`Senior '${senior}' is not in the Copilot-imported catalog`);
  }
  if (catalogIds.size > 0 && junior && !catalogIds.has(junior)) {
    problems.push(`Junior '${junior}' is not in the Copilot-imported catalog`);
  }

  for (const [relative, info] of Object.entries(assigned)) {
    const expected = info.role === "senior" ? senior : junior;
    if (isPlaceholderModel(info.model)) {
      problems.push(`${relative}: model ID is not configured`);
      continue;
    }
    if (expected && info.model !== expected) {
      problems.push(`${relative}: agent model ${info.model} does not match ${info.role} setting ${expected}`);
    }
  }

  return { configured: problems.length === 0, problems };
}
