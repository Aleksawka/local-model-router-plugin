# Архитектура прототипа

```mermaid
flowchart TD
    U["Пользователь"] --> S["Copilot App: Qwen Senior"]
    S -->|"прямое решение"| R["Ответ или изменение"]
    S -->|"task/Agent(...)"| H["preToolUse hook"]
    H -->|"сложно или рискованно"| S
    H -->|"bounded task"| J["Junior agent profile"]
    J --> O["oMLX: Qwen Junior"]
    O --> S
```

## Кто принимает какое решение

| Слой | Решение | Что не может сделать |
|---|---|---|
| Copilot App/session | Модель родительского хода | Не применяет наш plugin к встроенному `Auto` до запроса |
| Senior model | Вызвать ли `task` и сформировать subtask | Не гарантирует правильный model ID дочернего агента |
| `preToolUse` hook | Сохранить или заменить selector уже предложенного агента | Не может сам инициировать `task` |
| Agent profile | Закрепить роль, tools и `model:` | Не гарантирует отсутствие Copilot fallback |
| oMLX | Разрешить model ID, загрузить модель, выполнить inference | Не знает смысл задачи и custom-agent policy |

## Начальный алгоритм

Политика детерминирована и консервативна:

1. Security, auth, permissions, secrets, migration, architecture, public API, concurrency, integration/E2E, flaky tests и incidents остаются Senior.
2. `run/check` + unit test/lint/typecheck/build → Junior test runner.
3. `add/write` + unit test → Junior test writer, но только при явном bounded signal.
4. `find/search/inspect` + file/symbol/implementation → Junior explorer.
5. Всё неизвестное остаётся Senior.

Правила лежат в `plugins/local-model-router/config/router-policy.json` и включают английские и русские ключевые фразы.

## Два режима hook

### Audit

Hook возвращает `{}` и ничего не меняет. В лог попадают структура аргументов, hash prompt и принятое rule-based решение. Содержимое prompt не сохраняется.

### Rewrite

Если поле selector известно и задача безопасно соответствует Junior-правилу, hook возвращает копию исходных аргументов в `modifiedArgs` (и `updatedInput` для Claude/App format), меняя только selector. Если аргументы пришли JSON-строкой, `modifiedArgs` сохраняет ту же кодировку. Если Senior уже предложил Junior для рискованной или нераспознанной задачи, hook возвращает deny с причиной.

Если selector не распознан, hook ничего не меняет. Это осознанный fail-open эксперимент; физическую модель всё равно необходимо проверить по oMLX.

## Почему один Junior одновременно

На 48 ГБ обе Q4-модели, KV cache, Metal buffers, Copilot App и macOS делят unified memory. Даже если веса помещаются, две параллельные генерации могут вызвать pressure, swap или eviction. Текущий plugin формулирует ограничение в роли, но ещё не предоставляет глобальный межпроцессный lock. До появления harness пользователь должен запускать один Junior за раз.
