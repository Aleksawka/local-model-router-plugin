---
description: Assign Copilot-imported provider models to Senior and Junior router roles
---

Configure `local-model-router` role assignment. Do not invent models and do not use Copilot `Auto`.

Senior and Junior are roles. The models already imported into GitHub Copilot App from Settings → Model providers are the only admissible candidates.

Steps:

1. Inspect models that already appear in this Copilot App session model picker from imported providers.
2. From the plugin root, list the catalog the plugin can see:

```bash
node "${COPILOT_PLUGIN_ROOT}/scripts/configure-models.mjs" --list
```

3. Ask the user which imported model is Senior and which is Junior. Use the exact picker/API IDs, not display names, unless they are identical.
4. Apply the setting:

```bash
node "${COPILOT_PLUGIN_ROOT}/scripts/configure-models.mjs" \
  --senior 'EXACT_SENIOR_ID' \
  --junior 'EXACT_JUNIOR_ID'
node "${COPILOT_PLUGIN_ROOT}/scripts/configure-models.mjs" --check
```

If `--list` is empty, ask the user to paste the exact IDs from the Copilot App picker into `config/imported-models.json` or a `--catalog` file, then retry. Use `--allow-unlisted` only after the user confirms those IDs already exist in the App picker.

5. Tell the user to reinstall or reload the plugin and start a new App session so agent `model:` pins take effect.
