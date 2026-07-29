# BlockDrop

BlockDrop — детерминированная браузерная игра в жанре falling blocks. Один игровой движок используется в одиночной игре, AI, replay и server-authoritative PvP, поэтому одинаковые seed и последовательность команд дают одинаковый результат на клиенте и сервере.

Текущая версия: **3.1.0**.

Публичный стенд: [http://45.148.117.119/](http://45.148.117.119/). Он может отставать от текущей ветки репозитория. Пока стенд работает без HTTPS, аккаунты, ranked-режим и установка PWA намеренно отключены серверными capabilities.

## Возможности

- Детерминированный движок без зависимости от DOM: 7-bag, SRS, hold, ghost piece, gravity, lock delay, combo, back-to-back, T-Spin, Perfect Clear и garbage cancellation.
- Одиночная игра, Daily Challenge, локальный прогресс, достижения и косметические награды.
- AI-соперник с beam search, работающий в Web Worker вне основного UI-потока.
- Casual PvP по WebSocket: клиент отправляет input-команды, а сервер рассчитывает матч и публикует подтверждённые snapshots и результат.
- Client prediction, reconciliation по `ackSeq`, интерполяция состояния соперника и reconnect grace period.
- Проверяемые replay с input stream, checkpoints, checksum, seek и скоростью воспроизведения от 0.5× до 4×.
- Интерфейс на русском и английском, клавиатурное и сенсорное управление, screen-reader описание поля, focus management и reduced motion.
- PWA с offline fallback и безопасным обновлением service worker после завершения матча.
- Android-приложение на Capacitor; APK собирается в GitHub Actions и не хранится в Git.
- SQLite в режиме WAL, forward-only migrations, проверяемые backup/restore, JSONL-логи, Prometheus metrics и Grafana dashboard.

## Быстрый старт

### Требования

- Node.js `>=22.13.0`;
- npm и зависимости из `package-lock.json`;
- 64-битный Node.js на Windows: `better-sqlite3` использует нативный модуль.

```bash
git clone https://github.com/popka2007-root/blockdrop-web-game.git
cd blockdrop-web-game
npm ci
npm start
```

Игра откроется по адресу [http://localhost:8787](http://localhost:8787). По умолчанию SQLite-файл создаётся как `blockdrop.sqlite` в корне проекта; для production храните его вне каталога приложения.

Пример запуска с отдельной базой и портом:

```bash
PORT=9000 BLOCKDROP_DB_FILE=/opt/blockdrop-data/blockdrop.sqlite npm start
```

PowerShell:

```powershell
$env:PORT = "9000"
$env:BLOCKDROP_DB_FILE = "C:\blockdrop-data\blockdrop.sqlite"
npm start
```

## Управление

| Действие               | Клавиатура                |
| ---------------------- | ------------------------- |
| Движение               | `←` / `→` или `A` / `D`   |
| Soft drop              | `↓` или `S`               |
| Hard drop              | `Space` или `Z`           |
| Поворот по часовой     | `↑`, `W` или `X`          |
| Поворот против часовой | `Q`                       |
| Hold                   | `C`, `H`, `E` или `Shift` |
| Пауза                  | `P` или `Esc`             |

На сенсорном экране доступны tap, double tap, swipe и long press. В настройках можно выбрать жесты, экранные кнопки или гибридный режим, ведущую руку и чувствительность.

## Архитектура

```text
Browser / PWA / Android WebView
        │
        ├── js/game.js                  UI и orchestration игровой сессии
        ├── js/runtime-loop.js          фиксированный игровой цикл
        ├── js/online-controller.js     PvP lifecycle и reconciliation
        ├── js/ai-worker.js             AI вне main thread
        └── js/replay.js                запись и проверка replay
                    │
                    ▼
        shared/engine.js + shared/protocol.js
                    │
                    ▼
server.js                            composition root и authoritative match loop
        ├── server-http.js            HTTP, API, static files, health и metrics
        ├── server-store.js           SQLite, migrations и persistence
        ├── server-auth.js            пароли, сессии и auth contracts
        ├── server-transport.js       HTTPS/proxy trust boundary
        ├── server-observability.js   structured logs и Prometheus metrics
        └── server-contracts.js       исполняемые контракты между модулями
```

Движок и сетевой протокол лежат в `shared/`, чтобы браузер, Web Worker, тесты и Node.js выполняли одну реализацию правил. `server.js` только связывает серверные границы и содержит lifecycle матчей; HTTP, storage, transport, observability и контракты вынесены в отдельные модули.

## Конфигурация сервера

Приложение читает настройки непосредственно из переменных окружения.

| Переменная                          | Назначение                                       | По умолчанию              |
| ----------------------------------- | ------------------------------------------------ | ------------------------- |
| `PORT`                              | HTTP/WebSocket порт                              | `8787`                    |
| `BLOCKDROP_DB_FILE`                 | Путь к SQLite                                    | `./blockdrop.sqlite`      |
| `BLOCKDROP_ALLOWED_ORIGINS`         | Разрешённые WebSocket origins через запятую      | same-origin policy        |
| `BLOCKDROP_METRICS_TOKEN`           | Bearer token для удалённого доступа к `/metrics` | только loopback           |
| `BLOCKDROP_TRUST_PROXY`             | Разрешить доверенный reverse proxy               | `false`                   |
| `BLOCKDROP_TRUSTED_PROXY_ADDRESSES` | Адреса доверенных proxy через запятую            | пусто                     |
| `BLOCKDROP_REVISION`                | Revision для health API                          | `REVISION` или Git commit |
| `BLOCKDROP_DEPLOY_REASON`           | Причина старта в structured log                  | `startup`                 |

Feature flags `casualV2`, `accounts`, `ranked`, `analytics` и `pwaInstall` хранятся в SQLite и меняются через `npm run feature:rollout`. Для аварийного override поддерживаются переменные вида `BLOCKDROP_FEATURE_ACCOUNTS=true`. Функции, требующие безопасного транспорта, не активируются на публичном HTTP даже при включённом флаге.

## Команды

| Команда                    | Назначение                                              |
| -------------------------- | ------------------------------------------------------- |
| `npm start`                | Запустить HTTP/WebSocket сервер                         |
| `npm run build`            | Собрать статические web assets в `www/`                 |
| `npm run lint`             | Проверить исходники ESLint                              |
| `npm test`                 | Запустить unit, property, integration и contract tests  |
| `npm run test:coverage`    | Запустить Vitest с покрытием                            |
| `npm run test:e2e`         | Запустить функциональный и performance Playwright-набор |
| `npm run db:verify-backup` | Проверить полный цикл SQLite backup/restore             |
| `npm run verify`           | Выполнить полный локальный release gate                 |
| `npm run health:check`     | Проверить health, version и revision deployment         |
| `npm run smoke:prod`       | Выполнить production smoke test                         |
| `npm run release:validate` | Сверить tag, package version и commit revision          |
| `npm run feature:rollout`  | Изменить процент rollout или выполнить rollback флага   |
| `npm run soak:100`         | Запустить двухчасовой WebSocket soak на 100 CCU         |
| `npm run capture:media`    | Снять проектные media-материалы локально                |

## Тестирование

Быстрый локальный gate:

```bash
npm run lint
npm test
npm run build
```

Полная проверка перед релизом:

```bash
npx playwright install chromium firefox webkit
npm run verify
```

Playwright использует четыре worker по умолчанию. Независимые Chromium, Firefox и mobile-проекты идут параллельно; WebKit, visual regression и performance выполняются последовательно, чтобы снизить шум измерений. Количество worker можно изменить через `PLAYWRIGHT_WORKERS`.

Visual regression хранит отдельные эталоны для Linux CI и Windows. Матрица включает четыре темы и семь состояний интерфейса; эти PNG являются тестовыми fixtures, а не сборочными артефактами.

## Android

```bash
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```

На Windows используйте `gradlew.bat assembleDebug`. Нужны JDK 21 и Android SDK. Результат создаётся в `android/app/build/outputs/apk/debug/`; каталог сборки игнорируется Git.

Workflow `Build Android APK` выполняет те же шаги на pull request и при push в `master`. Release workflow повторно использует эту сборку и прикладывает APK к GitHub Release.

## CI и релизы

- `CI` запускает lint, coverage, dependency audit, проверку backup/restore и полный E2E.
- `Build Android APK` проверяет воспроизводимость Android-сборки.
- `Release Deploy` — единственный владелец публикации GitHub Release и последующего VPS deployment.
- Теги `v*` проходят release validation; prerelease определяется по дефису в имени версии.
- Deployment сверяет ожидаемый commit, проверяет live/readiness endpoints и выполняет rollback при неудачном cutover.

Основные endpoints:

- `/health/live` — процесс и event loop отвечают;
- `/health/ready` — приложение готово и SQLite доступна;
- `/health` — подробное состояние, версия и revision;
- `/metrics` — Prometheus metrics, доступные с loopback или по Bearer token;
- `/api/capabilities` — единственный источник доступности клиентских функций.

Подробные инструкции по VPS, backup/restore, systemd, feature rollout, soak, метрикам и rollback находятся в [docs/operations.md](docs/operations.md).

## Структура репозитория

| Путь         | Содержимое                                                                 |
| ------------ | -------------------------------------------------------------------------- |
| `js/`        | Browser UI, input, modes, progression, replay, AI и online orchestration   |
| `shared/`    | Детерминированный engine, AI и protocol, общие для клиента и сервера       |
| `server*.js` | Composition root и изолированные серверные границы                         |
| `tests/`     | Vitest unit, property, integration, security и contract tests              |
| `e2e/`       | Playwright functional, mobile, accessibility, security, PWA и visual tests |
| `scripts/`   | Build, backup/restore, smoke, rollout, release и soak automation           |
| `android/`   | Capacitor Android project и Gradle wrapper                                 |
| `deploy/`    | systemd units, Prometheus alerts и Grafana dashboard                       |
| `docs/`      | Design system и production runbook                                         |

Генерируемые `node_modules/`, `coverage/`, `test-results/`, `www/`, `dist/` и Android build-каталоги не должны попадать в Git.

## Безопасность и приватность

- Не публикуйте credentials, production-БД, полные IP, input streams или приватные replay.
- `/metrics` нельзя выставлять наружу без Bearer token.
- Production SQLite следует хранить вне checkout с правами `0600`.
- Accounts, ranked и публичная установка PWA требуют HTTPS.
- Уязвимости следует сообщать приватно по процедуре из [SECURITY.md](SECURITY.md), а не через публичный issue.

Дополнительные документы: [PRIVACY.md](PRIVACY.md), [TERMS.md](TERMS.md) и [docs/design-system.md](docs/design-system.md).

## Лицензия

Проект распространяется по лицензии [MIT](LICENSE).
