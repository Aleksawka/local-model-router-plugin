# Changelog

## 0.2.0 — 2026-09-22

- Настройка ролей: какая из уже импортированных в GitHub Copilot App моделей используется как Senior, а какая как Junior.
- Каталог допустимых моделей (`config/imported-models.json`) отделён от назначения ролей (`config/model-roles.json`).
- `configure-models.mjs` обнаруживает Copilot-imported модели, принимает точный ID или индекс из `--list` и отказывается от ID вне каталога.
- Slash-команда `/set-model-roles` и skill `local-model-roles`.
- Unit-тесты назначения ролей и извлечения каталога.

## 0.1.1 — 2026-09-02

- Align `preToolUse` with the current Copilot hooks reference: match `task`, `Task`, `Agent`, and `custom-agent`, not only `task`.
- Parse both camelCase `toolArgs`/`tool_args` and VS Code/Claude `tool_input` payloads, including JSON-string `toolArgs`.
- Always return `modifiedArgs` as an object, even when inbound `toolArgs` was a JSON string.
- For Claude/VS Code `PreToolUse` payloads, wrap `updatedInput` and deny decisions in `hookSpecificOutput`.
- Add a Windows `powershell` hook command and resolve plugin root from `COPILOT_PLUGIN_ROOT`, `PLUGIN_ROOT`, or `CLAUDE_PLUGIN_ROOT`.
- Prefer `COPILOT_PLUGIN_DATA`, then `CLAUDE_PLUGIN_DATA`, for audit logs.

## 0.1.0 — 2026-08-31

- Локальный Copilot marketplace для пересылки.
- Четыре custom agent profile с настраиваемыми model ID.
- Audit-first `preToolUse(task)` hook.
- Отключённый по умолчанию экспериментальный `modifiedArgs` rewrite.
- Консервативная англо-русская routing policy.
- Unit и end-to-end test plan для Copilot App, oMLX и 48 ГБ.
