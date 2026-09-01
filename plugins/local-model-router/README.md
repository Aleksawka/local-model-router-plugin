# local-model-router plugin

Audit-first Copilot plugin для исследования локальной маршрутизации Qwen Senior → Qwen Junior.

## Компоненты

- `agents/` — один Senior-orchestrator и три Junior-роли;
- `skills/local-routing-policy/` — консервативная policy делегирования;
- `hooks.json` — native `preToolUse` matcher `task`;
- `scripts/task-routing-hook.mjs` — audit/rewrite logic без внешних зависимостей;
- `config/router-policy.json` — детерминированные англо-русские правила;
- `tests/` — unit-тесты hook;
- `test-fixture/` — маленький репозиторий для сквозной проверки.

## Быстрая локальная проверка

```bash
node scripts/configure-models.mjs --senior 'EXACT_S_ID' --junior 'EXACT_J_ID'
node scripts/configure-models.mjs --check
node scripts/validate-package.mjs
npm test
```

Архив намеренно поставляется с `LOCAL_ROUTER_MODE=audit`. Не включайте `rewrite`, пока Copilot App не зафиксирует реальное поле agent selector в `router-events.jsonl`.
