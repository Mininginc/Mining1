#!/usr/bin/env bash
# Encrypted PostgreSQL backup.
# Usage: DATABASE_URL=... BACKUP_PASSPHRASE_FILE=/secure/passphrase scripts/backup.sh [output-dir]
# Produces <output-dir>/wms-<UTC timestamp>.dump.enc (pg_dump custom format, AES-256 via openssl).
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
: "${BACKUP_PASSPHRASE_FILE:?set BACKUP_PASSPHRASE_FILE to a file holding the encryption passphrase}"
out_dir="${1:-./backups}"
mkdir -p "$out_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$out_dir/wms-$stamp.dump.enc"
pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$BACKUP_PASSPHRASE_FILE" -out "$file"
chmod 600 "$file"
echo "$file"
