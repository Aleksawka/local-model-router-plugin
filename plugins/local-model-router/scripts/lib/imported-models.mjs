import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MODEL_PARENT_KEYS = new Set([
  "models",
  "data",
  "importedModels",
  "imported_models",
  "customModels",
  "custom_models",
  "availableModels",
  "available_models",
  "providerModels",
  "provider_models",
  "catalog",
  "chatLanguageModels",
  "languageModels",
  "byokModels",
  "byok_models"
]);

const PROVIDER_PARENT_KEYS = new Set([
  "providers",
  "modelProviders",
  "model_providers",
  "customProviders",
  "custom_providers",
  "byokProviders",
  "byok_providers"
]);

const SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "Cache",
  "Code Cache",
  "GPUCache",
  "Crashpad",
  "logs",
  "blob_storage",
  "IndexedDB",
  "Session Storage",
  "Local Storage",
  "Service Worker"
]);

const CATALOG_FILE_HINT = /model|provider|catalog|setting|config|store|byok|custom|copilot/iu;
const SECRET_KEY = /(?:^|_)(?:api[_-]?key|secret|token|password|credential|authorization)s?$/iu;
const AUTO_IDS = new Set(["auto", "copilot-auto"]);

export function isSecretKey(key) {
  return SECRET_KEY.test(String(key));
}

export function stripSecrets(value, depth = 0) {
  if (depth > 20 || value == null) return value;
  if (Array.isArray(value)) return value.map((item) => stripSecrets(item, depth + 1));
  if (typeof value !== "object") return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSecretKey(key)) continue;
    result[key] = stripSecrets(child, depth + 1);
  }
  return result;
}

export function parseJsonDocument(text) {
  const trimmed = String(text ?? "").replace(/^\uFEFF/u, "").trim();
  if (!trimmed) throw new Error("Empty JSON document");
  try {
    return JSON.parse(trimmed);
  } catch {
    return JSON.parse(stripJsonc(trimmed));
  }
}

function stripJsonc(text) {
  let output = "";
  let inString = false;
  let escaped = false;
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      i += 1;
      continue;
    }
    if (char === "\"") {
      inString = true;
      output += char;
      i += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      i += 2;
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    output += char;
    i += 1;
  }
  return output;
}

function stringField(value, keys) {
  for (const key of keys) {
    const candidate = value?.[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function originFromRecord(record, ctx) {
  const source = stringField(record, ["source", "origin", "kind", "type"])?.toLocaleLowerCase("en-US");
  const vendor = stringField(record, ["vendor", "publisher"])?.toLocaleLowerCase("en-US");
  if (record?.imported === true || record?.isImported === true || record?.custom === true || record?.isCustom === true || record?.byok === true) {
    return "imported";
  }
  if (source && /imported|custom|byok|provider|openai-compatible|ollama|lmstudio|foundry/.test(source)) return "imported";
  if (record?.hosted === true || record?.isCustom === false || source === "github-hosted" || source === "github" || vendor === "github") {
    return "hosted";
  }
  if (ctx.importedHint) return "imported";
  if (ctx.hostedHint) return "hosted";
  return "unknown";
}

function asModelRecord(node, ctx) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  const id = stringField(node, ["id", "modelId", "model_id", "model"]);
  if (!id || id.length > 300 || /[\r\n]/u.test(id)) return null;
  if (AUTO_IDS.has(id.toLocaleLowerCase("en-US"))) return null;

  const parentKey = ctx.trail.at(-1);
  const looksListed = MODEL_PARENT_KEYS.has(parentKey);
  const looksModelObject = node.object === "model" || Boolean(stringField(node, ["owned_by", "vendor", "provider", "providerId", "provider_id", "displayName", "display_name", "modelFamily"]));
  if (!looksListed && !looksModelObject) return null;

  const name = stringField(node, ["name", "displayName", "display_name", "title", "label"]);
  const provider = stringField(node, ["provider", "providerName", "provider_name", "vendor", "owned_by"]) || ctx.providerHint;
  return {
    id,
    name: name && name !== id ? name : null,
    provider: provider || null,
    origin: originFromRecord(node, ctx)
  };
}

function providerHintFrom(key, value, current) {
  if (PROVIDER_PARENT_KEYS.has(key) || MODEL_PARENT_KEYS.has(key)) return current;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return stringField(value, ["name", "displayName", "display_name", "id", "provider", "vendor"]) || current;
  }
  return current;
}

function importedHintFrom(key, value, current) {
  if (PROVIDER_PARENT_KEYS.has(key) || /byok|imported|custom/iu.test(key)) return true;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const type = stringField(value, ["type", "kind", "source", "vendor"]);
    if (type && /byok|custom|openai|ollama|lmstudio|foundry|compatible/iu.test(type)) return true;
  }
  return current;
}

