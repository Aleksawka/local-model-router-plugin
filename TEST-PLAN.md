# План проверки Local Model Router

Тесты разделены на документированное поведение и экспериментальную гипотезу App hook. Не переходите к mutation, пока не пройдены baseline и audit.

## Доказательства, которые нужно собирать

Перед началом запишите:

- версию Copilot App и вывод `copilot --version`;
- версию oMLX из `/api/status`;
- точные Senior ID (`S`) и Junior ID (`J`) из `/v1/models`;
- checksum ZIP и установленного plugin;
- состояние `/v1/models/status` и `/api/status`;
- memory pressure и swap до теста.

В каждый prompt добавляйте уникальный `TEST-ID`. Для oMLX используйте DEBUG, не TRACE. Журнал находится в первом существующем пути:

```text
~/.omlx/logs/server.log
~/Library/Application Support/oMLX/logs/server.log
```

Полезный фильтр:

```bash
tail -F "$OMLX_LOG" \
  | rg 'Chat completion request received: model=|Chat completion: model=|falling back to default'
```

Доказательством физической модели является строка `Chat completion: model=<resolved physical id>`. UI, имя агента и echoed request model недостаточны.

В tool loop могут быть дополнительные ходы, поэтому проверяйте смысловую подпоследовательность, а не точное количество API-запросов:

| Сценарий | Ожидаемый trace |
|---|---|
| Прямой Junior | `J` |
| Успешная делегация | `S … J … S` |
| Сложная задача остаётся Senior | нет `J` между началом и завершением теста |
| Silent fallback невалидного Junior ID | ребёнок фактически вызывает `S`; тест обязан отметить mismatch |

## T00 — целостность архива

```bash
shasum -a 256 copilot-local-model-router-distribution-0.1.0.zip
cd copilot-local-model-router-distribution/plugins/local-model-router
node scripts/validate-package.mjs --allow-placeholders
npm test
```

После подстановки ID повторите без `--allow-placeholders`.

Pass:

- JSON и структура валидны;
- архив по умолчанию в audit mode;
- семь unit-тестов hook прошли;
- Junior-профили не имеют tool `agent`.

## T01 — установка и обнаружение в App

1. Установите local marketplace по инструкции.
2. Полностью перезапустите App.
3. Проверьте `Customize → Plugins`, `/plugin`, `/agent`, `/skills list`.
4. Ещё раз полностью перезапустите App и повторите проверку.

Pass: plugin сохраняется после второго перезапуска; видны четыре уникальных `local-router-*` agent и skill.

Если CLI видит plugin, а App нет, filesystem marketplace не совместим с этой сборкой App. Это отдельный результат; разместите marketplace в Git и установите его через UI.

## T02 — baseline двух моделей

1. Выполните по одному прямому `/v1/chat/completions` запросу к `S` и `J`.
2. Выполните запрос к `__must_not_exist__`.
3. Проверьте `/v1/models/status` и журнал.

Pass:

- `S` и `J` дают 2xx и точный resolved model;
- неизвестный ID даёт 404/no generation;
- `model_fallback=false`;
- нет 409, 507, 5xx, OOM или eviction.

## T03 — вручную закреплённый Junior

В App вручную выберите `local-router-junior-explorer` и отправьте:

```text
TEST-ID T03-PIN-TOP. Return only STATUS: DONE and JUNIOR_OK. Do not call tools.
```

Pass: в интервале теста физически вызван `J`, не `S`.

## T04 — явная делегация Senior → Junior

Создайте новую сессию с явным `S`, не `Auto`. Попросите Senior ровно один раз вызвать `local-router-junior-explorer`:

```text
TEST-ID T04-PIN-CHILD. Invoke local-router-junior-explorer exactly once.
Ask it to find the parsePort implementation and return file evidence only.
Then review its answer and return CHILD_REVIEWED.
```

Повторите десять раз в новых коротких сессиях.

Pass: 10/10 трасс содержат `S … J … S`; timeline называет нужный plugin-agent; fallback отсутствует.

## T05 — обязательный негативный контроль silent fallback

На копии plugin временно замените Junior `model:` на `__not_a_real_model__`, переустановите plugin и перезапустите App. Повторите T04.

Ожидается, что Copilot может подменить неразрешимый agent model на session model до обращения к oMLX. Тогда oMLX увидит валидный `S`, а не ошибочный ID.

Pass этого негативного теста: проверяющая процедура помечает результат `MODEL_MISMATCH`, даже если текстовый ответ выглядит правдоподобно. После теста восстановите точный `J` и снова добейтесь `S … J … S`.

## T06 — негативный контроль Auto

Создайте отдельную parent-сессию на `Auto` и вызовите pinned Junior-agent.

Ожидаемый результат: child наследует resolved Auto model, а `model:` профиля не даёт гарантии `J`.

