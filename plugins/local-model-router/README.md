# local-model-router plugin

Audit-first Copilot plugin для исследования локальной маршрутизации Senior → Junior.

## Компоненты

- `agents/` — один Senior-orchestrator и три Junior-роли;
- `skills/local-routing-policy/` — консервативная policy делегирования;
- `skills/local-model-roles/` — назначение Senior/Junior из моделей, уже импортированных в Copilot App;
- `commands/set-model-roles.md` — slash-команда той же настройки;
- `hooks.json` — native `preToolUse` matcher `task|Task|Agent|agent|custom-agent`;
- `scripts/task-routing-hook.mjs` — audit/rewrite logic без внешних зависимостей;
- `config/router-policy.json` — детерминированные англо-русские правила;
- `config/model-roles.json` — настройка, какая импортированная модель Senior, какая Junior;
- `config/imported-models.json` — каталог допустимых Copilot-imported моделей;
- `tests/` — unit-тесты hook и role setting;
- `test-fixture/` — маленький репозиторий для сквозной проверки.

## Настройка Senior / Junior

Роли назначаются только моделям, которые уже импортированы в GitHub Copilot App из провайдеров (Settings → Model providers). Plugin не создаёт модели и не выбирает `Auto`.

```bash
node scripts/configure-models.mjs --list
node scripts/configure-models.mjs --senior 'EXACT_S_ID' --junior 'EXACT_J_ID'
node scripts/configure-models.mjs --check
node scripts/validate-package.mjs
npm test
```

`--senior` и `--junior` принимают точный ID из model picker либо 1-based индекс из `--list`. Если Copilot App каталог на диске не найден, экспортируйте ID picker в `config/imported-models.json` или `--catalog`.

Архив намеренно поставляется с `LOCAL_ROUTER_MODE=audit`. Не включайте `rewrite`, пока Copilot App не зафиксирует реальное поле agent selector в `router-events.jsonl`.