export function extractImportedModels(value, options = {}) {
  const includeHosted = options.includeHosted === true;
  const collected = [];
  const seen = new Set();

  function walk(node, ctx) {
    if (node == null) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, ctx);
      return;
    }
    if (typeof node !== "object") return;

    const nestedProvider = (Array.isArray(node.models) || Array.isArray(node.data))
      ? stringField(node, ["name", "displayName", "display_name", "provider", "vendor"])
      : null;
    const localCtx = {
      ...ctx,
      providerHint: nestedProvider || ctx.providerHint,
      importedHint: ctx.importedHint || Boolean(nestedProvider)
    };

    const record = asModelRecord(node, localCtx);
    if (record) {
      if (!includeHosted && record.origin === "hosted") return;
      if (seen.has(record.id)) return;
      seen.add(record.id);
      collected.push(record);
      return;
    }

    for (const [key, child] of Object.entries(node)) {
      if (isSecretKey(key)) continue;
      walk(child, {
        trail: localCtx.trail.concat(key),
        providerHint: providerHintFrom(key, child, localCtx.providerHint),
        importedHint: importedHintFrom(key, child, localCtx.importedHint),
        hostedHint: localCtx.hostedHint || /github[-_]?hosted|copilot[-_]?hosted/iu.test(key)
      });
    }
  }

  walk(stripSecrets(value), {
    trail: [],
    providerHint: options.providerHint ?? null,
    importedHint: options.importedHint === true,
    hostedHint: false
  });
  return collected;
}

export function defaultSearchRoots({ env = process.env, homedir = os.homedir(), platform = process.platform } = {}) {
  const roots = [];
  const push = (value) => {
    if (value && !roots.includes(value)) roots.push(value);
  };

  push(env.COPILOT_APP_DATA);
  push(env.COPILOT_HOME);
  push(path.join(homedir, ".copilot"));

  if (platform === "darwin") {
    push(path.join(homedir, "Library/Application Support/GitHub Copilot"));
    push(path.join(homedir, "Library/Application Support/GitHub Copilot App"));
    push(path.join(homedir, "Library/Application Support/com.github.GitHubCopilot"));
    push(path.join(homedir, "Library/Application Support/github-copilot"));
  } else if (platform === "win32") {
    const appData = env.APPDATA || path.join(homedir, "AppData/Roaming");
    push(path.join(appData, "GitHub Copilot"));
    push(path.join(appData, "GitHub Copilot App"));
    push(path.join(appData, "github-copilot"));
  } else {
    const xdg = env.XDG_CONFIG_HOME || path.join(homedir, ".config");
    push(path.join(xdg, "GitHub Copilot"));
    push(path.join(xdg, "GitHub Copilot App"));
    push(path.join(xdg, "github-copilot"));
  }

  return roots;
}

export function isCandidateCatalogFile(name) {
  return /\.jsonc?$/iu.test(name) && CATALOG_FILE_HINT.test(name);
}

export async function listCatalogFiles(root, { maxDepth = 4, maxFiles = 40 } = {}) {
  const files = [];

  async function visit(dir, depth) {
    if (files.length >= maxFiles || depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      if (SKIP_DIR_NAMES.has(entry.name) || entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(fullPath, depth + 1);
      else if (entry.isFile() && isCandidateCatalogFile(entry.name)) files.push(fullPath);
    }
  }

  await visit(root, 0);
  return files;
}

async function readCatalogFile(file, maxBytes) {
  const info = await stat(file);
  if (!info.isFile() || info.size > maxBytes) return [];
  const text = await readFile(file, "utf8");
  return extractImportedModels(parseJsonDocument(text), { importedHint: /provider|imported|byok|custom/iu.test(path.basename(file)) });
}

export async function discoverImportedModels({
  catalogFiles = [],
  searchRoots = [],
  maxBytes = 2_000_000,
  maxDepth = 4,
  maxFiles = 40,
  includeHosted = false
} = {}) {
  const sources = [];
  const models = [];
  const seen = new Set();

  async function addFrom(label, read) {
    try {
      const found = await read();
      if (!found.length) return;
      sources.push(label);
      for (const model of found) {
        if (!includeHosted && model.origin === "hosted") continue;
        if (seen.has(model.id)) continue;
        seen.add(model.id);
        models.push(model);
      }
    } catch {
      // Catalog discovery is best-effort; assignment still fail-closes on an empty set.
    }
  }

  for (const file of catalogFiles) {
    await addFrom(`catalog-file:${path.basename(file)}`, () => readCatalogFile(file, maxBytes));
  }

  for (const root of searchRoots) {
    let files;
    try {
      files = await listCatalogFiles(root, { maxDepth, maxFiles });
    } catch {
      continue;
    }
    for (const file of files) {
      await addFrom(`copilot-app-data:${path.basename(file)}`, () => readCatalogFile(file, maxBytes));
    }
  }

  return { models, catalogSource: sources.length ? sources.join(",") : null };
}

export function formatModelList(models) {
  return models.map((model, index) => {
    const details = [model.provider, model.name].filter(Boolean).join(" — ");
    return `${String(index + 1).padStart(2, " ")}. ${model.id}${details ? `  (${details})` : ""}`;
  }).join("\n");
}

export function resolveRoleSelection(value, models, label) {
  if (value == null || value === "") throw new Error(`Missing ${label} selection`);
  const raw = String(value).trim();
  const exact = models.find((model) => model.id === raw);
  if (exact) return exact.id;
  if (/^\d+$/u.test(raw)) {
    const index = Number(raw) - 1;
    if (index >= 0 && index < models.length) return models[index].id;
  }
  throw new Error(`${label} '${raw}' is not one of the discovered Copilot-imported models`);
}

export function assertInCatalog(modelId, models, label, allowUnlisted) {
  if (allowUnlisted) return;
  if (models.some((model) => model.id === modelId)) return;
  throw new Error(`${label} '${modelId}' is not in the Copilot-imported model catalog. Use --list, pass --catalog, or --allow-unlisted only after confirming the ID in the Copilot App picker.`);
}
