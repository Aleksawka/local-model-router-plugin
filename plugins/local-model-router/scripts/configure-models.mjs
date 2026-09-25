#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { stdin as stdinStream, stdout as stdoutStream } from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  applyRoleAssignment,
  checkRoleAssignment,
  IMPORTED_MODELS_RELATIVE,
  isPlaceholderModel,
  publicCatalog,
  readAssignedModels,
  readPluginImportedCatalog,
  readRoleSetting,
  validateModelId,
  writeJson
} from "./lib/model-roles.mjs";
import {
  assertInCatalog,
  defaultSearchRoots,
  discoverImportedModels,
  endpointCatalogModels,
  extractImportedModels,
  formatModelList,
  parseJsonDocument,
  resolveRoleSelection
} from "./lib/imported-models.mjs";

const pluginRoot = process.env.LOCAL_ROUTER_PLUGIN_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  console.log(`Usage:
  node scripts/configure-models.mjs --list
  node scripts/configure-models.mjs --senior <id-or-index> --junior <id-or-index>
  node scripts/configure-models.mjs --check

The setting assigns Copilot-imported provider models to Senior and Junior roles.
It does not create models. Choose IDs that already appear in the GitHub Copilot App
model picker after Settings → Model providers.

Options:
  --list                 Show discovered Copilot-imported models
  --check                Verify model-roles.json matches agent frontmatter
  --senior <id|index>    Exact Copilot model ID, or 1-based --list index
  --junior <id|index>    Exact Copilot model ID, or 1-based --list index
  --catalog <file>       JSON catalog exported from Copilot App / picker
  --from-endpoint <url>  Provider /v1/models URL. Only origin=imported entries are used unless --allow-unlisted
  --save-catalog         Write the discovered catalog to config/imported-models.json
  --allow-unlisted       Allow IDs that discovery did not find
  --include-hosted       Include GitHub-hosted models in the candidate list

Environment:
  QWEN_SENIOR_MODEL_ID
  QWEN_JUNIOR_MODEL_ID
  COPILOT_IMPORTED_MODELS_FILE
  COPILOT_APP_DATA
  COPILOT_HOME
  LOCAL_ROUTER_PLUGIN_ROOT`);
}