Pass: тест отмечен как ожидаемое ограничение и доказывает, почему рабочий сценарий фиксирует parent на `S`.

## T07 — hook audit в Copilot App

Убедитесь, что `LOCAL_ROUTER_MODE=audit`. В parent-сессии `S` создайте один custom-agent task. Найдите последнюю запись `router-events.jsonl`.

Pass:

- запись имеет `toolName: task`;
- `argKeys` соответствует реальному payload;
- `agentField` не `null` и указывает на фактический selector;
- `action: observe`;
- prompt в журнале отсутствует, присутствуют только его длина и SHA-256;
- поведение task не изменилось.

Если запись не появляется, hook path/runtime App не подтверждён. Остановитесь на обычных pinned agents; rewrite не включать.

## T08 — экспериментальный `modifiedArgs`

Только после T07 переключите hook в `rewrite`, переустановите plugin и создайте новую сессию. Попросите `S` делегировать generic agent следующую bounded-задачу:

```text
TEST-ID T08-REWRITE. Delegate one task: run the unit test file
test/parse-port.test.js. Do not edit files. Return command, exit code, and evidence.
```

Pass требует совпадения трёх источников:

1. Audit: `route=junior-test-runner`, `action=rewrite-agent`.
2. Copilot timeline: `local-router-junior-test-runner`.
3. oMLX: `S … J … S`.

Несовпадение хотя бы одного источника — fail.

## T09 — три правила маршрутизации

На копии `test-fixture/port-parser` выполните три независимых prompt:

### Read-only explorer

```text
TEST-ID T09-A. Delegate one bounded task: find the parsePort implementation,
list its validation branches and return file evidence. No edits and no commands.
```

Ожидается Junior explorer и `S … J … S`.

### Test runner

```text
TEST-ID T09-B. Delegate one bounded task: run only
node --test test/parse-port.test.js. Do not edit files. Return command and exit code.
```

Ожидается Junior test runner и `S … J … S`.

### Test writer

```text
TEST-ID T09-C. Delegate one bounded task. Add cases for 0 and 65536.
Allowed file: test/parse-port.test.js only. Production code is forbidden.
Validation command: node --test test/parse-port.test.js.
Return changed files, cases, command, exit code, or ESCALATE.
```

Ожидается Junior test writer; изменён только test-файл; тесты проходят; Senior проверяет diff.

## T10 — сложная задача остаётся Senior

```text
TEST-ID T10-SENIOR. Determine correct concurrent token-refresh semantics,
redesign authentication and authorization boundaries, and update integration tests.
```

Pass: между началом и завершением нет физического `J`; рискованный Junior-вызов hook отклоняет с понятной причиной.

## T11 — границы tools и escalation

Проверьте отдельно:

- Explorer не может редактировать или выполнять команды.
- Test runner не может редактировать.
- Test writer не имеет tool `agent` и меняет только разрешённый test-файл.
- Если passing test требует production change, Junior возвращает `STATUS: ESCALATE` без такого изменения.
- Senior не делает второй бесконечный retry Junior, а сам принимает решение.

Pass: ни одного production edit от Junior и ни одной рекурсивной делегации.

## T12 — 48 ГБ, память и endurance

До и после каждого запуска сохраните `/api/status`, `/v1/models/status`, Activity Monitor memory pressure и swap. Сначала держите обе модели warm и запускайте одного Junior.

Проектные пороги:

- PASS: swap delta не более 512 МиБ и не растёт после завершения;
- WARN: 512 МиБ–1 ГиБ;
- FAIL: больше 1 ГиБ либо устойчивый рост, yellow/red pressure, eviction, OOM, 409/507/5xx;
- одновременно активен максимум один Junior.

Затем выполните фиксированный набор из 20 задач:

- 10 bounded Junior-кандидатов;
- 6 сложных/security задач;
- 2 сценария ручного отказа из-за недостаточного headroom;
- 1 escalation;
- 1 invalid-ID negative control.

Release gate:

| Метрика | Требование |
|---|---:|
| Валидная явная Junior-делегация | 100% с физическим `J` |
| Необнаруженный silent fallback | 0 |
| Рискованная задача → Junior | 0 |
| Production edit от Junior | 0 |
| Рекурсивный агент | 0 |
| oMLX OOM/5xx/eviction | 0 |
| Максимум активных Junior | 1 |

Headroom и глобальный lock в версии `0.1.0` ещё не автоматизированы. Эти два сценария выполняются ручным запретом; автоматизация является отдельным этапом harness/daemon.

## T13 — доказательство границы hook

Дайте Senior простую задачу, но явно попросите выполнить её без саб-агента. Отсутствие `task` означает отсутствие `preToolUse` и отсутствие Junior.

Это ожидаемый результат, не баг. Он доказывает, что plugin меняет уже созданное делегирование, но не создаёт его сам.
