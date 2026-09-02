# Первичные источники

Проверено 2 сентября 2026 года.

- [Creating Copilot CLI plugins](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating) — структура plugin, локальная установка, кеширование.
- [Copilot CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference) — manifest, marketplace, пути компонентов, Open Plugin Spec и install sources.
- [Creating a plugin marketplace](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-marketplace) — `.github/plugin/marketplace.json` и local/Git marketplace.
- [About GitHub Copilot plugins](https://docs.github.com/en/copilot/concepts/agents/about-plugins) — plugins в CLI, cloud agent и GitHub Copilot App.
- [Customizing GitHub Copilot App](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app) — Plugins UI и custom marketplace.
- [Copilot hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference) — события, matcher, JSON stdin/stdout, `modifiedArgs`, Claude-format `Agent`/`tool_input`, failure semantics.
- [Copilot hooks tutorial](https://docs.github.com/en/copilot/tutorials/copilot-cli-hooks) — практическая диагностика hooks; camelCase `toolArgs` как JSON-строка.
- [Custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration) — agent frontmatter, `model`, `tools`, invocation settings.
- [Copilot CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) — model precedence, Auto и subagent behavior.
- [Copilot CLI releases](https://github.com/github/copilot-cli/releases) и [changelog](https://github.com/github/copilot-cli/blob/main/changelog.md) — версии и изменения runtime.
- [oMLX repository](https://github.com/jundot/omlx) — OpenAI-compatible API, multi-model serving, logs, status и memory behavior.
