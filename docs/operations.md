# BlockDrop: production operations

Документ описывает одноузловую конфигурацию beta: Node.js, SQLite WAL, systemd и
reverse proxy. Рабочая копия приложения находится в `/opt/tetris`, изменяемые
данные — только в `/opt/blockdrop-data`.

## Первичная подготовка VPS

1. Создайте системного пользователя `tetris` без интерактивного входа.
2. Создайте каталоги с ограниченными правами:

   ```bash
   install -d -o tetris -g tetris -m 750 /opt/blockdrop-data
   install -d -o tetris -g tetris -m 750 /opt/blockdrop-data/backups
   ```

3. Задайте для `tetris.service` переменную
   `BLOCKDROP_DB_FILE=/opt/blockdrop-data/blockdrop.sqlite`.
4. Не публикуйте `/metrics` через reverse proxy. Без
   `BLOCKDROP_METRICS_TOKEN` endpoint принимает только прямые loopback-запросы и
   отклоняет запросы с proxy-заголовками. Для удалённого Prometheus задайте
   длинный случайный токен и передавайте его как Bearer token.
5. Привяжите Node.js к loopback-интерфейсу или закройте порт приложения
   firewall. Если HTTPS завершается на локальном reverse proxy, задайте
   `BLOCKDROP_TRUST_PROXY=true`. Для удалённого proxy дополнительно перечислите
   его адреса через `BLOCKDROP_TRUSTED_PROXY_ADDRESSES`; заголовки
   `X-Forwarded-*` от остальных адресов игнорируются.
6. Установите `deploy/blockdrop-backup.service` и
   `deploy/blockdrop-backup.timer`, затем выполните:

   ```bash
   systemctl daemon-reload
   systemctl enable --now blockdrop-backup.timer
   systemctl list-timers blockdrop-backup.timer
   ```

Файл БД, WAL, SHM и резервные копии должны принадлежать `tetris:tetris` и иметь
режим `600`. Каталоги данных имеют режим `750`.

## Секреты GitHub Actions

- `VPS_HOST` — адрес VPS;
- `VPS_USER` — deploy-пользователь с минимально необходимым sudo/systemd
  доступом;
- `VPS_SSH_KEY` — отдельный закрытый deploy key;
- `VPS_KNOWN_HOSTS` — заранее проверенная строка host key, не результат
  `ssh-keyscan` во время deploy;
- `TARGET_URL` — публичный HTTP URL до появления домена.

Парольный `sshpass` не используется. При неполном наборе секретов release
публикуется, а VPS deployment явно пропускается.

## Резервное копирование

Ручной проверенный backup:

```bash
sudo -u tetris env \
  BLOCKDROP_DB_FILE=/opt/blockdrop-data/blockdrop.sqlite \
  BLOCKDROP_BACKUP_DIR=/opt/blockdrop-data/backups \
  npm --prefix /opt/tetris run db:backup
```

Скрипт использует SQLite online backup, выполняет `PRAGMA quick_check`, ставит
права `600` и только затем публикует файл. Retention:

- 14 ежедневных;
- 8 еженедельных (воскресенье UTC);
- 6 ежемесячных (первое число UTC).

Результаты записываются в
`/opt/blockdrop-data/backups/backup-audit.jsonl`. Проверяйте возраст последнего
успешного backup и журнал таймера:

```bash
systemctl status blockdrop-backup.timer
journalctl -u blockdrop-backup.service --since "7 days ago"
```

## Проверка восстановления

Восстановление сначала всегда выполняется в новый временный файл, не поверх
production-БД:

```bash
cd /opt/tetris
npm run db:restore -- \
  --backup /opt/blockdrop-data/backups/daily/blockdrop-YYYY-MM-DD.sqlite \
  --target /tmp/blockdrop-restore-check.sqlite
```

После успешного `quick_check` запустите приложение на другом порту и временной
БД, проверьте `/health/ready` и основные API. Для аварийного восстановления:

```bash
systemctl stop tetris.service
npm run db:restore -- \
  --backup /opt/blockdrop-data/backups/daily/blockdrop-YYYY-MM-DD.sqlite \
  --target /opt/blockdrop-data/blockdrop.sqlite \
  --force --allow-live-target
chown tetris:tetris /opt/blockdrop-data/blockdrop.sqlite
chmod 600 /opt/blockdrop-data/blockdrop.sqlite
systemctl start tetris.service
curl --fail http://127.0.0.1/health/live
curl --fail http://127.0.0.1/health/ready
```

Restore атомарно отодвигает прежние SQLite/WAL/SHM в файлы с суффиксом
`.before-restore-<timestamp>` и выводит их пути в `rollbackFiles`. Не удаляйте
их до проверки данных и smoke-теста.

## Health endpoints

- `/health/live` подтверждает, что event loop отвечает;
- `/health/ready` дополнительно проверяет SQLite;
- `/health` — совместимый подробный endpoint;
- `/metrics` — только loopback или Bearer token.

Deployment считается успешным только при совпадении `revision` и версии,
успешных live/ready, backup/restore test и production smoke.

## Feature rollout и быстрый rollback

Capabilities API — единственный источник доступности функций для клиента. Флаги
хранятся в SQLite и меняются штатной командой:

```bash
BLOCKDROP_DB_FILE=/opt/blockdrop-data/blockdrop.sqlite \
  npm run feature:rollout -- --flag casualV2 --stage 10
BLOCKDROP_DB_FILE=/opt/blockdrop-data/blockdrop.sqlite \
  npm run feature:rollout -- --flag casualV2 --stage 50
BLOCKDROP_DB_FILE=/opt/blockdrop-data/blockdrop.sqlite \
  npm run feature:rollout -- --flag casualV2 --stage 100
```

При росте ошибок немедленно верните casual на v1:

```bash
BLOCKDROP_DB_FILE=/opt/blockdrop-data/blockdrop.sqlite \
  npm run feature:rollout -- --flag casualV2 --rollback
```

Допустимые флаги: `casualV2`, `accounts`, `ranked`, `analytics`, `pwaInstall`.
Флаги `accounts`, `ranked` и `pwaInstall` всё равно закрыты на публичном HTTP,
даже если включены в БД. После появления HTTPS их можно включать ступенчато без
новой сборки.

## Нагрузочный gate 100 CCU

Перед 100% rollout authoritative casual запустите двухчасовую проверку с хоста,
который имеет доступ к защищённому `/metrics`:

```bash
BLOCKDROP_SOAK_TARGET=http://127.0.0.1:8787 \
BLOCKDROP_METRICS_TOKEN='replace-with-secret-if-required' \
  npm run soak:100
```

Локальная короткая проверка механики runner:

```bash
node scripts/soak-test.js --target http://127.0.0.1:8787 --ccu 10 --duration 10
```

Gate завершается ошибкой при CPU ≥70%, RSS ≥1 GiB, SQLite lock errors >0,
HTTP p95 ≥200 мс, match processing p95 ≥50 мс, разрыве клиента или отсутствии
authoritative snapshots. JSON-результат сохраняйте рядом с release audit.

## Метрики, dashboard и alerts

Готовые исходники находятся в `deploy/grafana-dashboard.json` и
`deploy/prometheus-alerts.yml`. Dashboard показывает CCU/комнаты, HTTP и match
p95, event-loop lag, CPU/RSS, 5xx, WebSocket disconnect, match abort, DB errors и
возраст backup.

Минимальные условия уведомлений:

- любое увеличение DB lock errors или DB errors;
- backup старше 36 часов либо отсутствует;
- event-loop lag >200 мс в течение 5 минут;
- RSS >900 MiB или CPU >70% в течение 10 минут;
- HTTP p95 >200 мс, match p95 >50 мс;
- 5xx >1% запросов, всплеск disconnect или match abort.

Логи сервера являются JSONL и содержат `requestId`, `connectionId`, `roomId` и
`matchId`. Пароли, токены, полный IP, board и input stream в логи не попадают.
