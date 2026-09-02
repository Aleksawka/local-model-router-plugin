# Результаты исследования

Дата проверки: 2 сентября 2026 года.

## Что подтверждено документацией

| Возможность | Статус |
|---|---|
| Copilot plugin может включать custom agents, skills, hooks и MCP | Подтверждено |
| `preToolUse` с matcher на runtime `task` и Claude/App `Agent` видит уже подготовленный вызов саб-агента | Подтверждено для Copilot hook runtime |
| Command hook может вернуть `modifiedArgs` (object) и, для Claude-format, `updatedInput` | Подтверждено |
| camelCase `toolArgs` может прийти объектом или JSON-строкой; PascalCase использует `tool_input` | Подтверждено |
| `subagentStart` может заново выбрать агента или модель | Нет, событие происходит слишком поздно |
| Command hook может сам создать делегирование | Нет |
| `userPromptTransformed` выбирает модель | Нет, он меняет model-facing prompt |
| Agent-профиль поддерживает `model:` | Подтверждено |
| При parent `Auto` pinned model саб-агента сохраняется | Нет, саб-агент наследует resolved Auto model |
| Неизвестный agent model ID обязательно вызывает явную ошибку | Нет, возможен silent fallback к модели сеанса |
| ZIP устанавливается напрямую через App UI | Нет |
| App UI может установить plugin из custom Git marketplace | Подтверждено |

## Что остаётся гипотезой и проверяется пакетом

1. Bundled `preToolUse` hook действительно запускается внутри текущей Copilot App, а не только CLI/cloud runtime.
2. App передаёт selector custom agent в `toolArgs` / `tool_input` в форме, которую можно безопасно изменить.
3. `modifiedArgs` (и при необходимости `updatedInput`) приводит к запуску другого custom agent внутри App.
4. Новый профиль использует закреплённый локальный model ID, не откатываясь к Senior.
5. Простые детерминированные правила дают приемлемую точность на реальных задачах.

Именно поэтому версия `0.1.1` по-прежнему запускается в audit mode. Официальный тип `toolArgs` — `unknown`; CLI changelog подтверждает `task(agent_type=...)`, но App может отдать `Agent` + `tool_input` + `subagent_type`. Жёстко предполагать одну форму до наблюдения нельзя.

## Почему это не замена Copilot Auto

Есть три разных точки решения:

1. Copilot `Auto` выбирает модель родительского хода до отправки запроса провайдеру.
2. Senior внутри своего ответа решает, создавать ли `task`.
3. Plugin hook может изменить профиль только уже созданного `task`.

Gateway за Copilot видит API-запрос позднее и обычно не знает семантику custom agent. Поэтому наиболее контролируемая первая реализация — отдельные agent-профили с точными `model:` и hook, меняющий их selector.

## Версии-кандидаты

На дату проверки:

- Copilot CLI `1.0.82` — стабильная;
- `1.0.83-3` — актуальный prerelease на дату проверки;
- plugin dashboard стал общедоступным в `1.0.81`;
- `${COPILOT_PLUGIN_ROOT}`, `${PLUGIN_ROOT}` и `${CLAUDE_PLUGIN_ROOT}` доступны в актуальных версиях;
- camelCase matcher — regex по runtime tool name; PascalCase/Open Plugin Spec matcher принимает Claude-имена (`Agent` для `task`);
- исправление `modifiedArgs` появилось значительно раньше текущей стабильной ветки.

Проверять прототип следует сначала на стабильной сборке. Prerelease имеет смысл только при воспроизводимой ошибке, исправленной именно там.

## Следующий этап после доказательства гипотезы

Версия `0.2` может добавить отдельный daemon или MCP/harness для:

- глобального ограничения `max_active_junior=1` между сессиями App;
- учёта memory pressure, swap и oMLX active requests;
- очереди и отмены;
- обучаемого или статистического классификатора вместо keyword policy;
- измерения качества маршрута;
- нескольких Senior/Junior профилей.

Эти функции намеренно не заявлены как реализованные в текущем архиве.