function parseArgs(argv) {
  const result = {
    check: false,
    list: false,
    saveCatalog: false,
    allowUnlisted: false,
    includeHosted: false,
    senior: null,
    junior: null,
    catalogFiles: [],
    userCatalog: false,
    fromEndpoint: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    const next = () => argv[++i];
    if (value === "--check") result.check = true;
    else if (value === "--list") result.list = true;
    else if (value === "--save-catalog") result.saveCatalog = true;
    else if (value === "--allow-unlisted") result.allowUnlisted = true;
    else if (value === "--include-hosted") result.includeHosted = true;
    else if (value === "--senior") result.senior = next();
    else if (value === "--junior") result.junior = next();
    else if (value === "--catalog") {
      result.catalogFiles.push(next());
      result.userCatalog = true;
    }
    else if (value === "--from-endpoint") result.fromEndpoint = next();
    else if (value === "--help" || value === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!result.check && !result.list) {
    result.senior ??= process.env.QWEN_SENIOR_MODEL_ID;
    result.junior ??= process.env.QWEN_JUNIOR_MODEL_ID;
  }
  if (process.env.COPILOT_IMPORTED_MODELS_FILE) {
    result.catalogFiles.push(process.env.COPILOT_IMPORTED_MODELS_FILE);
  }
  return result;
}

function catalogWithConfirmedIds(models, seniorId, juniorId) {
  const next = models.map((model) => ({ ...model }));
  for (const id of [seniorId, juniorId]) {
    if (next.some((model) => model.id === id)) continue;
    next.push({ id, name: null, provider: null, origin: "unlisted" });
  }
  return next;
}

function resolveConfiguredRole(value, models, label, allowUnlisted) {
  const raw = String(value ?? "").trim();
  if (allowUnlisted && !/^\d+$/u.test(raw)) return validateModelId(label, raw);
  if (models.length) return resolveRoleSelection(value, models, label);
  return validateModelId(label, value);
}

async function loadEndpointCatalog(url) {
  if (!url) return [];
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid --from-endpoint URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("--from-endpoint only accepts http(s) URLs");
  }
  const response = await fetch(parsed, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Provider catalog request failed: ${response.status}`);
  return extractImportedModels(await response.json(), { providerHint: parsed.host });
}

async function loadCatalog(args) {
  const pluginCatalog = await readPluginImportedCatalog(pluginRoot);
  const pluginCatalogFile = path.join(pluginRoot, IMPORTED_MODELS_RELATIVE);
  const discovered = await discoverImportedModels({
    catalogFiles: [pluginCatalogFile],
    explicitCatalogFiles: args.catalogFiles,
    searchRoots: defaultSearchRoots(),
    includeHosted: args.includeHosted
  });
  const endpointModels = endpointCatalogModels(await loadEndpointCatalog(args.fromEndpoint), {
    allowUnlisted: args.allowUnlisted,
    includeHosted: args.includeHosted
  });
  const explicitModels = endpointCatalogModels(discovered.explicitModels, {
    allowUnlisted: args.allowUnlisted,
    includeHosted: args.includeHosted
  });
  const models = [];
  const seen = new Set();
  const sources = [];
  if (discovered.catalogSource) sources.push(discovered.catalogSource);
  if (endpointModels.length) sources.push("provider-endpoint");

  for (const model of [...extractImportedModels(pluginCatalog, { importedHint: true }), ...discovered.models, ...explicitModels, ...endpointModels]) {
    if (!args.includeHosted && model.origin === "hosted") continue;
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }

  return {
    models,
    catalogSource: sources.length ? sources.join(",") : (pluginCatalog.models?.length ? "plugin-config" : null)
  };
}

async function promptMissingRoles(args, models) {
  if (args.senior && args.junior) return args;
  if (!stdinStream.isTTY || !stdoutStream.isTTY) {
    throw new Error("Senior and Junior must be selected from the Copilot-imported catalog");
  }
  if (!models.length) {
    throw new Error("No Copilot-imported models discovered. Pass --catalog or --from-endpoint after importing a provider in Copilot App.");
  }
  console.log("Copilot-imported models:\n");
  console.log(formatModelList(models));
  const rl = createInterface({ input: stdinStream, output: stdoutStream });
  try {
    const senior = args.senior || await rl.question("\nSenior model ID or list index: ");
    const junior = args.junior || await rl.question("Junior model ID or list index: ");
    return { ...args, senior, junior };
  } finally {
    rl.close();
  }
}

async function maybeSaveCatalog(args, catalog) {
  if (!args.saveCatalog) return;
  await writeJson(pluginRoot, IMPORTED_MODELS_RELATIVE, {
    version: 1,
    source: "copilot-app-imported",
    catalogSource: catalog.catalogSource,
    models: publicCatalog(catalog.models)
  });
  console.log(`Saved ${catalog.models.length} imported models to ${IMPORTED_MODELS_RELATIVE}`);
}

async function runCheck() {
  const setting = await readRoleSetting(pluginRoot);
  const assigned = await readAssignedModels(pluginRoot);
  const pluginCatalog = await readPluginImportedCatalog(pluginRoot);
  const catalog = setting.catalog?.length ? setting.catalog : pluginCatalog.models;
  const result = checkRoleAssignment({
    setting,
    assigned,
    catalog,
    allowPlaceholders: isPlaceholderModel(setting.seniorModelId) && isPlaceholderModel(setting.juniorModelId)
  });
  console.log(`SETTING\tsenior=${setting.seniorModelId ?? "UNASSIGNED"}\tjunior=${setting.juniorModelId ?? "UNASSIGNED"}`);
  for (const [relative, info] of Object.entries(assigned)) {
    const configured = !isPlaceholderModel(info.model);
    console.log(`${configured ? "OK" : "NOT_CONFIGURED"}\t${relative}\t${info.role}\t${info.model}`);
  }
  if (!result.configured) {
    for (const problem of result.problems) console.error(problem);
    process.exitCode = 2;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  if (args.check) {
    if (args.list || args.senior || args.junior || args.saveCatalog || args.userCatalog || args.fromEndpoint || args.allowUnlisted || args.includeHosted) {
      throw new Error("--check only verifies the saved setting. Run --list or assignment as a separate command.");
    }
    await runCheck();
    return;
  }

  const catalog = await loadCatalog(args);

  if (args.list) {
    if (!catalog.models.length) {
      console.log("No Copilot-imported models discovered.");
      console.log("Import a provider in GitHub Copilot App (Settings → Model providers),");
      console.log("export those picker IDs into config/imported-models.json or --catalog, then retry.");
      process.exitCode = 2;
    } else {
      console.log(`Found ${catalog.models.length} Copilot-imported model(s)${catalog.catalogSource ? ` from ${catalog.catalogSource}` : ""}:\n`);
      console.log(formatModelList(catalog.models));
    }
    await maybeSaveCatalog(args, catalog);
    if (!args.senior && !args.junior && !args.check) return;
  }

  const selected = await promptMissingRoles(args, catalog.models);
  const seniorId = resolveConfiguredRole(selected.senior, catalog.models, "Senior", args.allowUnlisted);
  const juniorId = resolveConfiguredRole(selected.junior, catalog.models, "Junior", args.allowUnlisted);

  if (!catalog.models.length && !args.allowUnlisted) {
    throw new Error("No Copilot-imported catalog is available. Discover models with --list, pass --catalog, or confirm picker IDs with --allow-unlisted.");
  }
  assertInCatalog(seniorId, catalog.models, "Senior", args.allowUnlisted);
  assertInCatalog(juniorId, catalog.models, "Junior", args.allowUnlisted);

  if (seniorId === juniorId) {
    console.log("Warning: Senior and Junior point at the same imported model.");
  }

  const result = await applyRoleAssignment({
    pluginRoot,
    seniorModelId: seniorId,
    juniorModelId: juniorId,
    catalog: catalogWithConfirmedIds(catalog.models, seniorId, juniorId),
    catalogSource: catalog.catalogSource
  });
  await maybeSaveCatalog(args, catalog);

  console.log(`SETTING\tsenior=${result.models.senior}\tjunior=${result.models.junior}`);
  for (const row of result.written) {
    console.log(`Configured ${row.relative} -> ${row.model}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  usage();
  process.exitCode = 1;
});
