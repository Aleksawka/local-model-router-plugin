---
name: local-model-roles
description: Assign which Copilot-imported provider model is Senior and which is Junior for local-model-router agent profiles.
---

# Local model role assignment

Use this skill to configure `local-model-router` so one model already imported into GitHub Copilot App is Senior and another is Junior.

## Distinctions

- A Copilot-imported model is an identity already present in the App model picker after Settings → Model providers.
- Senior and Junior are roles assigned to those models, not new models.
- Agent profiles consume the assignment through their `model:` frontmatter. Copilot `Auto` is not an admissible role holder.

## Procedure

1. Discover the catalog:

```bash
node scripts/configure-models.mjs --list
```

2. Choose two IDs from that list. Indexes from `--list` are accepted.
3. Write the setting and agent pins:

```bash
node scripts/configure-models.mjs --senior '<id-or-index>' --junior '<id-or-index>'
node scripts/configure-models.mjs --check
```

4. Reinstall or reload the plugin and start a new Copilot App session.

If discovery cannot see the App catalog, export picker IDs into `config/imported-models.json` or `--catalog`. Do not pass an oMLX-only ID unless the same ID is visible in the Copilot App picker.
