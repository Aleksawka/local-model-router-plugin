# Установка в GitHub Copilot App

## 1. Предварительные условия

Потребуются:

- macOS и локальная сессия GitHub Copilot App;
- Copilot CLI, доступный командой `copilot`;
- Node.js 20 или новее;
- работающий oMLX с двумя моделями;
- OpenAI-compatible provider в Copilot App, уже направленный на oMLX;
- модели этого провайдера, уже импортированные в Copilot App и видимые в model picker;
- решение, какая из этих импортированных моделей Senior, а какая Junior.

Не используйте красивое отображаемое имя, если provider его не разрешает. Назначайте точный ID, который Copilot App показывает для импортированной модели и который успешно отработал в вашей Copilot-сессии. Это особенно важно, если Junior ранее находился только по session-scoped ID.

На дату проверки (2 сентября 2026) последняя стабильная Copilot CLI — `1.0.82`; линейка `1.0.83-x` остаётся prerelease (`1.0.83-3` на дату проверки). Проверьте свою сборку:

```bash
copilot --version
copilot update
node --version
```

## 2. Проверка oMLX до установки plugin

Проверьте список API ID:

```bash
curl -sS http://127.0.0.1:8000/v1/models | jq .
curl -sS http://127.0.0.1:8000/v1/models/status | jq .
curl -sS http://127.0.0.1:8000/api/status | jq .
```

В oMLX:

1. Установите уровень журнала `DEBUG`, но не `TRACE`: TRACE может записать полные промпты.
2. На время тестов выключите `Fallback to Default Model` (`model_fallback=false`).
3. Загрузите или прогрейте обе модели до замера задержки.
4. Оставьте одну одновременно работающую Junior-генерацию на машине с 48 ГБ.

Проверьте прямой запрос к каждому точному ID:

```bash
curl -sS http://127.0.0.1:8000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"PASTE_EXACT_SENIOR_ID","messages":[{"role":"user","content":"Return only SENIOR_OK"}],"max_tokens":20}' | jq .

curl -sS http://127.0.0.1:8000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"PASTE_EXACT_JUNIOR_ID","messages":[{"role":"user","content":"Return only JUNIOR_OK"}],"max_tokens":20}' | jq .
```

Неизвестный ID в прямом запросе должен вернуть ошибку, а не другую модель.

## 3. Распаковка и назначение Senior / Junior

ZIP сам по себе не является поддерживаемым источником установки. Распакуйте его:

```bash
unzip copilot-local-model-router-distribution-0.2.0.zip
cd copilot-local-model-router-distribution
```

Сначала импортируйте провайдера в GitHub Copilot App: Settings → Model providers. Дождитесь, пока модели появятся в model picker. Plugin выбирает роли только из этого каталога и не создаёт новые модели.

Затем назначьте Senior и Junior:

```bash
cd plugins/local-model-router
node scripts/configure-models.mjs --list
node scripts/configure-models.mjs \
  --senior 'PASTE_EXACT_SENIOR_ID' \
  --junior 'PASTE_EXACT_JUNIOR_ID'
node scripts/configure-models.mjs --check
node scripts/validate-package.mjs
npm test
cd ../..
```

`--senior` и `--junior` принимают точный ID picker либо номер строки из `--list`. `--list` печатает `origin` (`imported`, `unknown` или `hosted`). Если `--list` пуст, сохраните ID из Copilot App picker в `config/imported-models.json` или передайте `--catalog`. `--from-endpoint` добавляет только записи с `origin=imported`; остальные записи того же ответа принимаются только с `--allow-unlisted`. `--allow-unlisted` работает и при частичном каталоге: точный подтверждённый ID обходит список, числовой индекс по-прежнему выбирает строку `--list`.

Внутри Copilot App ту же настройку можно запустить командой `/set-model-roles`.

Ожидается:

- список Copilot-imported моделей при `--list`;
- `SETTING senior=... junior=...` и четыре строки `Configured` при назначении;
- четыре строки `OK` при `--check`;
- `Package is valid`;
- двадцать восемь прошедших unit-тестов;
- отсутствие npm install: у plugin нет внешних runtime-зависимостей.

## 4. Рекомендуемая локальная установка через marketplace

Находясь в корне `copilot-local-model-router-distribution`:

```bash
copilot plugin marketplace add "$PWD"
copilot plugin marketplace browse local-ai-plugins
copilot plugin install local-model-router@local-ai-plugins
copilot plugin list
copilot plugins list --json
```

Если установленная версия CLI ещё не понимает filesystem marketplace, временный резервный вариант:

```bash
copilot plugin install "$PWD/plugins/local-model-router"
```

Прямая установка каталога пока документирована, но marketplace-вариант предпочтительнее для пересылки и последующего размещения в Git.

## 5. Подключение к Copilot App

1. Полностью завершите текущие сессии Copilot App.
2. Закройте приложение, запустите его снова и создайте новую локальную сессию.
3. Откройте `Customize → Plugins` и проверьте Installed.
4. Выполните `/plugin` и убедитесь, что виден `local-model-router`.
5. Выполните `/agent` и проверьте четыре имени `local-router-*`.
6. Выполните `/skills list` и проверьте `local-routing-policy` и `local-model-roles`.
7. При необходимости выполните `/set-model-roles`, чтобы переназначить Senior/Junior из импортированных моделей.

Hooks загружаются при старте runtime/session. Перезапуск после установки и после каждого изменения `hooks.json` обязателен.

Появление filesystem-installed plugin в App является acceptance test конкретной сборки. Если CLI видит plugin, а App — нет, используйте Git marketplace из следующего раздела.

## 6. Установка только через интерфейс App

Copilot App документированно добавляет custom marketplace из GitHub-репозитория или Git URL, но не из ZIP.

1. После назначения Senior/Junior поместите весь распакованный корневой каталог в отдельный приватный или публичный Git-репозиторий.
2. Убедитесь, что в репозитории есть `.github/plugin/marketplace.json` и `plugins/local-model-router/plugin.json`.
3. В App откройте `Customize → Plugins`.
4. Откройте управление marketplace и добавьте `OWNER/REPO` либо Git URL.
5. Найдите `local-model-router` и нажмите Install.
6. Полностью перезапустите App и повторите проверки `/plugin`, `/agent`, `/skills list`.

Не публикуйте реальные prompts, oMLX DEBUG-логи или локальные пути в публичном репозитории.

## 7. Первый запуск: только audit

Архив поставляется с:

```json
"LOCAL_ROUTER_MODE": "audit"
```

В этом режиме hook:

- реагирует только на `preToolUse` инструментов делегирования (`task`, `Task`, `Agent`, `custom-agent`);
- не меняет и не разрешает вызов;
- возвращает пустой объект `{}`;
- записывает только ключи и типы аргументов, hash и длину prompt, но не prompt;
- помогает определить реальное имя поля агента: например, `agent_type`, `subagent_type`, `agent` или другое.

Запустите основной сеанс с явно выбранной Senior-моделью из `config/model-roles.json`, не `Auto`, и попросите его вызвать один из plugin-agents. Затем найдите `router-events.jsonl` в plugin data directory. На типичной установке его можно отыскать так:

```bash
rg --files "$HOME/.copilot" "$HOME/Library/Application Support" 2>/dev/null \
  | rg '/router-events\.jsonl$'
```

Последняя запись должна содержать:

```json
{
  "toolName": "task",
  "agentField": "agent_type",
  "route": "junior-test-runner",
  "action": "observe"
}
```

Значение `agentField` приведено только как пример. Если оно `null`, не включайте rewrite: эта сборка App использует пока неизвестную схему.

## 8. Включение экспериментального rewrite

Только после успешного audit откройте:

```text
plugins/local-model-router/hooks.json
```

и замените:

```json
"LOCAL_ROUTER_MODE": "audit"
```

на:

```json
"LOCAL_ROUTER_MODE": "rewrite"
```

Copilot кеширует компоненты plugin. Переустановите его из исходного marketplace:

```bash
copilot plugin uninstall local-model-router
copilot plugin install local-model-router@local-ai-plugins
```

Полностью перезапустите App и начните новую сессию. Запись audit теперь должна показывать `action: rewrite-agent`, а `modifiedArgs` должен сохранить все исходные поля и поменять только selector агента.

## 9. Откат

Самый быстрый безопасный откат — вернуть `audit`, переустановить plugin и перезапустить App. Полное удаление:

```bash
copilot plugin uninstall local-model-router
```

Удаление plugin не удаляет модели или конфигурацию oMLX.
