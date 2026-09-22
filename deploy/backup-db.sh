#!/bin/bash
# Nightly backup: dump the real database, push it off the server to Backblaze,
# then keep only the last 14 days there so storage never grows unbounded.
#
# Expects /home/appuser/.secrets/b2.env (never committed — see README) with:
#   B2_KEY_ID=...
#   B2_APP_KEY=...
#   B2_BUCKET=...
#
# Installed on the server as appuser's crontab:
#   30 21 * * * /home/appuser/backup-db.sh
# (21:30 UTC = 03:00 Asia/Colombo — the hotel's quietest hour)
set -euo pipefail
B2=/home/appuser/.local/bin/b2
source /home/appuser/.secrets/b2.env
export B2_APPLICATION_KEY_ID="$B2_KEY_ID"
export B2_APPLICATION_KEY="$B2_APP_KEY"

STAMP=$(date +%Y-%m-%d_%H%M)
FILE="regent_heights_${STAMP}.dump.gz"
TMP="/home/appuser/backup-tmp/${FILE}"
LOG="/home/appuser/backup-logs/backup.log"

echo "[$(date -Is)] starting backup ${FILE}" >> "$LOG"

DB_URL=$(grep '^DATABASE_URL=' /home/appuser/app/.env | cut -d= -f2-)
/usr/lib/postgresql/18/bin/pg_dump "$DB_URL" -Fc | gzip -9 > "$TMP"

SIZE=$(du -h "$TMP" | cut -f1)
echo "[$(date -Is)] dump made: ${SIZE}" >> "$LOG"

$B2 file upload --no-progress --quiet "$B2_BUCKET" "$TMP" "backups/${FILE}" >> "$LOG" 2>&1
echo "[$(date -Is)] uploaded to Backblaze" >> "$LOG"
rm -f "$TMP"

# Retention: keep the last 14 days, remove anything older.
CUTOFF=$(date -d '14 days ago' +%Y-%m-%d)
$B2 ls "b2://${B2_BUCKET}/backups/" 2>/dev/null | while read -r name; do
  FDATE=$(echo "$name" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)
  if [ -n "$FDATE" ] && [[ "$FDATE" < "$CUTOFF" ]]; then
    $B2 rm "b2://${B2_BUCKET}/${name}" >> "$LOG" 2>&1 || true
    echo "[$(date -Is)] removed old backup: $name" >> "$LOG"
  fi
done

echo "[$(date -Is)] backup complete" >> "$LOG"
