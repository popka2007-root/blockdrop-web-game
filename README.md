# BlockDrop Web Game

BlockDrop 3.0.0-beta.1 — браузерная Web/PWA-игра с единым детерминированным движком, настоящим AI, проверяемыми replay и server-authoritative casual PvP.

Демо: [http://45.148.117.119/](http://45.148.117.119/)

> Публичный сервер пока работает по HTTP без домена. Capabilities сервера поэтому
> держат `accounts=false`, `ranked=false` и `pwaInstall=false`. Casual-комнаты,
> одиночная игра, Daily и локальный прогресс работают; закрытые функции готовы к
> включению после настройки HTTPS.

Интерфейс проверяется на профилях Galaxy S25 FE 360×780 DPR 3, 360×700,
390×844, landscape 780×360 и desktop 1280×720.

## Основные возможности

- Версионированный engine без DOM и сети: 7-bag, SRS, gravity, lock delay, combo, B2B, T-Spin, Perfect Clear, garbage cancel и фиксированный tick.
- Одни правила и seed для solo, AI, replay, браузера, Web Worker и Node.js.
- WebSocket protocol v2: клиент отправляет только input-команды, сервер рассчитывает матч и возвращает snapshots, events и result.
- Prediction/reconciliation, `ackSeq`, интерполяция соперника и reconnect с grace period 12 секунд.
- AI в Web Worker с beam search и четырьмя измеримо разными уровнями сложности.
- Replay с input stream, checkpoints, checksum, скоростью 0.5×–4×, seek и проверкой совместимости.
- RU/EN, клавиатура, touch, screen-reader описание поля, live announcements, focus trap/restore и reduced motion.
- Локальный профиль мастерства, **достижения (Achievements)**, косметические награды и подписанный export/import прогресса.
- Privacy-first аналитика только после согласия; board, inputs, пароль, token и полный IP не записываются.
- Безопасное обновление service worker после матча, offline fallback и очистка старых cache.
- **Поддержка Android (Capacitor)**: нативный офлайн APK, автоматическая сборка через GitHub Actions.
- Современный и стильный UI с элементами Glassmorphism.
- SQLite WAL, forward-only migrations, проверяемые backup/restore, structured logs, Prometheus alerts и Grafana dashboard.

## Управление

- Клавиатура: стрелки/WASD, `Up/W/X` — поворот, `Q` — поворот против часовой, `Space/Z` — hard drop, `C/H/E/Shift` — hold, `P/Esc` — пауза.
- Сенсорный экран: tap — поворот, double tap — обратный поворот, swipe — движение/сброс, long press — hold.
- В настройках доступны жесты, экранные кнопки, гибридный режим, ведущая рука, чувствительность и adaptive performance.

## Локальный запуск

Требуется Node.js 20 или новее.

```bash
npm install
npm start
```

Откройте `http://localhost:8787`. Для отдельной production-БД задайте
`BLOCKDROP_DB_FILE`; рекомендуемый путь на VPS — `/opt/blockdrop-data/blockdrop.sqlite`.

## Проверки и эксплуатация

```bash
npm run lint
npm run test:coverage
npm run test:e2e
npm run db:verify-backup
npm audit --audit-level=high
npm run verify
npm run soak:100
```

`npm run soak:100` запускает двухчасовой WebSocket soak на 100 клиентов. Параметры
можно переопределить: `node scripts/soak-test.js --target http://127.0.0.1:8787 --ccu 10 --duration 30`.

## Архитектура

```text
js/engine.js              детерминированное игровое ядро
js/game.js                orchestration сессий и сцен
js/ai-worker.js           AI beam search вне main thread
js/replay.js              replay/checkpoint/checksum
js/online*.js             protocol v1/v2 и client reconciliation
js/i18n.js                RU/EN-каталоги локализации и UI-тексты
js/progression.js         профиль, достижения (Achievements), cosmetics, import/export
server.js                 HTTP/WebSocket entrypoint и базовая инициализация
src/server/               Модульная архитектура сервера (http.js, ws.js, matchmaking.js)
server-store.js           SQLite migrations и persistence
scripts/                  backup, restore, smoke, rollout, soak
deploy/                   systemd, Prometheus, Grafana, `.github/workflows` (APK CI)
tests/                    unit/property/integration
e2e/                      Chromium, Firefox, WebKit, mobile, axe, PWA, visual
```

Операционные процедуры описаны в [docs/operations.md](docs/operations.md), визуальные токены — в [docs/design-system.md](docs/design-system.md). Политики проекта: [PRIVACY.md](PRIVACY.md), [TERMS.md](TERMS.md), [SECURITY.md](SECURITY.md) и [LICENSE](LICENSE).

## Release gates

Релиз блокируется при ошибке lint, coverage, unit/integration/E2E/axe/visual,
migration/backup-restore, production smoke, несовпадении версии/revision или
high/critical dependency vulnerability. Ranked никогда не включается без
`secureTransport && RANKED_ENABLED`; UI получает доступность функций только из
server capabilities.
