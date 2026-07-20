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
5. Установите `deploy/blockdrop-backup.service` и
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
cp -a /opt/blockdrop-data/blockdrop.sqlite \
  /opt/blockdrop-data/blockdrop.sqlite.before-restore
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

Не удаляйте `blockdrop.sqlite.before-restore` до проверки данных и smoke-теста.

## Health endpoints

- `/health/live` подтверждает, что event loop отвечает;
- `/health/ready` дополнительно проверяет SQLite;
- `/health` — совместимый подробный endpoint;
- `/metrics` — только loopback или Bearer token.

Deployment считается успешным только при совпадении `revision` и версии,
успешных live/ready, backup/restore test и production smoke.
